/**
 * Environment Judge - Verify environment before destructive operations
 *
 * Uses Jev to determine if agent is running on Dev or Prod server
 * and whether it's safe to run build/restart commands.
 *
 * Problem: Agent gets confused and tries SSH to server it's already on.
 * Solution: Jev analyzes environment context to guide safe operations.
 */
/**
 * Environment context
 */
export interface EnvironmentContext {
    hostname?: string;
    currentPath?: string;
    isRemoteSession?: boolean;
    hasSSHConnection?: boolean;
    gitRemote?: string;
    isProduction?: boolean;
}
/**
 * Environment decision result
 */
export interface EnvironmentDecision {
    isLocal: boolean;
    isRemote: boolean;
    likelyServer?: "dev" | "prod" | "unknown";
    confidence: "high" | "medium" | "low";
    reasoning: string;
    warnings: string[];
    recommendedActions: string[];
}
/**
 * Build/restart safety check
 */
export interface SafetyCheck {
    safe: boolean;
    isLocal: boolean;
    targetServer?: "dev" | "prod" | "unknown";
    warnings: string[];
    requiresConfirmation: boolean;
    recommendedCommand?: string;
}
/**
 * Environment Judge configuration
 */
export interface EnvironmentConfig {
    devPatterns?: string[];
    prodPatterns?: string[];
}
export declare class EnvironmentJudge {
    private jev?;
    private config;
    constructor(config?: EnvironmentConfig);
    analyze(context?: EnvironmentContext): Promise<EnvironmentDecision>;
    checkBuildSafety(context?: EnvironmentContext): Promise<SafetyCheck>;
    checkSSHCommand(host: string, command: string): Promise<SafetyCheck>;
    private detectEnvironment;
    private detectProduction;
    private isLocalHost;
    private guessServer;
    private makeDecision;
    private fallbackDecision;
}
//# sourceMappingURL=environment-judge.d.ts.map