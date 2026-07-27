/**
 * OpenAI API Usage Test
 * 
 * Tests if we can fetch usage data from OpenAI's API directly.
 * OpenAI has a proper API for this unlike the website.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const COOKIE_FILE = join(homedir(), ".pi-harness-runtime", "cookies", "chatgpt.com_cookies.txt");

console.log("=== OpenAI API Usage Test ===\n");

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

// Find auth token from cookies
const sessionToken = cookies.find(c => c.name.includes("session-token"));
const csrfToken = cookies.find(c => c.name.includes("csrf-token"));

if (sessionToken) {
	console.log("Found session token:", sessionToken.name);
	
	// Try to fetch OpenAI API usage
	async function testOpenAIApi() {
		// Build cookie header
		const cookieHeader = cookies
			.map(c => `${c.name}=${c.value}`)
			.join("; ");
		
		const headers = {
			"Cookie": cookieHeader,
			"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
		};
		
		console.log("\n1. Trying OpenAI API usage endpoint...");
		
		try {
			// OpenAI has an API endpoint for usage
			const resp = await fetch("https://api.openai.com/v1/usage", {
				headers: {
					"Authorization": `Bearer ${sessionToken.value}`,
					"User-Agent": "Mozilla/5.0",
				},
			});
			console.log(`   Status: ${resp.status}`);
			if (resp.ok) {
				const data = await resp.json();
				console.log("   Data:", JSON.stringify(data, null, 2));
			} else {
				const text = await resp.text();
				console.log("   Response:", text.substring(0, 500));
			}
		} catch (error) {
			console.error("   Error:", error.message);
		}
		
		console.log("\n2. Trying ChatGPT website API (authed fetch)...");
		try {
			const resp = await fetch("https://chatgpt.com/api/auth/session", {
				headers: {
					"Cookie": cookieHeader,
					"User-Agent": "Mozilla/5.0",
				},
			});
			console.log(`   Status: ${resp.status}`);
			if (resp.ok) {
				const data = await resp.json();
				console.log("   User:", data.user?.name || data.user?.email || "unknown");
				console.log("   Access token:", data.accessToken ? "present" : "missing");
			} else {
				console.log("   Not authenticated");
			}
		} catch (error) {
			console.error("   Error:", error.message);
		}
		
		console.log("\n3. Trying OpenAI Codex usage page...");
		try {
			// This is the usage API that ChatGPT uses internally
			const resp = await fetch("https://api.openai.com/v1/dashboard/billing/usage?start_date=2026-01-01&end_date=2026-12-31", {
				headers: {
					"Authorization": `Bearer ${sessionToken.value}`,
					"User-Agent": "Mozilla/5.0",
				},
			});
			console.log(`   Status: ${resp.status}`);
			if (resp.ok) {
				const data = await resp.json();
				console.log("   Total usage:", data.total_usage);
				console.log("   Data:", JSON.stringify(data, null, 2).substring(0, 500));
			} else {
				const text = await resp.text();
				console.log("   Response:", text.substring(0, 300));
			}
		} catch (error) {
			console.error("   Error:", error.message);
		}
	}
	
	await testOpenAIApi();
} else {
	console.log("No session token found in cookies");
}

console.log("\n=== Test Complete ===");
