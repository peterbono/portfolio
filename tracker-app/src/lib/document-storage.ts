/**
 * Client-side utilities for document upload, compression triggering,
 * and variant retrieval from Supabase Storage.
 *
 * This module is imported by the frontend (Vite SPA).
 */

import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_BUCKET = 'documents'
const TRIGGER_COMPRESS_URL = 'https://api.trigger.dev/api/v1/tasks/compress-pdf/trigger'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DocumentUploadResult {
  path: string
  url: string
}

export interface Variant {
  quality: string
  size: number
  path: string
  url: string
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Upload a document (CV, portfolio) to Supabase Storage.
 *
 * @param file - The File object from a file input
 * @param userId - Authenticated user's ID
 * @param type - Category: 'context' (AI feed) or 'recruiter' (submission docs)
 * @returns The storage path and public URL
 */
export async function uploadDocument(
  file: File,
  userId: string,
  type: 'context' | 'recruiter',
): Promise<DocumentUploadResult> {
  // Sanitize filename: remove special chars, keep extension
  const sanitized = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${userId}/${type}/${sanitized}`

  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, file, {
      contentType: file.type || 'application/pdf',
      upsert: true,
    })

  if (error) {
    // If bucket doesn't exist, provide a clear error message
    if (error.message?.includes('not found') || error.message?.includes('Bucket')) {
      throw new Error(
        `Storage bucket "${STORAGE_BUCKET}" not found. ` +
        `Create it in the Supabase dashboard (Storage > New bucket > "documents", public: false).`
      )
    }
    throw new Error(`Failed to upload document: ${error.message}`)
  }

  const url = getDocumentUrl(storagePath)
  return { path: storagePath, url }
}

// ---------------------------------------------------------------------------
// Trigger compression
// ---------------------------------------------------------------------------

/**
 * Trigger the Ghostscript PDF compression task on Trigger.dev.
 *
 * @param userId - The user who owns the document
 * @param storagePath - Full path in the "documents" bucket
 * @param fileName - Original filename (for logging/display)
 */
export async function triggerCompression(
  userId: string,
  storagePath: string,
  fileName: string,
): Promise<{ runId: string }> {
  const key = import.meta.env.VITE_TRIGGER_PUBLIC_KEY || ''
  if (!key) {
    throw new Error('VITE_TRIGGER_PUBLIC_KEY is not configured — cannot trigger compression')
  }

  const response = await fetch(TRIGGER_COMPRESS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      payload: { userId, storagePath, fileName },
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error')
    throw new Error(`Failed to trigger compression: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { runId: data.id }
}

// ---------------------------------------------------------------------------
// URL generation
// ---------------------------------------------------------------------------

/**
 * Generate a signed URL for a private document in Supabase Storage.
 * Signed URLs are valid for 1 hour.
 */
export function getDocumentUrl(storagePath: string): string {
  const { data } = supabase.storage
    .from(STORAGE_BUCKET)
    .getPublicUrl(storagePath)

  return data.publicUrl
}

/**
 * Generate a time-limited signed URL (for bot downloads).
 * Valid for 1 hour.
 */
export async function getSignedDocumentUrl(
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds)

  if (error || !data?.signedUrl) {
    throw new Error(`Failed to generate signed URL: ${error?.message ?? 'no data'}`)
  }

  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Variant listing and selection
// ---------------------------------------------------------------------------

/** Standard variant filenames created by the compress-pdf task */
const VARIANT_FILES = [
  { name: 'cv-10mb.pdf', quality: 'high' },
  { name: 'cv-5mb.pdf', quality: 'medium' },
  { name: 'cv-2mb.pdf', quality: 'low' },
] as const

/**
 * List all compressed variants available for a user.
 * Checks which of the standard variant files exist in storage.
 */
export async function listDocumentVariants(userId: string): Promise<Variant[]> {
  const variants: Variant[] = []

  for (const variant of VARIANT_FILES) {
    const variantPath = `documents/${userId}/${variant.name}`

    // Check if file exists by trying to get its metadata
    const { data } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(`documents/${userId}`, {
        search: variant.name,
        limit: 1,
      })

    if (data && data.length > 0) {
      const file = data.find((f) => f.name === variant.name)
      if (file) {
        variants.push({
          quality: variant.quality,
          size: file.metadata?.size ?? 0,
          path: variantPath,
          url: getDocumentUrl(variantPath),
        })
      }
    }
  }

  return variants
}

/**
 * Get the best (largest quality) variant that fits within a size limit.
 *
 * @param userId - The user's ID
 * @param maxSizeMB - Maximum allowed file size in megabytes
 * @returns Storage path of the best fitting variant, or null if none found
 */
export async function getBestVariant(
  userId: string,
  maxSizeMB: number,
): Promise<string | null> {
  const variants = await listDocumentVariants(userId)

  if (variants.length === 0) return null

  const maxSizeBytes = maxSizeMB * 1024 * 1024

  // Sort by size descending — we want the largest file under the limit
  const sorted = [...variants].sort((a, b) => b.size - a.size)

  // Find the largest variant that fits
  const best = sorted.find((v) => v.size <= maxSizeBytes)

  // If nothing fits under the limit, return the smallest variant anyway
  // (the ATS adapter will deal with the rejection)
  if (!best) {
    const smallest = sorted[sorted.length - 1]
    return smallest.path
  }

  return best.path
}

/**
 * Get the signed download URL for the best variant under a size limit.
 * Falls back to the medium (5MB) variant if size is unknown.
 *
 * @param userId - The user's ID
 * @param maxSizeMB - Maximum size in MB (default: 5)
 */
export async function getBestVariantUrl(
  userId: string,
  maxSizeMB = 5,
): Promise<string | null> {
  const variantPath = await getBestVariant(userId, maxSizeMB)
  if (!variantPath) return null

  return getSignedDocumentUrl(variantPath)
}
