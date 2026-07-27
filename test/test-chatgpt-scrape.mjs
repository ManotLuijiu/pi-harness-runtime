import { chromium } from "playwright";
import { readFileSync } from "node:fs";

async function loadNetscapeCookies(path) {
  const text = readFileSync(path, "utf-8");
  const lines = text.split("\n");
  const cookies = [];
  for (const line of lines) {
    if (line.startsWith("#") || !line.trim()) continue;
    const parts = line.split(/\t/);
    if (parts.length >= 7) {
      cookies.push({
        domain: parts[0],
        path: parts[2] === "FALSE" ? false : parts[2],
        secure: parts[3] === "TRUE",
        expires: parseInt(parts[4]) || -1,
        name: parts[5],
        value: decodeURIComponent(parts[6]),
      });
    }
  }
  return cookies;
}

async function testChatGPT() {
  const COOKIE_FILE = "/home/frappe/.config/openai-cookies.txt";
  const cookies = await loadNetscapeCookies(COOKIE_FILE);
  console.log(`Loaded ${cookies.length} cookies`);
  
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(cookies);
  
  const page = await context.newPage();
  
  // Capture all responses
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("usage") || url.includes("subscription") || url.includes("credits")) {
      console.log(`[Response] ${url}`);
      try {
        const body = await response.text();
        console.log(`  Body (first 500 chars): ${body.substring(0, 500)}`);
      } catch {}
    }
  });
  
  console.log("Navigating to ChatGPT usage page...");
  try {
    await page.goto("https://chatgpt.com/codex/cloud/settings/analytics#usage", { 
      waitUntil: "networkidle",
      timeout: 30000 
    });
    await page.waitForTimeout(3000);
    
    console.log("Page title:", await page.title());
    console.log("Page content (first 2000 chars):");
    const content = await page.content();
    console.log(content.substring(0, 2000));
  } catch (e) {
    console.error("Error:", e.message);
  }
  
  await browser.close();
}

testChatGPT().catch(console.error);
