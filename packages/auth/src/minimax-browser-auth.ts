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

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as net from "node:net";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import {
	chromium,
	type Browser,
	type BrowserContext,
	type Page,
} from "playwright";

// ESM __dirname shim (not available in ESM without this)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const _require = createRequire(import.meta.url);

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

export interface MinimaxLiveBrowserSession {
	profile_path: string;
	target_url: string;
	chrome_path: string;
	debugging_port: number;
	pid: number;
	started_at: string;
}

export function getLiveSessionPath(): string {
	return path.join(getRuntimeDir(), "auth", "minimax-live-browser.json");
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

function loadSavedAuthStatus(
	config?: MinimaxBrowserAuthConfig,
): MinimaxAuthStatus | null {
	const statusPath = config?.statusPath ?? getStatusPath();
	if (!fs.existsSync(statusPath)) {
		return null;
	}
	try {
		return JSON.parse(
			fs.readFileSync(statusPath, "utf-8"),
		) as MinimaxAuthStatus;
	} catch {
		return null;
	}
}

function saveLiveBrowserSession(
	session: MinimaxLiveBrowserSession,
	liveSessionPath?: string,
): void {
	const p = liveSessionPath ?? getLiveSessionPath();
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, JSON.stringify(session, null, 2));
}

export function loadLiveBrowserSession(
	liveSessionPath?: string,
): MinimaxLiveBrowserSession | null {
	const p = liveSessionPath ?? getLiveSessionPath();
	if (!fs.existsSync(p)) {
		return null;
	}
	try {
		return JSON.parse(fs.readFileSync(p, "utf-8")) as MinimaxLiveBrowserSession;
	} catch {
		return null;
	}
}

function clearLiveBrowserSession(liveSessionPath?: string): void {
	const p = liveSessionPath ?? getLiveSessionPath();
	if (fs.existsSync(p)) {
		fs.rmSync(p, { force: true });
	}
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
				"C:Program FilesGoogleChromeApplicationchrome.exe",
				"C:Program Files (x86)GoogleChromeApplicationchrome.exe",
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

function getAuthTimeoutMs(config: MinimaxBrowserAuthConfig): number {
	const configuredTimeout =
		config.authTimeoutMs ??
		(process.env.PI_HARNESS_AUTH_TIMEOUT_MS
			? Number(process.env.PI_HARNESS_AUTH_TIMEOUT_MS)
			: undefined);
	if (
		typeof configuredTimeout === "number" &&
		Number.isFinite(configuredTimeout) &&
		configuredTimeout > 0
	) {
		return configuredTimeout;
	}
	return DEFAULT_AUTH_TIMEOUT_MS;
}

async function getFreePort(preferredPort?: number): Promise<number> {
	if (preferredPort) return preferredPort;
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
	const pages = context.pages().filter((p) => !p.isClosed());
	return pages.length > 0 ? pages[pages.length - 1] : null;
}

async function waitForPage(
	context: BrowserContext,
	timeoutMs = 15000,
): Promise<Page> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const page = getCurrentPage(context);
		if (page) return page;
		await delay(250);
	}
	throw new Error("Chrome launched but no page became available");
}

async function closeBrowserResources(
	browser: Browser | null,
	chromeProcess: ChildProcess | null,
): Promise<void> {
	if (browser) await browser.close().catch(() => {});
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
	browser: Awaited<ReturnType<typeof connectToChromeOverCdp>>;
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
	const chromeProcess = spawn(chromePath, chromeArgs, { stdio: "ignore" });
	const browser = await connectToChromeOverCdp(cdpPort);
	const context = browser.contexts()[0] as BrowserContext;
	if (!context) {
		await closeBrowserResources(browser, chromeProcess);
		throw new Error(
			"Connected to Chrome, but no browser context was available",
		);
	}
	return { browser, chromeProcess, chromePath, cdpPort };
}

/**
 * Manual authentication flow: launches real Chrome so Google login works,
 * waits for user to sign in, then confirms at the TTY.
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
	console.log("Profile directory: " + profileDir);
	console.log("");

	let browser: Browser | null = null;
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
		chromeProcess = launched.chromeProcess;
		const context = browser.contexts()[0];
		console.log("   Chrome: " + launched.chromePath);
		console.log("   DevTools port: " + launched.cdpPort);
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
		const authTimeoutMs = getAuthTimeoutMs(config);

		while (Date.now() - startTime < authTimeoutMs) {
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
				console.log("   🔗 URL: " + currentUrl);
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
			if (detected) {
				loginComplete = true;
				break;
			}

			await delay(1500);
		}

		if (!loginComplete) {
			console.log("");
			console.log("⏰ Browser stayed open after timeout. Please close it.");
			console.log("");
			await waitForChromeToExit(chromeProcess);
			const status: MinimaxAuthStatus = {
				provider: "minimax",
				authenticated: false,
				checked_at: new Date().toISOString(),
				page_url: "",
				detected_text_sample: null,
				profile_path: profileDir,
				error_message: "Login not completed within timeout",
			};
			saveAuthStatus(status, config);
			browser = null;
			chromeProcess = null;
			return status;
		}

		// Usage page detected — wait for human to close the browser
		console.log("");
		console.log("✅ Usage page reached!");
		console.log("💾 Profile is being saved automatically.");
		console.log("");
		console.log("⚠️  Please close the Chrome window now.");
		console.log("");
		await waitForChromeToExit(chromeProcess);

		const confirmed = await confirmUsagePageReached(30000);
		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: confirmed,
			checked_at: new Date().toISOString(),
			page_url: targetUrl,
			detected_text_sample: confirmed ? "Usage page confirmed by user" : null,
			profile_path: profileDir,
		};
		saveAuthStatus(status, config);

		console.log("");
		if (confirmed) {
			console.log(
				"✅ Authentication saved! Future scrapes will use this profile.",
			);
		} else {
			console.log("⚠️  Auth not confirmed. Run 'auth' again after login.");
		}

		browser = null;
		chromeProcess = null;
		return status;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error("❌ Error: " + errorMessage);
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

async function waitForChromeToExit(chromeProcess: ChildProcess): Promise<void> {
	return new Promise((resolve) => {
		// macOS: helper processes keep chrome running even after window closes
		// Use process group to kill all related processes
		const timeout = setTimeout(() => {
			console.log(
				"   (timeout waiting for Chrome exit — killing process group)",
			);
			try {
				process.kill(chromeProcess.pid!, "SIGTERM");
			} catch (_e) {
				/* ignore */
			}
			resolve();
		}, 15000);

		chromeProcess.once("exit", () => {
			clearTimeout(timeout);
			resolve();
		});

		// Also resolve on Enter (TTY fallback)
		if (process.stdin.isTTY) {
			console.log("   Press ENTER after closing Chrome...");
			process.stdin.once("data", () => {
				clearTimeout(timeout);
				resolve();
			});
		}
	});
}

async function confirmUsagePageReached(_timeoutMs = 30000): Promise<boolean> {
	if (!process.stdin.isTTY) {
		console.log("(non-TTY: auto-confirming)");
		return true;
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(
		"✅ Did you reach the MiniMax usage page? (y/N): ",
	);
	rl.close();
	return answer.trim().toLowerCase() === "y";
}

/**
 * Extract usage-relevant lines from page body text.
 * Splits on newlines AND HTML tag boundaries, then filters for keywords.
 */
export function extractUsageLines(bodyText: string): string[] {
	// Strip <script> JSON noise first
	let clean = bodyText.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
	clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");
	clean = clean.replace(/\{\s*"[^{}]*\}/g, "");

	// Split on both newlines and HTML tag boundaries
	const htmlTagRe =
		/\n|<div[^>]*>|<\/div>|<span[^>]*>|<\/span>|<p[^>]*>|<\/p>|<br\s*\/?>|\s{2,}/gi;
	// Replace tag matches with spaces so adjacent text doesn't concatenate
	clean = clean.replace(htmlTagRe, " ");
	const parts = clean.split(/\s+/);

	const lines: string[] = [];
	const keywords = DEFAULT_USAGE_KEYWORDS.map((k) => k.toLowerCase());

	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed.length < 3 || trimmed.length > 200) continue;
		const lower = trimmed.toLowerCase();
		const hasKeyword = keywords.some((k) => lower.includes(k));
		const hasNumber = /\d/.test(trimmed);
		const hasPercent = /%|\d+\/\d+/.test(trimmed);
		if (hasKeyword || (hasNumber && hasPercent)) {
			// Deduplicate
			const normalized = trimmed.replace(/\s+/g, " ");
			if (!lines.includes(normalized)) {
				lines.push(normalized);
			}
		}
	}

	return lines;
}

/**
 * Scrape usage data by attaching to a live browser session (via Node CDP).
 * Writes attach script to a temp .js file to avoid shell escaping issues.
 */
export async function scrapeViaLiveBrowserSession(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxAuthStatus> {
	const quiet = config.quiet === true;
	const log = (...args: unknown[]) => {
		if (!quiet) console.log(...args);
	};
	const errorLog = (...args: unknown[]) => {
		if (!quiet) console.error(...args);
	};
	const liveSession = loadLiveBrowserSession();
	if (!liveSession) {
		return {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			profile_path: config.profilePath ?? getProfileDir(),
			error_message: "No live browser session. Run 'open' first.",
		};
	}

	const profileDir = liveSession.profile_path;
	const targetUrl = "https://platform.minimax.io/console/usage";
	const port = liveSession.debugging_port;

	log("Attaching to live Chrome session (port " + port + ")...");
	log("Profile: " + profileDir);

	// Resolve playwright from the project root so Node can find it in the temp script.
	// Walk up from this file's location to find the project root (has node_modules).
	let projectRoot = __dirname;
	while (
		projectRoot !== "/" &&
		projectRoot !== "" &&
		!fs.existsSync(path.join(projectRoot, "node_modules", "playwright"))
	) {
		projectRoot = path.dirname(projectRoot);
	}
	if (!fs.existsSync(path.join(projectRoot, "node_modules", "playwright"))) {
		// Fallback: try CWD
		projectRoot = process.cwd();
	}
	const playwrightPath = _require.resolve("playwright", {
		paths: [projectRoot],
	});

	// Build attach script as a plain string (no template literals with regex)
	const scriptLines = [
		"const { chromium } = require('" +
			playwrightPath.replace(/\\/g, "\\\\") +
			"');",
		"(async () => {",
		"  const browser = await chromium.connectOverCDP('http://127.0.0.1:" +
			port +
			"');",
		"  const context = browser.contexts()[0];",
		"  if (!context) { console.error('NO_CONTEXT'); process.exit(1); }",
		"  const pages = context.pages().filter(p => !p.isClosed());",
		"  const page = pages.length > 0 ? pages[pages.length - 1] : await context.newPage();",
		"  await page.goto('" +
			targetUrl +
			"', { waitUntil: 'domcontentloaded', timeout: 30000 });",
		"  await page.waitForTimeout(3000);",
		"  const url = page.url();",
		"  const bodyText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');",
		"  const result = JSON.stringify({ url, bodyText });",
		"  console.log('RESULT:' + result);",
		"  await browser.close();",
		"})().catch(e => { console.error('ERROR:' + e.message); process.exit(1); });",
	];
	const scriptContent = scriptLines.join("\n");

	// Write to temp file to avoid shell escaping issues
	const tmpDir = os.tmpdir();
	const scriptPath = path.join(
		tmpDir,
		"pi-harness-minimax-attach-" + Date.now() + ".js",
	);
	fs.writeFileSync(scriptPath, scriptContent);

	try {
		const raw = execFileSync("node", [scriptPath], {
			encoding: "utf-8",
			timeout: 60000,
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();

		fs.unlinkSync(scriptPath);

		const resultMatch = raw.match(/RESULT:(.+)/s);
		if (!resultMatch) {
			throw new Error("No RESULT from attach script: " + raw.substring(0, 200));
		}

		const parsed = JSON.parse(resultMatch[1]);
		const bodyText: string = parsed.bodyText ?? "";
		const url: string = parsed.url ?? "";
		const { detected, sample } = detectUsagePage(bodyText);
		const usage_lines = extractUsageLines(bodyText);

		log("URL: " + url);
		log("Detected usage page: " + detected);
		if (usage_lines.length > 0) {
			log("Usage lines (" + usage_lines.length + "):");
			usage_lines.slice(0, 20).forEach((l) => log("  " + l));
		}

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: detected,
			checked_at: new Date().toISOString(),
			page_url: url,
			detected_text_sample: sample,
			profile_path: profileDir,
			usage_lines,
		};
		saveAuthStatus(status, config);
		return status;
	} catch (error) {
		try {
			fs.unlinkSync(scriptPath);
		} catch (_e) {
			/* ignore */
		}
		const errorMessage = error instanceof Error ? error.message : String(error);
		errorLog("Attach failed: " + errorMessage);
		return {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			profile_path: profileDir,
			error_message: "Live attach failed: " + errorMessage,
		};
	}
}

/**
 * Start a persistent browser daemon (keep-open mode).
 * Launches real Chrome with --remote-debugging-port and saves session.
 */
export async function startPersistentBrowserDaemon(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxLiveBrowserSession> {
	const profileDir = config.profilePath ?? getProfileDir();
	const targetUrl =
		config.targetUrl ?? "https://platform.minimax.io/console/usage";
	ensureDirs(config);

	// Kill any existing daemon for this profile
	await stopPersistentBrowserDaemon(config);

	const chromePath = getChromeExecutablePath(config);
	const cdpPort = await getFreePort(config.cdpPort ?? 9222);
	const chromeArgs = [
		"--remote-debugging-port=" + cdpPort,
		"--user-data-dir=" + profileDir,
		"--new-window",
		...getChromeArgs(),
		targetUrl,
	];

	console.log("Launching persistent Chrome daemon...");
	console.log("  Chrome: " + chromePath);
	console.log("  Port: " + cdpPort);
	console.log("  Profile: " + profileDir);

	// nosemgrep: javascript.lang.security.detect-child-process.detect-child-process
	const chromeProcess = spawn(chromePath, chromeArgs, {
		stdio: "ignore",
		detached: true,
	});

	const session: MinimaxLiveBrowserSession = {
		profile_path: profileDir,
		target_url: targetUrl,
		chrome_path: chromePath,
		debugging_port: cdpPort,
		pid: chromeProcess.pid!,
		started_at: new Date().toISOString(),
	};

	saveLiveBrowserSession(session);
	console.log("Live session saved. PID: " + chromeProcess.pid);
	return session;
}

/**
 * Stop the persistent browser daemon.
 */
export async function stopPersistentBrowserDaemon(
	_config: MinimaxBrowserAuthConfig = {},
): Promise<boolean> {
	const liveSession = loadLiveBrowserSession(getLiveSessionPath());
	if (!liveSession) return false;

	console.log("Stopping live Chrome session (PID " + liveSession.pid + ")...");
	const killed: string[] = [];

	// Try process group kill
	try {
		process.kill(-liveSession.pid, "SIGTERM");
		killed.push("process group " + liveSession.pid);
	} catch (_e) {
		/* ignore */
	}

	// Try direct PID
	try {
		process.kill(liveSession.pid, "SIGTERM");
		killed.push("PID " + liveSession.pid);
	} catch (_e) {
		/* ignore */
	}

	// Kill by profile path (macOS helper processes)
	try {
		const out = execFileSync(
			"pgrep",
			["-f", "user-data-dir=" + liveSession.profile_path],
			{ encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
		);
		for (const pid of out.trim().split("\n")) {
			try {
				process.kill(parseInt(pid), "SIGTERM");
				killed.push("profile PID " + pid);
			} catch (_e2) {
				/* ignore */
			}
		}
	} catch (_e) {
		/* ignore */
	}

	clearLiveBrowserSession();
	console.log(
		"Stopped: " + (killed.length > 0 ? killed.join(", ") : "nothing found"),
	);
	return true;
}

/**
 * Get active live browser session info.
 */
export function getActiveLiveBrowserSession(): MinimaxLiveBrowserSession | null {
	return loadLiveBrowserSession();
}

/**
 * Scrape usage data. Tries live session first, falls back to headless Playwright.
 */
export async function scrapeWithExistingProfile(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxAuthStatus> {
	const profileDir = config.profilePath ?? getProfileDir();
	const targetUrl =
		config.targetUrl ?? "https://platform.minimax.io/console/usage";
	ensureDirs(config);

	const quiet = config.quiet === true;
	const log = (...args: unknown[]) => {
		if (!quiet) console.log(...args);
	};
	const errorLog = (...args: unknown[]) => {
		if (!quiet) console.error(...args);
	};

	log("=".repeat(60));
	log("📊 MiniMax Usage Scraper");
	log("=".repeat(60));
	log("");

	// 1. Try live session first (skip if forced off for testing)
	const liveSession = config.forceNoLiveSession
		? null
		: loadLiveBrowserSession();
	if (liveSession) {
		log("Live browser session found (PID " + liveSession.pid + ")");
		log("Trying live attach...");
		const result = await scrapeViaLiveBrowserSession(config);
		if (result.authenticated || result.usage_lines) {
			log("✅ Live session scrape successful!");
			return result;
		}
		// Live session exists but attach failed — do NOT fall back to headless
		// because that would try to lock the same profile (already locked by the daemon)
		log("⚠️  Live session exists but attach failed.");
		log("   Make sure your Chrome window is still open.");
		log(
			"   To stop and restart: bun packages/auth/src/run-minimax-auth.ts stop",
		);
		return {
			provider: "minimax",
			authenticated: false,
			checked_at: new Date().toISOString(),
			page_url: "",
			detected_text_sample: null,
			profile_path: liveSession.profile_path,
			error_message:
				"Live attach failed: " +
				(result.error_message ?? "unknown error") +
				". Is the Chrome window still open?",
		};
	}

	// 2. Fall back to headless Playwright with existing profile
	const profileExists = hasProfileData(profileDir);
	if (!profileExists) {
		log("⚠️  No profile found. Run auth first:");
		log("   bun packages/auth/src/run-minimax-auth.ts auth");
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

	log("Launching headless browser with saved profile...");

	let context: BrowserContext | null = null;
	try {
		context = await chromium.launchPersistentContext(profileDir, {
			executablePath: getChromeExecutablePath(config),
			headless: true,
			chromiumSandbox: false,
			args: getChromeArgs(),
			viewport: { width: 1280, height: 800 },
		});

		const page = context.pages()[0] ?? (await context.newPage());
		log("Navigating to " + targetUrl + "...");
		await page.goto(targetUrl, {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		});
		await page.waitForTimeout(3000);

		const url = page.url();
		const bodyText = await page
			.locator("body")
			.innerText({ timeout: 10000 })
			.catch(() => "");
		const { detected, sample } = detectUsagePage(bodyText);
		const usage_lines = extractUsageLines(bodyText);

		// Check if redirected to login
		const redirectedToLogin =
			url.includes("unified-login") || url.includes("login");
		const savedStatus = loadSavedAuthStatus(config);
		const wasPreviouslyAuthenticated = savedStatus?.authenticated ?? false;

		let authenticated = detected;
		let error_message: string | undefined;

		if (redirectedToLogin && wasPreviouslyAuthenticated) {
			log(
				"⚠️  Redirected to login but previously authenticated. Profile may have expired.",
			);
			authenticated = false;
			error_message = "Session expired - redirected to login";
		}

		log("URL: " + url);
		log("Detected usage page: " + detected);
		if (usage_lines.length > 0) {
			log("Usage lines (" + usage_lines.length + "):");
			usage_lines.slice(0, 20).forEach((l) => log("  " + l));
		}

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated,
			checked_at: new Date().toISOString(),
			page_url: url,
			detected_text_sample: sample,
			profile_path: profileDir,
			usage_lines,
			error_message,
		};
		saveAuthStatus(status, config);

		await context.close();
		context = null;
		return status;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		errorLog("❌ Error: " + errorMessage);
		if (context) await context.close().catch(() => {});
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
 * Check auth status.
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
			if (status.usage_lines && status.usage_lines.length > 0) {
				console.log("Usage lines available: " + status.usage_lines.length);
			}
			console.log("Checked at: " + status.checked_at);
			console.log("Profile: " + status.profile_path);
			return status;
		} catch {
			console.log("⚠️  Status file is corrupted");
		}
	} else {
		console.log("⚠️  No status file found. Run auth first.");
	}

	const liveSession = loadLiveBrowserSession();
	if (liveSession) {
		console.log(
			"Live browser session active (PID " +
				liveSession.pid +
				", port " +
				liveSession.debugging_port +
				")",
		);
	}

	if (!hasProfileData(profileDir)) {
		console.log("⚠️  No Chrome profile found at " + profileDir);
	} else {
		console.log("✅ Chrome profile exists at " + profileDir);
	}

	return {
		provider: "minimax",
		authenticated: false,
		checked_at: new Date().toISOString(),
		page_url: "",
		detected_text_sample: null,
		profile_path: profileDir,
	};
}
