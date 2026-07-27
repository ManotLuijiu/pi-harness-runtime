/**
 * ChatGPT/Codex Cookie Test
 * 
 * Tests if ChatGPT cookies work and explores the analytics page structure.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const COOKIE_FILE = join(homedir(), ".pi-harness-runtime", "cookies", "chatgpt.com_cookies.txt");

console.log("=== ChatGPT Cookie Test ===\n");

// Load cookies
function loadNetscapeCookies(path) {
	const cookies = [];
	if (!existsSync(path)) {
		console.error("Cookie file not found:", path);
		return cookies;
	}

	const lines = readFileSync(path, "utf-8").split("\n");
	for (const line of lines) {
		if (!line || (line.startsWith("#") && !line.startsWith("#HttpOnly_"))) {
			continue;
		}

		let httpOnly = false;
		let trimmed = line;
		if (trimmed.startsWith("#HttpOnly_")) {
			httpOnly = true;
			trimmed = trimmed.slice("#HttpOnly_".length);
		}

		const parts = trimmed.split("\t");
		if (parts.length < 7) continue;

		const [domain, _flag, cookiePath, secure, expires, name, value] = parts;

		cookies.push({
			name,
			value,
			domain,
			path: cookiePath || "/",
			secure: secure.toUpperCase() === "TRUE",
			httpOnly,
			expires: parseInt(expires, 10) || undefined,
		});
	}

	return cookies;
}

console.log("1. Loading cookies from:", COOKIE_FILE);
const cookies = loadNetscapeCookies(COOKIE_FILE);
console.log(`   Found ${cookies.length} cookies\n`);

// Print cookie names
console.log("2. Cookie names:");
cookies.forEach(c => {
	console.log(`   - ${c.name} (${c.domain})`);
});

// Check for auth cookies
const authCookies = cookies.filter(c => 
	c.name.includes("session") || 
	c.name.includes("auth") || 
	c.name.includes("token") ||
	c.name.includes("access")
);
console.log(`\n3. Auth-related cookies: ${authCookies.length}`);

// Test with Playwright
async function testChatGPTPage() {
	console.log("\n4. Launching Playwright...");
	
	const playwright = await import("playwright");
	
	const browser = await playwright.chromium.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-dev-shm-usage"],
	});

	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1440, height: 1000 },
	});

	// Inject cookies
	await context.addCookies(cookies);

	const page = await context.newPage();
	
	// Capture network responses
	const capturedResponses = [];
	const apiTerms = ["usage", "quota", "billing", "consumption", "subscription", "token", "plan"];
	
	page.on("response", (resp) => {
		const url = resp.url();
		if (apiTerms.some(term => url.toLowerCase().includes(term))) {
			capturedResponses.push({
				url,
				status: resp.status(),
				ok: resp.ok()
			});
		}
	});

	try {
		console.log("\n5. Navigating to ChatGPT Codex analytics...");
		await page.goto("https://chatgpt.com/codex/cloud/settings/analytics", {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		});

		// Wait for content
		await page.waitForTimeout(5000);
		
		console.log("\n6. Current URL:", page.url());
		
		// Get visible text
		const bodyText = await page.locator("body").innerText({ timeout: 10000 });
		console.log("\n7. Visible text (first 2000 chars):");
		console.log("---");
		console.log(bodyText.substring(0, 2000));
		console.log("---");
		
		// Check for API responses
		console.log(`\n8. Captured ${capturedResponses.length} API responses:`);
		capturedResponses.forEach(r => {
			console.log(`   ${r.status} ${r.ok ? "✓" : "✗"} ${r.url}`);
		});

		// Check page title
		const title = await page.title();
		console.log(`\n9. Page title: ${title}`);

	} catch (error) {
		console.error("\n   Error:", error.message);
	} finally {
		await browser.close();
	}
}

await testChatGPTPage();
console.log("\n=== Test Complete ===");
