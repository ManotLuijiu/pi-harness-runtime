/**
 * SSH Guard Tool
 *
 * Intercepts SSH commands and checks if the destination matches the local environment.
 * Combines automatic checking with a fresh reminder when the agent proposes SSH.
 */
/**
 * Result of SSH guard check
 */
export interface SshGuardResult {
    /** Whether SSH is allowed to proceed */
    allowed: boolean;
    /** Message explaining the decision */
    message: string;
    /** Whether the destination matches local */
    isLocal: boolean;
    /** Resolved destination address */
    destinationAddress?: string;
}
/**
 * Check if destination is local
 */
export declare function checkSshNecessity(command: string): Promise<SshGuardResult>;
/**
 * Tool definition for SSH guard
 */
export declare const SshGuardTool: {
    readonly name: "ssh_guard_check";
    readonly description: "Check if SSH destination matches local environment before allowing SSH";
    readonly parameters: {
        readonly type: "object";
        readonly properties: {
            readonly command: {
                readonly type: "string";
                readonly description: "The SSH command to check";
            };
        };
        readonly required: readonly ["command"];
    };
};
/**
 * Execute SSH guard check
 */
export declare function executeSshGuard(args: {
    command: string;
}, _api: unknown, _context: unknown): Promise<{
    allowed: boolean;
    message: string;
    isLocal: boolean;
}>;
//# sourceMappingURL=ssh-guard.d.ts.map