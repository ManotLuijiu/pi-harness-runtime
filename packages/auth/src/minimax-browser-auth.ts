/**
 * minimax-browser-auth.ts
 *
 * Safe MiniMax browser authentication prototype.
 *
 * SECURITY RULES:
 * - Human owns authentication. Agent never receives credentials.
 * - No username, password, raw cookies, or session tokens stored.
 * - Only a safe status file with authentication state.
 *
 * Profile stored at: ~/.pi-harness-runtime/browser-profiles/minimax
 * Status stored at: ~/.pi-harness-runtime/auth/minimax-auth-status.json
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { chromium, type BrowserContext } from "playwright";

export interface MinimaxAuthStatus {
	provider: "minimax";
	authenticated: boolean;
	checked_at: string;
	page_url: string;
	detected_text_sample: string | null;
	error_message?: string;
}

export interface MinimaxBrowserAuthConfig {
	profilePath?: string;
	statusPath?: string;
	targetUrl?: string;
	usageKeywords?: string[];
}

/** Keywords that indicate the usage page is visible after login */
const DEFAULT_USAGE_KEYWORDS = [
	"Usage",
	"Token",
	"Plan",
	"Credits",
	"Reset",
	"Limit",
	"5h",
	"Weekly",
	"quota",
	"used",
];

/** Get the root directory for pi-harness-runtime data */
export function getRuntimeDir(): string {
	return path.join(os.homedir(), ".pi-harness-runtime");
}

/** Get the browser profile directory */
export function getProfileDir(): string {
	return path.join(getRuntimeDir(), "browser-profiles", "minimax");
}

/** Get the auth status file path */
export function getStatusPath(): string {
	return path.join(getRuntimeDirDir(), "auth", "minimax-auth-status.json");
}

// Alias for typo fix
function getRuntimeDirDir(): string {
	return getRuntimeDir();
}

/** Ensure directories exist */
function ensureDirs(config: MinimaxBrowserAuthConfig): void {
	const profileDir = config.profilePath ?? getProfileDir();
	const statusPath = config.statusPath ?? getStatusPath();

	fs.mkdirSync(path.dirname(profileDir), { recursive: true });
	fs.mkdirSync(path.dirname(statusPath), { recursive: true });
}

/** Save authentication status (safe data only) */
export function saveAuthStatus(
	status: MinimaxAuthStatus,
	config?: MinimaxBrowserAuthConfig
): void {
	const statusPath = config?.statusPath ?? getStatusPath();
	ensureDirs(config ?? {});

	// SECURITY: Never log the status content with secrets
	fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
	console.log(`Status saved to: ${statusPath}`);
}

/** Check if the page contains usage-related text */
export function detectUsagePage(
	bodyText: string,
	keywords?: string[]
): { detected: boolean; sample: string | null } {
	const words = (keywords ?? DEFAULT_USAGE_KEYWORDS).map((k) =>
		k.toLowerCase()
	);
	const lowerText = bodyText.toLowerCase();

	const foundKeywords = words.filter((w) => lowerText.includes(w));
	const detected = foundKeywords.length >= 2; // Require at least 2 keywords

	// Get a sample of the detected text
	let sample: string | null = null;
	if (detected) {
		const previewLength = 200;
		sample = bodyText
			.substring(0, previewLength)
			.replace(/\s+/g, " ")
			.trim();
	}

	return { detected, sample };
}

/**
 * Open a headed browser for manual MiniMax login.
 * Returns when the usage page is detected or user cancels.
 *
 * SECURITY NOTES:
 * - Browser is persistent so login persists across runs
 * - No credentials are accessed by this code
 * - Only a safe status file is written
 */
export async function authenticateWithBrowser(
	config: MinimaxBrowserAuthConfig = {}
): Promise<MinimaxAuthStatus> {
	const profileDir =
		config.profilePath ?? getProfileDir();
	const statusPath = config?.statusPath ?? getStatusPath();
	const targetUrl =
		config.targetUrl ?? "https://platform.minimax.io/console/usage";
	const keywords = config.usageKeywords ?? DEFAULT_USAGE_KEYWORDS;

	ensureDirs(config);

	console.log("=".repeat(60));
	console.log("MiniMax Browser Authentication Prototype");
	console.log("=".repeat(60));
	console.log("");
	console.log("SECURITY: Human owns authentication.");
	console.log("- Do NOT enter credentials here");
	console.log("- Browser will open with the MiniMax usage page");
	console.log("- Log in manually in the browser window");
	console.log("");
	console.log(`Profile directory: ${profileDir}`);
	console.log(`Status file: ${statusPath}`);
	console.log(`Target URL: ${targetUrl}`);
	console.log("");
	console.log("Starting browser...");
	console.log("");

	let context: BrowserContext | null = null;

	try {
		// Launch persistent browser context
		// Using headed mode (headless: false) so human can see/interact
		context = await chromium.launchPersistentContext(profileDir, {
			headless: false,
			viewport: { width: 1280, height: 800 },
			// NOTE: We intentionally do NOT use args to access Chrome's cookies
			// This is a fresh Playwright-managed profile
			args: [
				"--disable-extensions",
				"--disable-background-networking",
			],
		});

		const page = context.pages()[0] || (await context.newPage());

		// Navigate to MiniMax usage page
		console.log("Opening MiniMax usage page...");
		await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

		// Wait a bit for any initial load
		await page.waitForTimeout(2000);

		// Check if this is a login page or usage page
		const url = page.url();
		console.log(`Current URL: ${url}`);

		// Get body text
		const bodyText = await page.textContent("body").catch(() => "");
		const { detected, sample } = detectUsagePage(bodyText, keywords);

		if (detected) {
			// Usage page is visible - user is logged in
			console.log("");
			console.log("✅ Authentication successful!");
			console.log("Usage page detected.");

			const status: MinimaxAuthStatus = {
				provider: "minimax",
				authenticated: true,
				checked_at: new Date().toISOString(),
				page_url: url,
				detected_text_sample: sample,
			};

			saveAuthStatus(status, config);
			console.log("");

			// Close browser
			await context.close();

			return status;
		}

		// Not logged in yet - prompt user
		console.log("");
		console.log("🔐 Login required.");
		console.log("");
		console.log(
			"Please finish login in the opened browser window,"
		);
		console.log("then press Enter in this terminal.");
		console.log("");
		console.log("(Browser will stay open until you press Enter)");
		console.log("");
		console.log("Or press Ctrl+C to cancel.");

		// Wait for user to press Enter
		await new Promise<void>((resolve) => {
			process.stdin.once("data", () => {
				console.log("");
				console.log("Resuming authentication check...");
				resolve();
			});
		});

		// Re-check the page
		const newBodyText = await page
			.textContent("body")
			.catch(() => "");
		const newUrl = page.url();
		const { detected: newDetected, sample: newSample } =
			detectUsagePage(newBodyText, keywords);

		if (newDetected) {
			console.log("");
			console.log("✅ Authentication successful!");

			const status: MinimaxAuthStatus = {
				provider: "minimax",
				authenticated: true,
				checked_at: new Date().toISOString(),
				page_url: newUrl,
				detected_text_sample: newSample,
			};

			saveAuthStatus(status, config);

			await context.close();
			return status;
		} else {
			console.log("");
			console.log("⚠️  Could not verify login.");
			console.log(
				"Please try again or use manual /usage sync."
			);

			const status: MinimaxAuthStatus = {
				provider: "minimax",
				authenticated: false,
				checked_at: new Date().toISOString(),
				page_url: newUrl,
				detected_text_sample: null,
				error_message:
					"Could not verify usage page after manual login attempt",
			};

			saveAuthStatus(status, config);

			await context.close();
			return status;
		}
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);

		console.error(`❌ Browser error: ${errorMessage}`);

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			error_message: errorMessage,
		};

		saveAuthStatus(status, config);

		if (context) {
			await context.close().catch(() => {});
		}

		return status;
	}
}

/** Check current authentication status */
export async function checkAuthStatus(
	config: MinimaxBrowserAuthConfig = {}
): Promise<MinimaxAuthStatus> {
	const profileDir = config.profilePath ?? getProfileDir();
	const targetUrl =
		config.targetUrl ?? "https://platform.minimax.io/console/usage";
	const keywords = config.usageKeywords ?? DEFAULT_USAGE_KEYWORDS;

	console.log("Checking MiniMax authentication status...");

	let context: BrowserContext | null = null;

	try {
		// Check if profile exists
		if (!fs.existsSync(profileDir)) {
			console.log("No browser profile found. Authentication required.");
			return {
				provider: "minimax",
				authenticated: false,
				checked_at: new Date().toISOString(),
				page_url: "",
				detected_text_sample: null,
				error_message: "No browser profile found",
			};
		}

		// Launch existing profile
		context = await chromium.launchPersistentContext(profileDir, {
			headless: false,
			viewport: { width: 1280, height: 800 },
			args: ["--disable-extensions"],
		});

		const page = context.pages()[0] || (await context.newPage());

		await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(2000);

		const url = page.url();
		const bodyText = await page.textContent("body").catch(() => "");
		const { detected, sample } = detectUsagePage(bodyText, keywords);

		console.log("");
		console.log(
			detected
				? "✅ User is logged in"
				: "⚠️  User is NOT logged in"
		);

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: detected,
			checked_at: new Date().toISOString(),
			page_url: url,
			detected_text_sample: sample,
		};

		saveAuthStatus(status, config);

		await context.close();
		return status;
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : String(error);

		console.error(`❌ Error: ${errorMessage}`);

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			error_message: errorMessage,
		};

		saveAuthStatus(status, config);

		if (context) {
			await context.close().catch(() => {});
		}

		return status;
	}
}
