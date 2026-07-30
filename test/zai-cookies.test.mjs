/**
 * Z.ai (GLM/Zhipu) Cookie Test
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const COOKIE_FILE = join(homedir(), ".pi-harness-runtime", "cookies", "z.ai_cookies.txt");

console.log("=== Z.ai Cookie Test ===\n");

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

const cookies = loadNetscapeCookies(COOKIE_FILE);
console.log(`Loaded ${cookies.length} cookies\n`);

// Print cookie names
console.log("Cookie names:");
cookies.forEach(c => console.log(`  - ${c.name}`));

// Test with Playwright
async function testZaiPage() {
	console.log("\nLaunching Playwright...");
	
	const playwright = await import("playwright");
	
	const browser = await playwright.chromium.launch({
		headless: true,
		args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
	});

	const context = await browser.newContext({
		locale: "en-US",
		viewport: { width: 1440, height: 1000 },
		userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
	});

	// Inject cookies
	await context.addCookies(cookies);

	const page = await context.newPage();
	
	// Capture network responses
	const capturedResponses = [];
	const apiTerms = ["usage", "quota", "billing", "consumption", "subscription", "token", "plan", "remain"];
	
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
		console.log("\nNavigating to Z.ai...");
		await page.goto("https://z.ai/", {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		});
		await page.waitForTimeout(3000);

		console.log("URL:", page.url());
		console.log("Title:", await page.title());
		
		// Get visible text
		const bodyText = await page.locator("body").innerText({ timeout: 10000 });
		console.log("\nVisible text (first 1000 chars):");
		console.log("---");
		console.log(bodyText.substring(0, 1000));
		console.log("---");
		
		// Check for API responses
		console.log(`\nCaptured ${capturedResponses.length} API responses:`);
		capturedResponses.forEach(r => {
			console.log(`  ${r.status} ${r.ok ? "✓" : "✗"} ${r.url}`);
		});

		// Try usage page
		console.log("\nNavigating to usage page...");
		await page.goto("https://z.ai/user/center/information", {
			waitUntil: "domcontentloaded",
			timeout: 30000,
		});
		await page.waitForTimeout(3000);
		
		console.log("URL:", page.url());
		console.log("Title:", await page.title());
		
		const usageText = await page.locator("body").innerText({ timeout: 10000 });
		console.log("\nUsage page text (first 1000 chars):");
		console.log("---");
		console.log(usageText.substring(0, 1000));
		console.log("---");

	} catch (error) {
		console.error("\nError:", error.message);
	} finally {
		await browser.close();
	}
}

await testZaiPage();
console.log("\n=== Test Complete ===");
