/**
 * Context Discovery — Orchestrates context collection
 */
interface DiscoveredContext {
    intent: unknown;
    workspace: unknown;
    dependencies: unknown;
    knowledge: unknown;
    files: string[];
    estimatedTokens: number;
}
interface DiscoveryOptions {
    rootPath: string;
    task: string;
    intent?: unknown;
    maximumTokens?: number;
}
interface DiscoveryResult {
    context: DiscoveredContext;
    discovered: unknown[];
    omitted: unknown[];
    estimatedTokens: number;
}
export declare class ContextDiscovery {
    discover(options: DiscoveryOptions): Promise<DiscoveryResult>;
}
export {};
//# sourceMappingURL=discovery.d.ts.map