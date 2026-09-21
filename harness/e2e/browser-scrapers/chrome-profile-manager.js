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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
/** Auto-detect Chrome user data directory based on OS */
export function detectChromeUserDataDir() {
    const home = homedir();
    const os = process.platform;
    if (os === "linux") {
        // Common Chrome Linux locations
        const candidates = [
            join(home, ".config", "google-chrome"),
            join(home, ".config", "chromium"),
            join(home, ".config", "google-chrome", "Default"),
        ];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return dirname(candidate);
            }
        }
        // Return default without checking
        return join(home, ".config", "google-chrome");
    }
    if (os === "darwin") {
        return join(home, "Library", "Application Support", "Google", "Chrome");
    }
    if (os === "win32") {
        const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
        return join(localAppData, "Google", "Chrome", "User Data");
    }
    return null;
}
/** Auto-detect Chrome binary path */
export function detectChromeBinary() {
    const os = process.platform;
    if (os === "linux") {
        const candidates = [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/snap/bin/chromium",
        ];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate;
            }
        }
    }
    if (os === "darwin") {
        const candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        ];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate;
            }
        }
    }
    if (os === "win32") {
        const programFiles = process.env["ProgramFiles"] ?? "C:\\Program Files";
        const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
        const candidates = [
            join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
            join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
            join(programFiles, "Chromium", "Application", "chrome.exe"),
        ];
        for (const candidate of candidates) {
            if (existsSync(candidate)) {
                return candidate;
            }
        }
    }
    return null;
}
/**
 * Chrome Profile Manager for browser-based scraping
 *
 * Manages Chrome profiles for different providers to maintain
 * authenticated sessions across scraping runs.
 */
export class ChromeProfileManager {
    profilesDir;
    profiles = new Map();
    constructor(profilesDir) {
        this.profilesDir =
            profilesDir ?? join(homedir(), ".pi-harness-runtime", "browser-profiles");
        this.ensureProfilesDir();
        this.loadProfiles();
    }
    ensureProfilesDir() {
        if (!existsSync(this.profilesDir)) {
            mkdirSync(this.profilesDir, { recursive: true });
        }
    }
    getProfileMetaPath(provider) {
        return join(this.profilesDir, `${provider}.meta.json`);
    }
    loadProfiles() {
        if (!existsSync(this.profilesDir))
            return;
        const { readdirSync } = require("node:fs");
        const entries = readdirSync(this.profilesDir);
        for (const entry of entries) {
            if (entry.endsWith(".meta.json")) {
                const provider = entry.replace(".meta.json", "");
                const metaPath = this.getProfileMetaPath(provider);
                try {
                    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
                    this.profiles.set(provider, meta);
                }
                catch {
                    // Skip invalid meta files
                }
            }
        }
    }
    /**
     * Get profile path for a provider
     */
    getProfilePath(provider) {
        return join(this.profilesDir, provider);
    }
    /**
     * Ensure profile directory exists
     */
    ensureProfile(provider) {
        const profilePath = this.getProfilePath(provider);
        if (!existsSync(profilePath)) {
            mkdirSync(profilePath, { recursive: true });
        }
        const profile = {
            profilePath,
            provider,
            exists: true,
            lastUsed: Date.now(),
        };
        this.saveProfileMeta(profile);
        this.profiles.set(provider, profile);
        return profile;
    }
    saveProfileMeta(profile) {
        const metaPath = this.getProfileMetaPath(profile.provider);
        writeFileSync(metaPath, JSON.stringify(profile, null, 2));
    }
    /**
     * List all managed profiles
     */
    listProfiles() {
        return Array.from(this.profiles.values());
    }
    /**
     * Delete a profile
     */
    async deleteProfile(provider) {
        const { rmSync } = await import("node:fs");
        const profilePath = this.getProfilePath(provider);
        if (existsSync(profilePath)) {
            rmSync(profilePath, { recursive: true, force: true });
        }
        const metaPath = this.getProfileMetaPath(provider);
        if (existsSync(metaPath)) {
            rmSync(metaPath, { force: true });
        }
        this.profiles.delete(provider);
    }
    /**
     * Get Chrome launch arguments for anti-bot evasion
     * Based on google-flow-mcp approach
     */
    getLaunchArgs(config) {
        const args = [
            // Disable automation flags
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
            // Disable extensions
            "--disable-extensions",
            // Disable background networking
            "--disable-background-networking",
            // Disable background threading
            "--disable-background-timer-throttling",
            // Disable background render
            "--disable-renderer-backgrounding",
            // Disable background occluded windows
            "--disable-backgrounding-occluded-windows",
            // Disable crash reporter
            "--disable-crash-reporter",
            // Disable logging
            "--disable-logging",
            // Disable devtools sharing
            "--disable-dev-shm-usage",
            // Disable Chrome sandbox (needed in some environments)
            // "--no-sandbox", // Uncomment if running in Docker without sandbox
        ];
        // Add user data dir if using managed profile
        if (!config.userDataDir && config.profileName) {
            // Use our managed profile directory
            args.push(`--user-data-dir=${this.getProfilePath(config.provider)}`);
        }
        else if (config.userDataDir) {
            // Use external Chrome user data dir
            args.push(`--user-data-dir=${config.userDataDir}`);
            if (config.profileName) {
                args.push(`--profile-directory=${config.profileName}`);
            }
        }
        // Add extra args
        if (config.extraArgs) {
            args.push(...config.extraArgs);
        }
        return args;
    }
}
/**
 * Default Chrome profile manager instance
 */
let defaultManager = null;
export function getChromeProfileManager() {
    if (!defaultManager) {
        defaultManager = new ChromeProfileManager();
    }
    return defaultManager;
}
//# sourceMappingURL=chrome-profile-manager.js.map