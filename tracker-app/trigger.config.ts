import { defineConfig } from "@trigger.dev/sdk/v3"

export default defineConfig({
  project: "job-tracker-oSgf",
  runtime: "node",
  logLevel: "log",
  retries: {
    enabledInDev: true,
    default: {
      maxAttempts: 2,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
    },
  },
})
