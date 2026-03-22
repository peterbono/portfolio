import { defineConfig } from "@trigger.dev/sdk/v3"
import { playwright } from "@trigger.dev/build/extensions/playwright"

export default defineConfig({
  project: "job-tracker-oSgf",
  runtime: "node",
  logLevel: "log",
  // Tell Trigger.dev where to find task files
  dirs: ["src/trigger"],
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
    ],
  },
})
