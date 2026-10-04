/**
 * minimax-browser-auth.ts
 *
 * MiniMax browser authentication using a real Chrome profile.
 *
 * SECURITY RULES:
 * - Human owns authentication. Agent never receives credentials.
 * - No username, password, raw cookies, or session tokens stored.
 * - Real Chrome owns the login flow via a persistent profile.
 * - Profile is stored at ~/.pi-harness-runtime/browser-profiles/minimax/
 */
export interface MinimaxAuthStatus {
    provider: "minimax";
    authenticated: boolean;
    checked_at: string;
    page_url: string;
    detected_text_sample: string | null;
    profile_path: string;
    usage_lines?: string[];
    error_message?: string;
}
export interface MinimaxBrowserAuthConfig {
    profilePath?: string;
    statusPath?: string;
    targetUrl?: string;
    chromeExecutablePath?: string;
    authTimeoutMs?: number;
    headless?: boolean;
    cdpPort?: number;
    /** Suppress console output for background/runtime-driven scrapes. */
    quiet?: boolean;
    /** Override live session detection — used by tests to bypass real daemon. */
    forceNoLiveSession?: boolean;
}
export declare function getRuntimeDir(): string;
export declare function getProfileDir(): string;
export declare function getStatusPath(): string;
export interface MinimaxLiveBrowserSession {
    profile_path: string;
    target_url: string;
    chrome_path: string;
    debugging_port: number;
    pid: number;
    started_at: string;
}
export declare function getLiveSessionPath(): string;
export declare function saveAuthStatus(status: MinimaxAuthStatus, config?: MinimaxBrowserAuthConfig): void;
export declare function loadLiveBrowserSession(liveSessionPath?: string): MinimaxLiveBrowserSession | null;
export declare function detectUsagePage(bodyText: string): {
    detected: boolean;
    sample: string | null;
};
/**
 * Manual authentication flow: launches real Chrome so Google login works,
 * waits for user to sign in, then confirms at the TTY.
 */
export declare function authenticateWithPersistentBrowser(config?: MinimaxBrowserAuthConfig): Promise<MinimaxAuthStatus>;
/**
 * Extract usage-relevant lines from page body text.
 * Splits on newlines AND HTML tag boundaries, then filters for keywords.
 */
export declare function extractUsageLines(bodyText: string): string[];
/**
 * Scrape usage data by attaching to a live browser session (via Node CDP).
 * Writes attach script to a temp .js file to avoid shell escaping issues.
 */
export declare function scrapeViaLiveBrowserSession(config?: MinimaxBrowserAuthConfig): Promise<MinimaxAuthStatus>;
/**
 * Start a persistent browser daemon (keep-open mode).
 * Launches real Chrome with --remote-debugging-port and saves session.
 */
export declare function startPersistentBrowserDaemon(config?: MinimaxBrowserAuthConfig): Promise<MinimaxLiveBrowserSession>;
/**
 * Stop the persistent browser daemon.
 */
export declare function stopPersistentBrowserDaemon(_config?: MinimaxBrowserAuthConfig): Promise<boolean>;
/**
 * Get active live browser session info.
 */
export declare function getActiveLiveBrowserSession(): MinimaxLiveBrowserSession | null;
/**
 * Scrape usage data. Tries live session first, falls back to headless Playwright.
 */
export declare function scrapeWithExistingProfile(config?: MinimaxBrowserAuthConfig): Promise<MinimaxAuthStatus>;
/**
 * Check auth status.
 */
export declare function checkAuthStatus(config?: MinimaxBrowserAuthConfig): Promise<MinimaxAuthStatus>;
//# sourceMappingURL=minimax-browser-auth.d.ts.map