import { homedir as osHomedir } from "node:os";
import { join } from "node:path";
import { MiniMaxQuotaScraper } from "../harness/e2e/minimax-quota-scraper.ts";

const scraper = new MiniMaxQuotaScraper({
  cookieFile: process.env.MINIMAX_COOKIE_FILE || join(process.env.HOME || osHomedir(), ".config", "minimax-cookies.txt"),
});

console.log("Testing MiniMax scraper with cookies from ~/.config/...");
const result = await scraper.scrape();
console.log("Result:", JSON.stringify(result, null, 2));
