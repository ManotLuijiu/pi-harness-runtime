/**
 * TencentDB Sync Config (RFC-0105/0106)
 *
 * Loads configuration from env vars or .pi/settings.json
 */
export interface SyncConfig {
    serverUrl: string;
    knowledgeUrl: string;
    userKey: string;
    serviceId: string;
    skillsSource: string;
    autoSync: boolean;
    syncIntervalMs: number;
    watchMode: boolean;
}
/**
 * Load config from environment variables
 */
export declare function loadConfigFromEnv(): Partial<SyncConfig>;
/**
 * Load config from .pi/settings.json
 */
export declare function loadConfigFromSettings(): Promise<Partial<SyncConfig>>;
/**
 * Merge configs (env > settings > defaults)
 */
export declare function loadConfig(): Promise<SyncConfig>;
/**
 * Validate config
 */
export declare function validateConfig(config: SyncConfig): string[];
//# sourceMappingURL=config.d.ts.map