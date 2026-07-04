/**
 * minimax-browser-auth.ts
 *
 * MiniMax browser authentication using curator server pattern.
 *
 * SECURITY RULES:
 * - Human owns authentication. Agent never receives credentials.
 * - No username, password, raw cookies, or session tokens stored.
 * - Only a safe status file with authentication state.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as http from "http";
import { chromium, type Browser, type Page } from "playwright";

export interface MinimaxAuthStatus {
	provider: "minimax";
	authenticated: boolean;
	checked_at: string;
	page_url: string;
	detected_text_sample: string | null;
	curator_url?: string;
	error_message?: string;
}

export interface MinimaxBrowserAuthConfig {
	profilePath?: string;
	statusPath?: string;
	targetUrl?: string;
	usageKeywords?: string[];
	port?: number;
}

const DEFAULT_USAGE_KEYWORDS = [
	"Usage", "Token", "Plan", "Credits", "Reset", "Limit",
	"5h", "Weekly", "quota", "used", "coding_plan", "subscription",
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

export function detectUsagePage(
	bodyText: string,
	keywords?: string[],
): { detected: boolean; sample: string | null } {
	const words = (keywords ?? DEFAULT_USAGE_KEYWORDS).map((k) => k.toLowerCase());
	const lowerText = bodyText.toLowerCase();
	const foundKeywords = words.filter((w) => lowerText.includes(w));
	const detected = foundKeywords.length >= 2;
	let sample: string | null = null;
	if (detected) {
		sample = bodyText.substring(0, 200).replace(/\s+/g, " ").trim();
	}
	return { detected, sample };
}

async function findAvailablePort(startPort = 9222): Promise<number> {
	const net = await import("net");
	return new Promise((resolve) => {
		const server = net.createServer();
		server.listen(startPort, () => {
			const addr = server.address();
			const port = typeof addr === "object" && addr ? addr.port : startPort;
			server.close(() => resolve(port));
		});
		server.on("error", () => resolve(findAvailablePort(startPort + 1)));
	});
}

async function extractUsageData(page: Page): Promise<{ data: Record<string, string>; sample: string }> {
	const bodyText = (await page.textContent("body")) ?? "";

	const usageTexts: string[] = [];
	try {
		const elements = await page.$$("body *");
		for (const el of elements.slice(0, 200)) {
			const text = await el.textContent();
			if (text && (text.includes("%") || text.includes("used") || text.includes("quota") || text.match(/\d+\/\d+/))) {
				usageTexts.push(text.trim().substring(0, 100));
			}
		}
	} catch {
		// Ignore extraction errors
	}

	return {
		data: { raw: usageTexts.slice(0, 20).join(" | ") },
		sample: bodyText.substring(0, 500).replace(/\s+/g, " ").trim(),
	};
}

export async function authenticateWithCurator(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxAuthStatus> {
	const profileDir = config.profilePath ?? getProfileDir();
	const statusPath = config.statusPath ?? getStatusPath();
	const targetUrl = config.targetUrl ?? "https://platform.minimax.io/console/usage";
	const keywords = config.usageKeywords ?? DEFAULT_USAGE_KEYWORDS;
	const port = config.port ?? (await findAvailablePort(9222));

	ensureDirs(config);

	console.log("=".repeat(60));
	console.log("🔐 MiniMax Browser Authentication (Curator Mode)");
	console.log("=".repeat(60));
	console.log("");
	console.log("SECURITY: Human owns authentication.");
	console.log("- Open the curator URL in your browser");
	console.log("- Log in to MiniMax in your browser");
	console.log("- Agent will read the page after login");
	console.log("");
	console.log(`Profile directory: ${profileDir}`);
	console.log(`Status file: ${statusPath}`);
	console.log("");

	let browser: Browser | null = null;
	let server: http.Server | null = null;

	const cleanup = async () => {
		if (browser) {
			await browser.close().catch(() => {});
			browser = null;
		}
		if (server) {
			await new Promise<void>((r) => server!.close(() => r()));
			server = null;
		}
	};

	try {
		// Launch headed browser with remote debugging
		console.log("🚀 Launching headed browser...");
		console.log("(You should see a Chrome window open)");
		console.log("");

		browser = await chromium.launch({
			headless: false,
			chromiumSandbox: false,
			args: [
				`--remote-debugging-port=${port}`,
				"--no-first-run",
				"--no-default-browser-check",
				"--disable-extensions",
			],
		});

		const cdpUrl = `http://localhost:${port}`;

		// Create curator HTTP server
		console.log("🌐 Starting curator server...");
		const curatorPort = port + 1;
		server = http.createServer((req, res) => {
			res.setHeader("Access-Control-Allow-Origin", "http://localhost:*");

			if (req.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}

			const curatorHtml = `<!DOCTYPE html>
<html>
<head>
  <title>MiniMax Auth</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      color: #e0e0e0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .card {
      background: #0f3460;
      border-radius: 16px;
      padding: 2rem;
      max-width: 550px;
      width: 100%;
      box-shadow: 0 20px 60px rgba(0,0,0,0.4);
    }
    h1 { color: #fff; margin-bottom: 0.5rem; font-size: 1.6rem; }
    .subtitle { color: #888; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .step { display: flex; gap: 1rem; margin: 1rem 0; align-items: flex-start; }
    .num {
      background: #e94560; color: #fff; width: 28px; height: 28px;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-weight: bold; font-size: 0.85rem; flex-shrink: 0;
    }
    .text { line-height: 1.5; font-size: 0.95rem; }
    .url-box {
      background: #16213e; border: 2px solid #e94560; border-radius: 8px;
      padding: 1rem; margin: 1.5rem 0; word-break: break-all;
      font-family: 'SF Mono', Monaco, monospace; font-size: 0.85rem; color: #e94560;
    }
    .url-box a { color: #e94560; text-decoration: underline; }
    .warn {
      background: rgba(233, 69, 96, 0.1); border: 1px solid #e94560; border-radius: 8px;
      padding: 1rem; margin: 1.5rem 0; font-size: 0.85rem; color: #e94560;
    }
    .status {
      text-align: center; padding: 1rem; border-radius: 8px; margin-top: 1.5rem; font-size: 0.9rem;
    }
    .status.waiting { background: #16213e; border: 1px solid #444; }
    .status.ready { background: rgba(0,255,136,0.1); border: 1px solid #00ff88; color: #00ff88; }
    .note { color: #666; font-size: 0.8rem; margin-top: 1.5rem; text-align: center; }
    code { background: #16213e; padding: 0.15rem 0.4rem; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>🔐 MiniMax Auth Curator</h1>
    <p class="subtitle">Safe browser authentication for pi-harness-runtime</p>

    <div class="step">
      <span class="num">1</span>
      <span class="text">Copy and open this URL in your browser (Safari, Chrome on your Mac/PC)</span>
    </div>
    <div class="url-box"><a href="${cdpUrl}" target="_blank">${cdpUrl}</a></div>

    <div class="step">
      <span class="num">2</span>
      <span class="text">Log in to MiniMax in the opened browser window</span>
    </div>
    <div class="step">
      <span class="num">3</span>
      <span class="text">Keep this tab open — the agent will read it automatically</span>
    </div>

    <div class="warn">
      🔒 <strong>Security:</strong> This page stays local. No credentials are transmitted anywhere.
    </div>

    <div class="status waiting" id="status">
      ⏳ Waiting for browser to open MiniMax...
    </div>

    <p class="note">
      The Chrome window opened on this machine will navigate to MiniMax.<br>
      Login there OR in the curator browser tab.
    </p>
  </div>

  <script>
    async function checkStatus() {
      try {
        const res = await fetch('${cdpUrl}/json');
        const targets = await res.json();
        if (targets.length > 0) {
          const el = document.getElementById('status');
          if (el) {
            el.className = 'status ready';
            el.innerHTML = '✅ Browser detected. Navigate to MiniMax usage page.';
          }
        }
      } catch (e) {}
    }
    setInterval(checkStatus, 2000);
    checkStatus();
  </script>
</body>
</html>`;

			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(curatorHtml);
		});

		await new Promise<void>((resolve) => {
			server!.listen(curatorPort, () => resolve());
		});

		const curatorUrl = `http://localhost:${curatorPort}`;

		console.log(`🌐 Curator URL: ${curatorUrl}`);
		console.log("");
		console.log("📋 INSTRUCTIONS:");
		console.log("1. Open this URL in your browser:");
		console.log(`   ${curatorUrl}`);
		console.log("");
		console.log("2. Log in to MiniMax (either in curator tab OR in the Chrome window)");
		console.log("");
		console.log("3. Navigate to the Usage page");
		console.log("");
		console.log("4. Press Enter here when logged in...");
		console.log("");

		// Navigate to MiniMax in the browser
		const context = browser.contexts()[0] ?? (await browser.newContext());
		const page = context.pages()[0] ?? (await context.newPage());
		console.log("🖥️  Navigating to MiniMax in browser window...");
		await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
		await page.waitForTimeout(3000);

		const initialUrl = page.url();
		console.log(`   Current URL: ${initialUrl}`);
		console.log("");

		// Wait for user to confirm login
		await new Promise<void>((resolve) => {
			console.log("⏳ Waiting for you to press Enter...");
			process.stdin.once("data", () => {
				console.log("✅ Resuming...");
				resolve();
			});
		});

		console.log("");
		console.log("📊 Extracting usage data...");

		await page.goto(targetUrl, { waitUntil: "networkidle", timeout: 30000 });
		await page.waitForTimeout(2000);

		const url = page.url();
		const bodyText = (await page.textContent("body")) ?? "";
		const { detected, sample } = detectUsagePage(bodyText, keywords);

		console.log("");
		console.log(`   URL: ${url}`);
		console.log(`   Detected: ${detected}`);
		console.log(`   Sample: ${sample?.substring(0, 100)}...`);
		console.log("");

		const status: MinimaxAuthStatus = {
			provider: "minimax",
			authenticated: detected,
			checked_at: new Date().toISOString(),
			page_url: url,
			detected_text_sample: sample,
			curator_url: curatorUrl,
		};

		saveAuthStatus(status, config);

		if (detected) {
			console.log("✅ Authentication successful!");
			console.log("");
			console.log("📊 Extracted usage data preview:");
			const extracted = await extractUsageData(page);
			console.log(JSON.stringify(extracted.data, null, 2));
		} else {
			console.log("⚠️  Could not verify usage page. Try manual /usage sync.");
		}

		await cleanup();
		return status;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
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
		await cleanup();
		return status;
	}
}

export async function checkAuthStatus(
	config: MinimaxBrowserAuthConfig = {},
): Promise<MinimaxAuthStatus> {
	const statusPath = config.statusPath ?? getStatusPath();

	console.log("Checking MiniMax authentication status...");

	if (fs.existsSync(statusPath)) {
		const content = fs.readFileSync(statusPath, "utf-8");
		let status: MinimaxAuthStatus;
		try {
			status = JSON.parse(content);
		} catch {
			console.log("Invalid status file. Run auth first.");
			return {
				provider: "minimax",
				authenticated: false,
				checked_at: new Date().toISOString(),
				page_url: "",
				detected_text_sample: null,
				error_message: "Invalid status file",
			};
		}
		console.log("");
		console.log(status.authenticated ? "✅ User is logged in" : "⚠️  User is NOT logged in");
		console.log(`   Last checked: ${status.checked_at}`);
		if (status.curator_url) {
			console.log(`   Curator URL: ${status.curator_url}`);
		}
		return status;
	}

	console.log("No status file found. Run auth first.");
	return {
		provider: "minimax",
		authenticated: false,
		checked_at: new Date().toISOString(),
		page_url: "",
		detected_text_sample: null,
		error_message: "No status file found",
	};
}
