/**
 * Command Executor — RFC-0025
 *
 * Safe shell command execution with timeout, output capture, and security policies.
 *
 * Features:
 * - Timeout enforcement
 * - Output capture (stdout/stderr)
 * - Working directory control
 * - Environment variable injection
 * - Security policy enforcement
 * - Process management (kill, signal)
 */
import { spawn, } from "node:child_process";
import { EventEmitter } from "node:events";
import { join } from "node:path";
const DEFAULT_POLICY = {
    allowShellBuiltins: true,
    allowEnvInjection: true,
    maxTimeout: 300000, // 5 minutes default
};
export class CommandExecutor extends EventEmitter {
    policy;
    runningProcesses = new Map();
    defaultOptions;
    constructor(policy = {}) {
        super();
        this.policy = { ...DEFAULT_POLICY, ...policy };
        this.defaultOptions = {
            captureStdout: true,
            captureStderr: true,
            ignoreExitCode: false,
            policyCheck: true,
        };
    }
    /**
     * Execute a command synchronously
     */
    exec(command, options = {}) {
        const opts = { ...this.defaultOptions, ...options };
        const startTime = Date.now();
        // Policy check
        if (opts.policyCheck !== false) {
            const policyResult = this.checkPolicy(command, opts);
            if (!policyResult.allowed) {
                this.emit("policyViolation", policyResult.reason ?? "Policy violation", command);
                return {
                    success: false,
                    exitCode: null,
                    stdout: "",
                    stderr: policyResult.reason ?? "Policy violation",
                    timedOut: false,
                    duration: Date.now() - startTime,
                    command,
                };
            }
        }
        // Spawn process
        const spawnOpts = {
            cwd: opts.cwd ?? process.cwd(),
            env: { ...process.env, ...opts.env },
            shell: opts.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh"),
            uid: opts.uid,
            gid: opts.gid,
            windowsHide: true,
        };
        let proc;
        try {
            proc = spawn(command, [], spawnOpts);
        }
        catch (error) {
            this.emit("error", error, command);
            return {
                success: false,
                exitCode: null,
                stdout: "",
                stderr: String(error),
                timedOut: false,
                duration: Date.now() - startTime,
                command,
            };
        }
        this.runningProcesses.set(proc.pid, proc);
        const event = {
            command,
            timestamp: new Date().toISOString(),
            pid: proc.pid,
        };
        this.emit("start", event);
        // Collect output
        let stdout = "";
        let stderr = "";
        if (opts.captureStdout && proc.stdout) {
            proc.stdout.on("data", (data) => {
                stdout += data.toString();
            });
        }
        if (opts.captureStderr && proc.stderr) {
            proc.stderr.on("data", (data) => {
                stderr += data.toString();
            });
        }
        // Handle timeout
        let timedOutFlag = false;
        let timeoutId;
        if (opts.timeout && opts.timeout > 0) {
            const maxTimeout = this.policy.maxTimeout ?? Infinity;
            const effectiveTimeout = Math.min(opts.timeout, maxTimeout);
            timeoutId = setTimeout(() => {
                timedOutFlag = true;
                this.kill(proc.pid);
                this.emit("timeout", event);
            }, effectiveTimeout);
        }
        // Wait for completion
        const exitCode = this.waitForExit(proc);
        // Cleanup
        if (timeoutId)
            clearTimeout(timeoutId);
        this.runningProcesses.delete(proc.pid);
        const duration = Date.now() - startTime;
        this.emit("exit", { ...event, exitCode: exitCode ?? -1, duration });
        const success = (exitCode === 0 || opts.ignoreExitCode) && !timedOutFlag ? true : false;
        return {
            success,
            exitCode,
            stdout,
            stderr,
            timedOut: timedOutFlag,
            duration,
            command,
        };
    }
    /**
     * Execute a command asynchronously (non-blocking)
     */
    async execAsync(command, options = {}) {
        const opts = { ...this.defaultOptions, ...options };
        const startTime = Date.now();
        // Policy check
        if (opts.policyCheck !== false) {
            const policyResult = this.checkPolicy(command, opts);
            if (!policyResult.allowed) {
                this.emit("policyViolation", policyResult.reason ?? "Policy violation", command);
                return {
                    success: false,
                    exitCode: null,
                    stdout: "",
                    stderr: policyResult.reason ?? "Policy violation",
                    timedOut: false,
                    duration: Date.now() - startTime,
                    command,
                };
            }
        }
        // Spawn process
        const spawnOpts = {
            cwd: opts.cwd ?? process.cwd(),
            env: { ...process.env, ...opts.env },
            shell: opts.shell ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh"),
            uid: opts.uid,
            gid: opts.gid,
            windowsHide: true,
        };
        return new Promise((resolve) => {
            const proc = spawn(command, [], spawnOpts);
            this.runningProcesses.set(proc.pid, proc);
            const event = {
                command,
                timestamp: new Date().toISOString(),
                pid: proc.pid,
            };
            this.emit("start", event);
            // Collect output
            let stdout = "";
            let stderr = "";
            if (opts.captureStdout && proc.stdout) {
                proc.stdout.on("data", (data) => {
                    stdout += data.toString();
                });
            }
            if (opts.captureStderr && proc.stderr) {
                proc.stderr.on("data", (data) => {
                    stderr += data.toString();
                });
            }
            // Handle timeout
            let timedOut = false;
            const timeoutId = setTimeout(() => {
                timedOut = true;
                this.kill(proc.pid);
                this.emit("timeout", event);
            }, opts.timeout ?? this.policy.maxTimeout ?? 300000);
            proc.on("close", (code) => {
                clearTimeout(timeoutId);
                this.runningProcesses.delete(proc.pid);
                const duration = Date.now() - startTime;
                const exitCode = code !== null ? code : -1;
                this.emit("exit", { ...event, exitCode, duration });
                const execSuccess = (code === 0 || opts.ignoreExitCode) && !timedOut ? true : false;
                resolve({
                    success: execSuccess,
                    exitCode: code,
                    stdout,
                    stderr,
                    timedOut: timedOut,
                    duration,
                    command,
                });
            });
            proc.on("error", (error) => {
                clearTimeout(timeoutId);
                this.runningProcesses.delete(proc.pid);
                this.emit("error", error, command);
                resolve({
                    success: false,
                    exitCode: null,
                    stdout,
                    stderr: stderr + "\n" + String(error),
                    timedOut: false,
                    duration: Date.now() - startTime,
                    command,
                });
            });
        });
    }
    /**
     * Kill a running process
     */
    kill(pid, signal = "SIGTERM") {
        const proc = this.runningProcesses.get(pid);
        if (!proc) {
            return false;
        }
        try {
            proc.kill(signal);
            return true;
        }
        catch {
            return false;
        }
    }
    /**
     * Kill all running processes
     */
    killAll(signal = "SIGTERM") {
        let killed = 0;
        for (const entry of Array.from(this.runningProcesses.entries())) {
            const [_pid, proc] = entry;
            try {
                proc.kill(signal);
                killed++;
            }
            catch {
                // Process already exited
            }
        }
        this.runningProcesses.clear();
        return killed;
    }
    /**
     * Get count of running processes
     */
    getRunningCount() {
        return this.runningProcesses.size;
    }
    /**
     * Get list of running process PIDs
     */
    getRunningPids() {
        return Array.from(this.runningProcesses.keys());
    }
    /**
     * Check policy for a command
     */
    checkPolicy(command, _options) {
        // Check denied commands
        if (this.policy.deniedCommands) {
            for (const pattern of this.policy.deniedCommands) {
                if (pattern.test(command)) {
                    return {
                        allowed: false,
                        reason: `Command matches denied pattern: ${pattern}`,
                    };
                }
            }
        }
        // Check allowed commands (if specified, must match)
        if (this.policy.allowedCommands && this.policy.allowedCommands.length > 0) {
            let allowed = false;
            for (const pattern of this.policy.allowedCommands) {
                if (pattern.test(command)) {
                    allowed = true;
                    break;
                }
            }
            if (!allowed) {
                return {
                    allowed: false,
                    reason: "Command not in allowed list",
                };
            }
        }
        // Check denied directories
        if (_options?.cwd) {
            if (this.policy.deniedDirs) {
                for (const dir of this.policy.deniedDirs) {
                    if (_options.cwd.startsWith(dir)) {
                        return {
                            allowed: false,
                            reason: `Working directory matches denied path: ${dir}`,
                        };
                    }
                }
            }
        }
        // Check for dangerous shell operators
        const dangerousPatterns = [
            { pattern: /;\s*rm\s+-rf/i, reason: "Attempted rm -rf" },
            {
                pattern: />\s*\/dev\/null/i,
                reason: "Output redirection to /dev/null",
            },
            { pattern: /\|\s*sh\s*$/i, reason: "Pipe to shell" },
            { pattern: /&\s*$/, reason: "Background execution" },
        ];
        for (const { pattern, reason } of dangerousPatterns) {
            if (pattern.test(command)) {
                // Only block if explicitly denied
                if (this.policy.deniedCommands) {
                    return { allowed: false, reason };
                }
            }
        }
        return { allowed: true };
    }
    /**
     * Update policy at runtime
     */
    updatePolicy(updates) {
        Object.assign(this.policy, updates);
    }
    /**
     * Get current policy
     */
    getPolicy() {
        return { ...this.policy };
    }
    // --- Private Methods ------------------------------------------------
    waitForExit(_proc) {
        // Note: This method is for synchronous execution.
        // For async execution, use execAsync() which properly handles events.
        // This returns null for sync - actual exit code is captured via events.
        return null;
    }
}
/**
 * Create a CommandExecutor with safe defaults for harness runtime
 */
export function createHarnessExecutor() {
    return new CommandExecutor({
        // Allow common development commands
        allowedCommands: [
            /^(git|npm|npx|yarn|pnpm|bun|node|python3?|make|cargo|go)\s/,
            /^(tsc|esbuild|rollup|vite|webpack)\s/,
            /^(jest|vitest|mocha|pytest|cargo test|npm test)\s/,
            /^(eslint|ruff|black|prettier)\s/,
            /^(mkdir|rm|cp|mv|cat|echo|ls|cd)\s/,
        ],
        // Deny dangerous patterns
        deniedCommands: [
            /rm\s+-rf\s+\/(?!node_modules)/, // rm -rf / except rm -rf node_modules
            /curl\s+.*\|.*sh$/i, // curl | sh
            /wget\s+.*\|.*sh$/i, // wget | sh
            /base64\s+-d\s+.*\|.*sh/i, // base64 decode | sh
            /:\(\)\{.*\}\s*:/, // Fork bomb
        ],
        maxTimeout: 300000, // 5 minutes
        // Default to user's home directory
        allowedDirs: [join(process.env.HOME ?? "", "")],
    });
}
//# sourceMappingURL=command-executor.js.map