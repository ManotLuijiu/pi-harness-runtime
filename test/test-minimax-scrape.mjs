import { MiniMaxQuotaScraper } from "../harness/e2e/minimax-quota-scraper.ts";

const scraper = new MiniMaxQuotaScraper({
  cookieFile: "/home/frappe/.config/minimax-cookies.txt",
});

console.log("Testing MiniMax scraper with cookies from ~/.config/...");
const result = await scraper.scrape();
console.log("Result:", JSON.stringify(result, null, 2));
