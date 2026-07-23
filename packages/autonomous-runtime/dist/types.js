/**
 * Autonomous Operations Runtime — TypeScript Contracts
 * Based on RFC-0101 §14
 *
 * Consumers: LoopRuntime, privilege-broker, scheduler-adapter, notification-runtime.
 * These types are the canonical contracts. Do not re-define them in other packages.
 */
import { env } from "node:process";
// ─── Storage paths ────────────────────────────────────────────────────────────
const DEFAULT_ROOT = `${env["HOME"] ?? "."}/.pi/harness`;
/** Returns the standard storage root for the runtime. */
export function getRuntimeRoot() {
    return env["PI_HARNESS_RUNTIME_ROOT"] ?? DEFAULT_ROOT;
}
/** Returns the inbox directory path. */
export function getInboxDir() {
    return `${getRuntimeRoot()}/inbox`;
}
/** Returns the claimed leases directory path. */
export function getLeasesDir() {
    return `${getInboxDir()}/claimed`;
}
/** Returns the task JSONL file path. */
export function getTasksPath() {
    return `${getInboxDir()}/tasks.jsonl`;
}
/** Returns the worker registry path. */
export function getWorkerRegistryPath() {
    return `${getRuntimeRoot()}/worker-registry.json`;
}
//# sourceMappingURL=types.js.map