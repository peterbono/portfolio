/**
 * Dev Watchdog — a detached process that cancels in-flight runs when the dev CLI exits.
 *
 * Spawned by the dev CLI with `detached: true, stdio: "ignore", unref()`.
 * Survives when pnpm sends SIGKILL to the CLI process tree.
 *
 * Lifecycle:
 *   1. CLI spawns this script, passing config via env vars
 *   2. Writes PID file for single-instance guarantee
 *   3. Polls parent PID to detect when the CLI exits
 *   4. On parent death: reads active-runs file → calls disconnect endpoint → exits
 *
 * Environment variables:
 *   WATCHDOG_PARENT_PID    - The PID of the parent dev CLI process
 *   WATCHDOG_API_URL       - The Trigger.dev API/engine URL
 *   WATCHDOG_API_KEY       - The API key for authentication
 *   WATCHDOG_ACTIVE_RUNS   - Path to the active-runs JSON file
 *   WATCHDOG_PID_FILE      - Path to write the watchdog PID file
 */
export {};
