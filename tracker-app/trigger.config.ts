import { defineConfig } from "@trigger.dev/sdk/v3"
import { playwright } from "@trigger.dev/build/extensions/playwright"
import { aptGet } from "@trigger.dev/build/extensions/core"

export default defineConfig({
  project: "proj_tnxarbbygyqjddsnteoj",
  runtime: "node",
  logLevel: "log",
  // Tell Trigger.dev where to find task files
  dirs: ["src/trigger"],
  // Default machine: 1 vCPU, 1 GB RAM (enough for SBR-based tasks)
  // Individual tasks (apply-jobs) override to larger machines as needed
  defaultMachine: "small-2x",
  // Allow 30-minute long browser automation runs
  maxDuration: 1800,
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
  build: {
    extensions: [
      // Install Chromium inside the Trigger.dev container so Playwright can launch it
      playwright({ browsers: ["chromium"] }),
      // Install Ghostscript for PDF compression task
      aptGet({ packages: ["ghostscript"] }),
    ],
  },
})
