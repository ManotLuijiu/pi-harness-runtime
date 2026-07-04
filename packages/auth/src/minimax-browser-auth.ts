/**
 * minimax-browser-auth.ts
 *
 * MiniMax browser authentication using persistent Playwright profile.
 *
 * SECURITY RULES:
 * - Human owns authentication. Agent never receives credentials.
 * - No username, password, raw cookies, or session tokens stored.
 * - Playwright persistent profile saves browser session automatically.
 * - Profile is stored at ~/.pi-harness-runtime/browser-profiles/minimax/
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
	profile_path: string;
	error_message?: string;
}

export interface MinimaxBrowserAuthConfig {
	profilePath?: string;
	statusPath?: string;
	targetUrl?: string;
}

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
	"coding_plan",
	"subscription",
];

export function getRuntimeDir(): string {
	return path.join(os.homedir(), ".pi-harness-runtime");
}

export function getProfileDir(): string {
	return path.join(getRuntimeDir(), "browser-profiles", "minimax");
}

export function getStatusPath(): string {
	return path.join(getRuntimeDir(), "auth", "minimax-auth-status.json");
}

function ensureDirs(config: MinimaxBrowserAuthConfig): void {
	const profileDir = config.profilePath ?? getProfileDir();
	const statusPath = config.statusPath ?? getStatusPath();
	fs.mkdirSync(path.dirname(profileDir), { recursive: true });
	fs.mkdirSync(path.dirname(statusPath), { recursive: true });
}

export function saveAuthStatus(
	status: MinimaxAuthStatus,
	config?: MinimaxBrowserAuthConfig,
): void {
	const statusPath = config?.statusPath ?? getStatusPath();
	ensureDirs(config ?? {});
	fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
}

export function detectUsagePage(bodyText: string): {
	detected: boolean;
	sample: string | null;
} {
	const words = DEFAULT_USAGE_KEYWORDS.map((k) => k.toLowerCase());
	const lowerText = bodyText.toLowerCase();
	const foundKeywords = words.filter((w) => lowerText.includes(w));
	const detected = foundKeywords.length >= 2;
	const sample = detected
		? bodyText.substring(0, 200).replace(/\s+/g, " ").trim()
		: null;
	return { detected, sample };
}

/**
 * Launch persistent browser - profile is saved automatically
 * Reusing the profile means user stays logged in
 */
export async function authenticateWithPersistentBrowser(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxAuthStatus> {
	const profileDir = config.profilePath ?? getProfileDir();
	const targetUrl =
		config.targetUrl ?? "https://platform.minimax.io/console/usage";

	ensureDirs(config);

	console.log("=".repeat(60));
	console.log("🔐 MiniMax Browser Authentication (Persistent Mode)");
	console.log("=".repeat(60));
	console.log("");
	console.log("SECURITY: Human owns authentication.");
	console.log("- Login once, profile is saved for reuse");
	console.log("");
	console.log(`Profile directory: ${profileDir}`);
	console.log("");

	let context: BrowserContext | null = null;

	try {
		// Check if profile exists (user already logged in)
		const isFirstRun = !fs.existsSync(path.join(profileDir, "SingletonLock"));

		// Launch persistent context - profile auto-saves!
		console.log("🚀 Launching persistent browser...");
		if (isFirstRun) {
			console.log("   First run - creating new profile");
		} else {
			console.log("   Reusing existing profile (you stay logged in)");
		}
		console.log("");

		context = await chromium.launchPersistentContext(profileDir, {
			headless: false,
			chromiumSandbox: false,
			args: ["--no-first-run", "--no-default-browser-check"],
			viewport: { width: 1280, height: 800 },
		});

		const page = context.pages()[0] ?? (await context.newPage());

		// Navigate to MiniMax
		console.log("🖥️  Navigating to MiniMax...");
		await page.goto(targetUrl, {
			waitUntil: "domcontentloaded",
			timeout: 15000,
		});
		await page.waitForTimeout(2000);

		const initialUrl = page.url();
		console.log(`   Current URL: ${initialUrl}`);
		console.log("");

		// If redirected to login, wait for user to log in via MiniMax
		if (initialUrl.includes("login") || initialUrl.includes("unified-login")) {
			console.log(
				"🔓 Login required - please log in to MiniMax in the browser window",
			);
			console.log("   (Profile will auto-save when you navigate)");
			console.log("");
			console.log("⏳ Waiting for login to complete (poll URL every 2s)...");
			console.log("   Close browser or press Ctrl+C to cancel");
			console.log("");

			// Poll URL until it changes to usage page (or timeout)
			const startTime = Date.now();
			const timeout = 300000; // 5 minutes
			let loginComplete = false;

			while (!loginComplete && Date.now() - startTime < timeout) {
				await page.waitForTimeout(2000); // Check every 2 seconds
				const currentUrl = page.url();

				// Check if URL changed away from login
				if (
					!currentUrl.includes("login") &&
					!currentUrl.includes("unified-login")
				) {
					loginComplete = true;
					console.log("✅ Login detected!");
					console.log(`   New URL: ${currentUrl}`);
				}

				// Check if browser was closed
				if (context.pages().length === 0) {
					console.log("Browser closed by user.");
					return {
						provider: "minimax" as const,
						authenticated: false,
						checked_at: new Date().toISOString(),
						page_url: "",
						detected_text_sample: null,
						profile_path: profileDir,
						error_message: "Browser closed by user",
					};
				}
			}

			if (!loginComplete) {
				console.log("⏰ 5 min timeout reached");
			}
			}

			// Extract usage data from current page
			console.log("");
			console.log("📊 Extracting usage data...");

			// Wait for page to fully load (no need to goto again - we're already there)
			await page.waitForLoadState("networkidle", { timeout: 30000 });
			await page.waitForTimeout(3000); // Extra wait for JS to render

		const url = page.url();
		const bodyText = (await page.textContent("body")) ?? "";
		const { detected, sample } = detectUsagePage(bodyText);

		console.log("");
		console.log(`   URL: ${url}`);
		console.log(`   Detected usage page: ${detected}`);
		if (sample) {
			console.log(`   Sample: ${sample.substring(0, 100)}...`);
		}
		console.log("");

		// Profile is auto-saved by Playwright - no manual save needed
		console.log("💾 Profile auto-saved to:");
		console.log(`   ${profileDir}`);
		console.log("");

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: detected,
			checked_at: new Date().toISOString(),
			page_url: url,
			detected_text_sample: sample,
			profile_path: profileDir,
		};

		saveAuthStatus(status, config);

		if (detected) {
			console.log("✅ Authentication successful!");
		} else {
			console.log("⚠️  Could not verify usage page. Try again after login.");
		}

		// Close browser
		await context.close();
		context = null;

		return status;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`❌ Error: ${errorMessage}`);

		if (context) {
			await context.close().catch(() => {});
		}

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			profile_path: profileDir,
			error_message: errorMessage,
		};

		saveAuthStatus(status, config);
		return status;
	}
}

/**
 * Use existing profile to scrape usage data (no browser window)
 */
export async function scrapeWithExistingProfile(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxAuthStatus> {
	const profileDir = config.profilePath ?? getProfileDir();
	const targetUrl =
		config.targetUrl ?? "https://platform.minimax.io/console/usage";

	ensureDirs(config);

	console.log("=".repeat(60));
	console.log("📊 MiniMax Usage Scraper (Silent Mode)");
	console.log("=".repeat(60));
	console.log("");

	// Check if profile exists
	const profileExists = fs.existsSync(path.join(profileDir, "SingletonLock"));
	if (!profileExists) {
		console.log("⚠️  No profile found. Run auth first:");
		console.log("   bun packages/auth/src/run-minimax-auth.ts auth");
		return {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			profile_path: profileDir,
			error_message: "No profile found - run auth first",
		};
	}

	let context: BrowserContext | null = null;

	try {
		// Launch with existing profile (headless for scraping)
		console.log("🚀 Launching browser with saved profile...");
		console.log("   (Silent/headless mode for scraping)");

		context = await chromium.launchPersistentContext(profileDir, {
			headless: true, // Silent mode for scraping
			chromiumSandbox: false,
			args: ["--no-first-run", "--no-default-browser-check"],
			viewport: { width: 1280, height: 800 },
		});

		const page = context.pages()[0] ?? (await context.newPage());

		// Navigate to usage
		console.log("🖥️  Navigating to usage page...");
		await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
		await page.waitForTimeout(2000);

		const url = page.url();
		const bodyText = (await page.textContent("body")) ?? "";
		const { detected, sample } = detectUsagePage(bodyText);

		console.log("");
		console.log(`   URL: ${url}`);
		console.log(`   Detected usage page: ${detected}`);

		// Extract all numbers/percentages
		const usageData: string[] = [];
		const elements = await page.$$("body *");
		for (const el of elements.slice(0, 300)) {
			const text = await el.textContent();
			if (
				text &&
				(text.includes("%") ||
					text.match(/\d+\s*[/:]\s*\d+/) ||
					(/^\d+$/.test(text.trim()) && text.length < 10))
			) {
				const clean = text.trim().substring(0, 50);
				if (!usageData.includes(clean)) {
					usageData.push(clean);
				}
			}
		}

		if (usageData.length > 0) {
			console.log("");
			console.log("📊 Usage Data Found:");
			usageData.slice(0, 15).forEach((item) => {
				console.log(`   - ${item}`);
			});
		}

		console.log("");

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: detected,
			checked_at: new Date().toISOString(),
			page_url: url,
			detected_text_sample: sample,
			profile_path: profileDir,
		};

		saveAuthStatus(status, config);

		if (detected) {
			console.log("✅ Scraped successfully!");
		}

		await context.close();
		context = null;

		return status;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`❌ Error: ${errorMessage}`);

		if (context) {
			await context.close().catch(() => {});
		}

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			profile_path: profileDir,
			error_message: errorMessage,
		};

		saveAuthStatus(status, config);
		return status;
	}
}

/**
 * Check auth status
 */
export async function checkAuthStatus(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxAuthStatus> {
	const statusPath = config.statusPath ?? getStatusPath();
	const profileDir = config.profilePath ?? getProfileDir();

	console.log("Checking MiniMax authentication status...");

	if (fs.existsSync(statusPath)) {
		const content = fs.readFileSync(statusPath, "utf-8");
		try {
			const status = JSON.parse(content) as MinimaxAuthStatus;
			console.log("");
			console.log(
				status.authenticated
					? "✅ User is logged in"
					: "⚠️  User is NOT logged in",
			);
			console.log(`   Last checked: ${status.checked_at}`);
			console.log(`   Profile: ${status.profile_path}`);
			return status;
		} catch {
			console.log("Invalid status file. Run auth first.");
		}
	}

	const profileExists = fs.existsSync(path.join(profileDir, "SingletonLock"));
	if (profileExists) {
		console.log("");
		console.log("✅ Profile exists - run 'scrape' to check usage");
		return {
			provider: "minimax",
			authenticated: true,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			profile_path: profileDir,
		};
	}

	console.log("No profile found. Run auth first.");
	return {
		provider: "minimax",
		authenticated: false,
		checked_at: new Date().toISOString(),
		page_url: "",
		detected_text_sample: null,
		profile_path: profileDir,
		error_message: "No profile found - run auth first",
	};
}

// Alias for backward compatibility
export const authenticateWithCurator = authenticateWithPersistentBrowser;
