/**
 * Chrome Profile Manager — Browser-based quota scraping via Playwright
 *
 * Key concepts from google-flow-mcp:
 * - Uses Playwright to connect to existing Chrome profile with stored cookies
 * - Maintains persistent session across runs
 * - Bypasses anti-bot measures by launching Chrome directly
 *
 * This enables scraping JavaScript-rendered pages that require authentication:
 * - chatgpt.com/codex/cloud/settings/analytics
 * - z.ai/manage-apikey/coding-plan/personal/usage
 * - etc.
 */
export interface ChromeProfileConfig {
    /** Provider name (e.g., "codex", "z-ai") */
    provider: string;
    /** Path to Chrome user data directory (auto-detected if not provided) */
    userDataDir?: string;
    /** Profile directory name within userDataDir */
    profileName?: string;
    /** Path to browser binary (auto-detected if not provided) */
    binaryPath?: string;
    /** Arguments to pass to Chrome */
    extraArgs?: string[];
    /** Headless mode (default: true for scraping) */
    headless?: boolean;
    /** Launch timeout in ms */
    launchTimeout?: number;
}
export interface BrowserProfile {
    /** Path to the profile directory */
    profilePath: string;
    /** Provider name */
    provider: string;
    /** Whether the profile exists */
    exists: boolean;
    /** Last used timestamp */
    lastUsed?: number;
}
/** Auto-detect Chrome user data directory based on OS */
export declare function detectChromeUserDataDir(): string | null;
/** Auto-detect Chrome binary path */
export declare function detectChromeBinary(): string | null;
/**
 * Chrome Profile Manager for browser-based scraping
 *
 * Manages Chrome profiles for different providers to maintain
 * authenticated sessions across scraping runs.
 */
export declare class ChromeProfileManager {
    private profilesDir;
    private profiles;
    constructor(profilesDir?: string);
    private ensureProfilesDir;
    private getProfileMetaPath;
    private loadProfiles;
    /**
     * Get profile path for a provider
     */
    getProfilePath(provider: string): string;
    /**
     * Ensure profile directory exists
     */
    ensureProfile(provider: string): BrowserProfile;
    private saveProfileMeta;
    /**
     * List all managed profiles
     */
    listProfiles(): BrowserProfile[];
    /**
     * Delete a profile
     */
    deleteProfile(provider: string): Promise<void>;
    /**
     * Get Chrome launch arguments for anti-bot evasion
     * Based on google-flow-mcp approach
     */
    getLaunchArgs(config: ChromeProfileConfig): string[];
}
export declare function getChromeProfileManager(): ChromeProfileManager;
//# sourceMappingURL=chrome-profile-manager.d.ts.map