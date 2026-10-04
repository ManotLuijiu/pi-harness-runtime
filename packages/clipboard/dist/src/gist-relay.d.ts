/**
 * Gist Relay — GitHub Gist clipboard sync
 *
 * Stores clipboard content in a secret Gist, accessible from any device.
 * - POST: Upload clipboard content to Gist
 * - GET:  Download latest clipboard content from Gist
 *
 * Security: Uses secret Gist (only accessible via API token)
 */
interface GistConfig {
    token: string;
    gistId: string;
    gistUrl: string;
}
/**
 * Check if Gist relay is configured
 */
export declare function isConfigured(): boolean;
/**
 * Get stored GitHub token
 */
export declare function getToken(): string | null;
/**
 * Store GitHub token and Gist ID after initial setup
 */
export declare function saveCredentials(token: string, gistId: string, gistUrl: string): void;
/**
 * Create a new secret Gist and return its ID
 */
export declare function createGist(token: string, content: string): Promise<GistConfig | null>;
/**
 * Update existing Gist with new clipboard content
 */
export declare function updateGist(content: string): Promise<boolean>;
/**
 * Fetch current clipboard content from Gist
 */
export declare function fetchFromGist(): Promise<string | null>;
/**
 * Post clipboard content to Gist. Creates Gist on first call, updates on subsequent calls.
 */
export declare function postToGist(content: string): Promise<boolean>;
/**
 * Delete stored Gist config (for reset)
 */
export declare function clearConfig(): void;
export {};
//# sourceMappingURL=gist-relay.d.ts.map