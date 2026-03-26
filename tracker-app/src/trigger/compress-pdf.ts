import { task } from "@trigger.dev/sdk/v3"
import { execSync } from "child_process"
import { createClient } from "@supabase/supabase-js"
import * as fs from "fs"
import * as path from "path"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompressPayload {
  userId: string
  storagePath: string
  fileName: string
}

interface VariantResult {
  quality: string
  dpi: number
  size: number // bytes
  path: string
}

interface CompressResult {
  variants: VariantResult[]
  skippedCompression: boolean
  originalSize: number
}

// ---------------------------------------------------------------------------
// Ghostscript compression profiles
// ---------------------------------------------------------------------------

const GS_PROFILES = [
  { quality: "high", dpi: 300, setting: "/printer", suffix: "cv-10mb" },
  { quality: "medium", dpi: 150, setting: "/ebook", suffix: "cv-5mb" },
  { quality: "low", dpi: 72, setting: "/screen", suffix: "cv-2mb" },
] as const

// Skip compression entirely if original is under this size (2 MB)
const SKIP_THRESHOLD_BYTES = 2 * 1024 * 1024

// ---------------------------------------------------------------------------
// Server-side Supabase client (service_role)
// ---------------------------------------------------------------------------

function getSupabaseServer() {
  const url = process.env.SUPABASE_URL || ""
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ""
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars")
  }
  return createClient(url, key)
}

// ---------------------------------------------------------------------------
// Trigger.dev task
// ---------------------------------------------------------------------------

export const compressPdfTask = task({
  id: "compress-pdf",
  // PDF compression should be fast — 5 minutes max
  maxDuration: 300,
  retry: {
    maxAttempts: 2,
  },
  run: async (payload: CompressPayload): Promise<CompressResult> => {
    const supabase = getSupabaseServer()
    const tmpDir = "/tmp/pdf-compress"
    const inputPath = path.join(tmpDir, "original.pdf")

    // Ensure temp directory exists
    fs.mkdirSync(tmpDir, { recursive: true })

    // -----------------------------------------------------------------------
    // 1. Download original PDF from Supabase Storage
    // -----------------------------------------------------------------------
    console.log(`[compress-pdf] Downloading ${payload.storagePath}...`)

    const { data: downloadData, error: downloadError } = await supabase.storage
      .from("documents")
      .download(payload.storagePath)

    if (downloadError || !downloadData) {
      throw new Error(
        `Failed to download PDF from storage: ${downloadError?.message ?? "no data"}`
      )
    }

    // Convert Blob to Buffer and write to /tmp
    const arrayBuffer = await downloadData.arrayBuffer()
    const originalBuffer = Buffer.from(arrayBuffer)
    fs.writeFileSync(inputPath, originalBuffer)

    const originalSize = originalBuffer.length
    console.log(`[compress-pdf] Original size: ${(originalSize / 1024 / 1024).toFixed(2)} MB`)

    // -----------------------------------------------------------------------
    // 2. Skip compression if original is already small
    // -----------------------------------------------------------------------
    if (originalSize <= SKIP_THRESHOLD_BYTES) {
      console.log(
        `[compress-pdf] Original is under ${SKIP_THRESHOLD_BYTES / 1024 / 1024}MB — skipping compression`
      )

      // Still upload as a single "low" variant so getBestVariant always works
      const variantPath = `documents/${payload.userId}/cv-2mb.pdf`
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(variantPath, originalBuffer, {
          contentType: "application/pdf",
          upsert: true,
        })

      if (uploadError) {
        console.warn(`[compress-pdf] Failed to upload skip-variant: ${uploadError.message}`)
      }

      // Cleanup
      fs.rmSync(tmpDir, { recursive: true, force: true })

      return {
        variants: [
          {
            quality: "low",
            dpi: 72,
            size: originalSize,
            path: variantPath,
          },
        ],
        skippedCompression: true,
        originalSize,
      }
    }

    // -----------------------------------------------------------------------
    // 3. Run Ghostscript for each compression profile
    // -----------------------------------------------------------------------
    const variants: VariantResult[] = []

    for (const profile of GS_PROFILES) {
      const outputPath = path.join(tmpDir, `${profile.suffix}.pdf`)

      try {
        const gsCmd = [
          "gs",
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.4",
          `-dPDFSETTINGS=${profile.setting}`,
          "-dNOPAUSE",
          "-dQUIET",
          "-dBATCH",
          `-dDownsampleColorImages=true`,
          `-dColorImageResolution=${profile.dpi}`,
          `-dDownsampleGrayImages=true`,
          `-dGrayImageResolution=${profile.dpi}`,
          `-dDownsampleMonoImages=true`,
          `-dMonoImageResolution=${profile.dpi}`,
          `-sOutputFile=${outputPath}`,
          inputPath,
        ].join(" ")

        console.log(`[compress-pdf] Running Ghostscript (${profile.quality}, ${profile.dpi} DPI)...`)
        execSync(gsCmd, { timeout: 120_000 })

        // Read compressed file
        const compressedBuffer = fs.readFileSync(outputPath)
        const compressedSize = compressedBuffer.length

        console.log(
          `[compress-pdf] ${profile.quality}: ${(compressedSize / 1024 / 1024).toFixed(2)} MB ` +
          `(${Math.round((1 - compressedSize / originalSize) * 100)}% reduction)`
        )

        // If compressed is larger than original, use original instead
        const finalBuffer =
          compressedSize >= originalSize ? originalBuffer : compressedBuffer
        const finalSize = finalBuffer.length

        // Upload to Supabase Storage
        const variantPath = `documents/${payload.userId}/${profile.suffix}.pdf`
        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(variantPath, finalBuffer, {
            contentType: "application/pdf",
            upsert: true,
          })

        if (uploadError) {
          console.error(
            `[compress-pdf] Failed to upload ${profile.quality} variant: ${uploadError.message}`
          )
          continue
        }

        variants.push({
          quality: profile.quality,
          dpi: profile.dpi,
          size: finalSize,
          path: variantPath,
        })
      } catch (err) {
        console.error(
          `[compress-pdf] Ghostscript failed for ${profile.quality}:`,
          err instanceof Error ? err.message : err
        )
        // Continue with other profiles — don't let one failure break everything
      }
    }

    // -----------------------------------------------------------------------
    // 4. Cleanup temp files
    // -----------------------------------------------------------------------
    fs.rmSync(tmpDir, { recursive: true, force: true })

    if (variants.length === 0) {
      throw new Error("All Ghostscript compression profiles failed — PDF may be corrupted")
    }

    console.log(`[compress-pdf] Done. ${variants.length} variants created.`)

    return {
      variants,
      skippedCompression: false,
      originalSize,
    }
  },
})
