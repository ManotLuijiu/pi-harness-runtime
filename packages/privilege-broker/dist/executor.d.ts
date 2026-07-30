import type { AuditLogger } from "./types.js";
/** The BrokerExecutor resolves and executes capability grants. */
export declare class BrokerExecutor {
    private readonly audit;
    constructor(audit: AuditLogger);
    /**
     * Execute a command as the configured service account.
     * Throws on timeout or spawn error.
     */
    execute(options: {
        command: string;
        args: string[];
        envWhitelist?: string[];
        allowedCwd?: string;
        timeoutMs?: number;
        actor: string;
        capability: string;
        reason: string;
    }): Promise<{
        exitCode: number;
        stdout: string;
        stderr: string;
    }>;
}
//# sourceMappingURL=executor.d.ts.map