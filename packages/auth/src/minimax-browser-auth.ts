/**
 * minimax-browser-auth.ts
 *
 * MiniMax browser authentication using a real Chrome profile.
 *
 * SECURITY RULES:
 * - Human owns authentication. Agent never receives credentials.
 * - No username, password, raw cookies, or session tokens stored.
 * - Real Chrome owns the login flow; Playwright only monitors via CDP.
 * - Profile is stored at ~/.pi-harness-runtime/browser-profiles/minimax/
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
} from "playwright";

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
	chromeExecutablePath?: string;
	cdpPort?: number;
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

const DEFAULT_AUTH_TIMEOUT_MS = 300000;

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasProfileData(profileDir: string): boolean {
	if (!fs.existsSync(profileDir)) {
		return false;
	}

	const markers = [
		path.join(profileDir, "Local State"),
		path.join(profileDir, "First Run"),
		path.join(profileDir, "Default", "Preferences"),
		path.join(profileDir, "Default", "Cookies"),
		path.join(profileDir, "Default", "History"),
	];

	if (markers.some((marker) => fs.existsSync(marker))) {
		return true;
	}

	try {
		return fs.readdirSync(profileDir).length > 0;
	} catch {
		return false;
	}
}

function getChromeExecutablePath(
	config: MinimaxBrowserAuthConfig = {},
): string {
	const configuredPath =
		config.chromeExecutablePath ??
		process.env.PI_HARNESS_CHROME_PATH ??
		process.env.GOOGLE_CHROME_BIN ??
		process.env.CHROME_PATH;

	const candidates = configuredPath ? [configuredPath] : [];

	switch (process.platform) {
		case "darwin":
			candidates.push(
				"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
				"/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
			);
			break;
		case "win32":
			candidates.push(
				"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
				"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
				path.join(
					process.env.LOCALAPPDATA ?? "",
					"Google",
					"Chrome",
					"Application",
					"chrome.exe",
				),
			);
			break;
		default:
			candidates.push(
				"/usr/bin/google-chrome",
				"/usr/bin/google-chrome-stable",
				"/snap/bin/google-chrome",
			);
	}

	for (const candidate of candidates) {
		if (candidate && fs.existsSync(candidate)) {
			return candidate;
		}
	}

	throw new Error(
		"Google Chrome executable not found. Install Google Chrome or set PI_HARNESS_CHROME_PATH.",
	);
}

function getChromeArgs(): string[] {
	const args = ["--no-first-run", "--no-default-browser-check"];

	if (process.platform === "linux") {
		args.push("--password-store=basic");
	}

	return args;
}

async function getFreePort(preferredPort?: number): Promise<number> {
	if (preferredPort) {
		return preferredPort;
	}

	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Could not allocate a Chrome debugging port"));
				return;
			}

			const { port } = address;
			server.close((closeError) => {
				if (closeError) {
					reject(closeError);
					return;
				}
				resolve(port);
			});
		});
	});
}

async function connectToChromeOverCdp(
	port: number,
	timeoutMs = 15000,
): Promise<Browser> {
	const endpoint = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			return await chromium.connectOverCDP(endpoint);
		} catch (error) {
			lastError = error;
			await delay(500);
		}
	}

	throw new Error(
		`Could not connect to Chrome DevTools at ${endpoint}: ${String(lastError)}`,
	);
}

function getCurrentPage(context: BrowserContext): Page | null {
	const pages = context.pages().filter((page) => !page.isClosed());
	return pages.length > 0 ? pages[pages.length - 1] : null;
}

async function waitForPage(
	context: BrowserContext,
	timeoutMs = 15000,
): Promise<Page> {
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		const page = getCurrentPage(context);
		if (page) {
			return page;
		}
		await delay(250);
	}

	throw new Error("Chrome launched but no page became available");
}

async function closeBrowserResources(
	browser: Browser | null,
	chromeProcess: ChildProcess | null,
): Promise<void> {
	if (browser) {
		await browser.close().catch(() => {});
	}

	if (
		chromeProcess &&
		chromeProcess.exitCode === null &&
		!chromeProcess.killed
	) {
		chromeProcess.kill("SIGTERM");
	}
}

async function launchChromeForAuthentication(
	profileDir: string,
	targetUrl: string,
	config: MinimaxBrowserAuthConfig,
): Promise<{
	browser: Browser;
	context: BrowserContext;
	chromeProcess: ChildProcess;
	chromePath: string;
	cdpPort: number;
}> {
	const chromePath = getChromeExecutablePath(config);
	const cdpPort = await getFreePort(config.cdpPort);
	const chromeArgs = [
		`--remote-debugging-port=${cdpPort}`,
		`--user-data-dir=${profileDir}`,
		"--new-window",
		...getChromeArgs(),
		targetUrl,
	];

	// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
	const chromeProcess = spawn(chromePath, chromeArgs, {
		stdio: "ignore",
	});

	const browser = await connectToChromeOverCdp(cdpPort);
	const context = browser.contexts()[0];
	if (!context) {
		await closeBrowserResources(browser, chromeProcess);
		throw new Error(
			"Connected to Chrome, but no browser context was available",
		);
	}

	return {
		browser,
		context,
		chromeProcess,
		chromePath,
		cdpPort,
	};
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

	let browser: Browser | null = null;
	let context: BrowserContext | null = null;
	let chromeProcess: ChildProcess | null = null;

	try {
		const isFirstRun = !hasProfileData(profileDir);

		console.log("🚀 Launching real Google Chrome...");
		if (isFirstRun) {
			console.log("   First run - creating new Chrome profile");
		} else {
			console.log("   Reusing existing Chrome profile");
		}

		const launched = await launchChromeForAuthentication(
			profileDir,
			targetUrl,
			config,
		);
		browser = launched.browser;
		context = launched.context;
		chromeProcess = launched.chromeProcess;

		console.log(`   Chrome: ${launched.chromePath}`);
		console.log(`   DevTools port: ${launched.cdpPort}`);
		console.log("");
		console.log("🖥️  Waiting for MiniMax / Google login flow...");

		let page = await waitForPage(context, 15000);
		await page
			.waitForLoadState("domcontentloaded", { timeout: 15000 })
			.catch(() => {});

		let loginComplete = false;
		let lastLoggedUrl = "";
		let loginHintShown = false;
		const startTime = Date.now();

		while (Date.now() - startTime < DEFAULT_AUTH_TIMEOUT_MS) {
			page = getCurrentPage(context) ?? page;

			if (!page || page.isClosed()) {
				console.log("Browser closed by user.");
				const status: MinimaxAuthStatus = {
					provider: "minimax",
					authenticated: false,
					checked_at: new Date().toISOString(),
					page_url: "",
					detected_text_sample: null,
					profile_path: profileDir,
					error_message: "Browser closed by user",
				};
				saveAuthStatus(status, config);
				return status;
			}

			const currentUrl = page.url();
			if (currentUrl && currentUrl !== lastLoggedUrl) {
				console.log(`   🔗 URL: ${currentUrl}`);
				lastLoggedUrl = currentUrl;
			}

			const isGoogleLogin = currentUrl.includes("accounts.google.com");
			const isMiniMaxLogin =
				currentUrl.includes("unified-login") || currentUrl.includes("login");

			if ((isGoogleLogin || isMiniMaxLogin) && !loginHintShown) {
				console.log("");
				console.log("🔓 Sign in in the Chrome window that just opened");
				console.log("   This uses real Chrome so Google login is allowed");
				console.log("   Close browser or press Ctrl+C to cancel");
				console.log("");
				loginHintShown = true;
			}

			const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
			const { detected } = detectUsagePage(bodyText);
			const onUsageRoute = currentUrl.includes(
				"platform.minimax.io/console/usage",
			);

			if (detected || onUsageRoute) {
				loginComplete = true;
				break;
			}

			await delay(1500);
		}

		if (!loginComplete) {
			const finalPage = getCurrentPage(context);
			const finalUrl = finalPage?.url() ?? "";
			console.log("⏰ Login was not completed within 5 minutes");

			const status: MinimaxAuthStatus = {
				provider: "minimax",
				authenticated: false,
				checked_at: new Date().toISOString(),
				page_url: finalUrl,
				detected_text_sample: null,
				profile_path: profileDir,
				error_message: "Login not completed",
			};

			saveAuthStatus(status, config);
			await closeBrowserResources(browser, chromeProcess);
			browser = null;
			chromeProcess = null;
			return status;
		}

		console.log("");
		console.log("📊 Extracting usage data...");

		page = getCurrentPage(context) ?? page;
		if (!page || page.isClosed()) {
			throw new Error("Chrome window closed before usage data could be read");
		}

		if (!page.url().includes("platform.minimax.io/console/usage")) {
			console.log("↪️  Opening MiniMax usage page after login...");
			await page.goto(targetUrl, {
				waitUntil: "domcontentloaded",
				timeout: 30000,
			});
		}

		await page
			.waitForLoadState("networkidle", { timeout: 30000 })
			.catch(() => {});
		await page.waitForTimeout(3000);

		const url = page.url();
		const bodyText = (await page.textContent("body").catch(() => "")) ?? "";
		const { detected, sample } = detectUsagePage(bodyText);

		console.log("");
		console.log(`   URL: ${url}`);
		console.log(`   Detected usage page: ${detected}`);
		if (sample) {
			console.log(`   Sample: ${sample.substring(0, 100)}...`);
		}
		console.log("");
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

		await closeBrowserResources(browser, chromeProcess);
		browser = null;
		chromeProcess = null;

		return status;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error(`❌ Error: ${errorMessage}`);

		await closeBrowserResources(browser, chromeProcess);

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
	const profileExists = hasProfileData(profileDir);
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
			executablePath: getChromeExecutablePath(config),
			headless: true, // Silent mode for scraping
			chromiumSandbox: false,
			args: getChromeArgs(),
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

	const profileExists = hasProfileData(profileDir);
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
