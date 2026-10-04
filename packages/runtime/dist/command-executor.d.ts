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
import { EventEmitter } from "node:events";
export interface CommandResult {
    success: boolean;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    duration: number;
    command: string;
}
export interface CommandOptions {
    /** Working directory (default: process.cwd()) */
    cwd?: string;
    /** Environment variables to inject */
    env?: Record<string, string>;
    /** Timeout in milliseconds (default: no timeout) */
    timeout?: number;
    /** Shell to use (default: /bin/sh on Unix, cmd.exe on Windows) */
    shell?: string;
    /** User ID to run as (if available) */
    uid?: number;
    /** Group ID to run as (if available) */
    gid?: number;
    /** Capture stdout (default: true) */
    captureStdout?: boolean;
    /** Capture stderr (default: true) */
    captureStderr?: boolean;
    /** Treat non-zero exit as success (default: false) */
    ignoreExitCode?: boolean;
    /** Policy to check before execution */
    policyCheck?: boolean;
}
export interface CommandPolicy {
    /** Allowed commands (exact match or pattern) */
    allowedCommands?: RegExp[];
    /** Denied commands (takes precedence) */
    deniedCommands?: RegExp[];
    /** Maximum timeout in ms */
    maxTimeout?: number;
    /** Allowed working directories */
    allowedDirs?: string[];
    /** Denied working directories */
    deniedDirs?: string[];
    /** Allow shell built-ins */
    allowShellBuiltins?: boolean;
    /** Allow environment variable injection */
    allowEnvInjection?: boolean;
    /** Commands that require explicit policy bypass */
    requireApproval?: RegExp[];
}
export interface CommandEvent {
    command: string;
    timestamp: string;
    pid?: number;
}
export interface CommandExecutorEvents {
    onStart: (event: CommandEvent) => void;
    onExit: (event: CommandEvent & {
        exitCode: number;
        duration: number;
    }) => void;
    onTimeout: (event: CommandEvent) => void;
    onError: (error: Error, command: string) => void;
    onPolicyViolation: (reason: string, command: string) => void;
}
export declare class CommandExecutor extends EventEmitter {
    private readonly policy;
    private runningProcesses;
    private defaultOptions;
    constructor(policy?: CommandPolicy);
    /**
     * Execute a command synchronously
     */
    exec(command: string, options?: CommandOptions): CommandResult;
    /**
     * Execute a command asynchronously (non-blocking)
     */
    execAsync(command: string, options?: CommandOptions): Promise<CommandResult>;
    /**
     * Kill a running process
     */
    kill(pid: number, signal?: NodeJS.Signals): boolean;
    /**
     * Kill all running processes
     */
    killAll(signal?: NodeJS.Signals): number;
    /**
     * Get count of running processes
     */
    getRunningCount(): number;
    /**
     * Get list of running process PIDs
     */
    getRunningPids(): number[];
    /**
     * Check policy for a command
     */
    checkPolicy(command: string, _options?: CommandOptions): {
        allowed: boolean;
        reason?: string;
    };
    /**
     * Update policy at runtime
     */
    updatePolicy(updates: Partial<CommandPolicy>): void;
    /**
     * Get current policy
     */
    getPolicy(): CommandPolicy;
    private waitForExit;
}
/**
 * Create a CommandExecutor with safe defaults for harness runtime
 */
export declare function createHarnessExecutor(): CommandExecutor;
//# sourceMappingURL=command-executor.d.ts.map