/**
 * Telegram Mobile Bot Integration
 * 
 * This module provides mobile-first button interactions:
 * - Job cards with one-tap actions
 * - Log viewing with pagination
 * - Quick status overview
 * 
 * Import this in telegram-webhook-server.ts to enable:
 *   import { MobileBot } from "./telegram-mobile-integration.ts";
 *   const mobileBot = new MobileBot();
 *   mobileBot.handleCallback(cq.data);
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { uploadLogsToR2, isR2Configured } from "./r2-storage.js";

// ============================================================================
// Types
// ============================================================================

export interface InlineKeyboard {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
}

export interface JobInfo {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed";
  progress?: string;
  updatedAt: string;
}

export interface JobDetail {
  id: string;
  title: string;
  description?: string;
  status: string;
  logs?: string[];
  diff?: string;
  error?: string;
}

// ============================================================================
// State Management
// ============================================================================

class JobStateStore {
  private stateFile: string;

  constructor(baseDir: string) {
    this.stateFile = join(baseDir, "telegram-jobs.json");
  }

  getJobs(): JobInfo[] {
    try {
      if (!existsSync(this.stateFile)) return [];
      const data = JSON.parse(readFileSync(this.stateFile, "utf8"));
      return data.jobs || [];
    } catch {
      return [];
    }
  }

  getJob(id: string): JobInfo | undefined {
    return this.getJobs().find(j => j.id === id);
  }

  updateJob(job: JobInfo): void {
    const jobs = this.getJobs();
    const idx = jobs.findIndex(j => j.id === job.id);
    if (idx >= 0) {
      jobs[idx] = job;
    } else {
      jobs.push(job);
    }
    writeFileSync(this.stateFile, JSON.stringify({ jobs }));
  }

  removeJob(id: string): void {
    const jobs = this.getJobs().filter(j => j.id !== id);
    writeFileSync(this.stateFile, JSON.stringify({ jobs }));
  }
}

// ============================================================================
// Button Kits - All Actions as Buttons, Zero Typing
// ============================================================================

export class ButtonKit {
  /**
   * Job card with contextual actions
   */
  static jobCard(job: JobInfo): InlineKeyboard {
    return {
      inline_keyboard: [
        [
          { text: "📋 Details", callback_data: `j:details:${job.id}` },
          { text: "📜 Logs", callback_data: `j:logs:${job.id}` },
        ],
        [
          { text: "🔄 Retry", callback_data: `j:retry:${job.id}` },
          { text: "❌ Cancel", callback_data: `j:cancel:${job.id}` },
        ]
      ]
    };
  }

  /**
   * Main navigation menu
   */
  static mainMenu(): InlineKeyboard {
    return {
      inline_keyboard: [
        [
          { text: "📋 My Jobs", callback_data: "m:jobs" },
          { text: "🔍 Search", callback_data: "m:search" },
        ],
        [
          { text: "📊 Status", callback_data: "m:status" },
          { text: "⚙️ Settings", callback_data: "m:settings" },
        ]
      ]
    };
  }

  /**
   * Job list with quick select
   */
  static jobList(jobs: JobInfo[]): InlineKeyboard {
    const buttons: InlineKeyboard["inline_keyboard"] = [];

    for (const job of jobs.slice(0, 8)) {
      const emoji = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";
      buttons.push([{ 
        text: `${emoji} ${job.title.slice(0, 28)}${job.title.length > 28 ? "…" : ""}`, 
        callback_data: `j:select:${job.id}` 
      }]);
    }

    buttons.push([{ text: "🔙 Back", callback_data: "m:menu" }]);
    return { inline_keyboard: buttons };
  }

  /**
   * Confirmation buttons
   */
  static confirm(action: string, targetId: string): InlineKeyboard {
    return {
      inline_keyboard: [
        [
          { text: "✅ Confirm", callback_data: `c:yes:${action}:${targetId}` },
          { text: "❌ Cancel", callback_data: `c:no:${action}:${targetId}` },
        ]
      ]
    };
  }

  /**
   * Pagination for logs
   */
  static logPagination(jobId: string, page: number, hasMore: boolean): InlineKeyboard {
    const buttons: InlineKeyboard["inline_keyboard"] = [];

    if (page > 0) {
      buttons.push([{ text: "◀️ Prev", callback_data: `j:logs:${jobId}:${page - 1}` }]);
    }

    if (hasMore) {
      buttons.push([{ text: "▶️ Next", callback_data: `j:logs:${jobId}:${page + 1}` }]);
    }

    buttons.push([{ text: "🔙 Back to Job", callback_data: `j:details:${jobId}` }]);
    return { inline_keyboard: buttons };
  }
}

// ============================================================================
// Formatters
// ============================================================================

export function formatJobCard(job: JobInfo): string {
  const emoji = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";
  const time = new Date(job.updatedAt).toLocaleTimeString();

  return `<b>${emoji} ${escapeHtml(job.title)}</b>\n` +
    `Status: ${job.status}${job.progress ? ` (${job.progress})` : ""}\n` +
    `Updated: ${time}`;
}

export function formatJobDetail(job: JobDetail): string {
  const emoji = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";

  let text = `<b>${emoji} ${escapeHtml(job.title)}</b>\n`;
  text += `─────────────────\n`;
  text += `Status: <code>${job.status}</code>\n`;

  if (job.description) {
    text += `\n${escapeHtml(job.description.slice(0, 500))}\n`;
  }

  if (job.error) {
    text += `\n⚠️ <b>Error:</b>\n<code>${escapeHtml(job.error.slice(0, 300))}</code>`;
  }

  if (job.logs && job.logs.length > 0) {
    text += `\n\n📜 <b>Recent:</b>`;
    for (const log of job.logs.slice(0, 3)) {
      text += `\n<code>${escapeHtml(log.slice(0, 100))}</code>`;
    }
  }

  return text;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ============================================================================
// Mobile Bot - Handles All Button Clicks
// ============================================================================

export class MobileBot {
  private state: JobStateStore;
  private botToken: string;
  private chatId: string;
  private jobPipeFile: string;

  constructor(baseDir: string, botToken: string, chatId: string, jobPipeFile: string) {
    this.state = new JobStateStore(baseDir);
    this.botToken = botToken;
    this.chatId = chatId;
    this.jobPipeFile = jobPipeFile;
  }

  /**
   * Handle callback query from Telegram
   * Parse and execute the requested action
   */
  async handleCallback(data: string): Promise<string | null> {
    const parts = data.split(":");
    const category = parts[0];
    const action = parts[1];
    const id = parts[2];
    const extra = parts.slice(3);

    switch (category) {
      // === Job Actions ===
      case "j": {
        return this.handleJobAction(action, id, extra[0]);
      }

      // === Confirm Actions ===
      case "c": {
        return this.handleConfirmAction(action, id);
      }

      // === Menu Navigation ===
      case "m": {
        return this.handleMenuAction(action);
      }

      default:
        return `Unknown action: ${data}`;
    }
  }

  private async handleJobAction(action: string, jobId: string, page?: string): Promise<string | null> {
    const job = this.state.getJob(jobId);

    switch (action) {
      case "select":
        if (job) {
          const detail = await this.getJobDetail(jobId);
          await this.sendMessage(formatJobDetail(detail), ButtonKit.jobCard(job));
        }
        break;

      case "details":
        if (job) {
          const detail = await this.getJobDetail(jobId);
          await this.sendMessage(formatJobDetail(detail), ButtonKit.jobCard(job));
        }
        break;

      case "logs":
        const pageNum = parseInt(page || "0", 10);
        await this.sendJobLogs(jobId, pageNum);
        break;

      case "retry":
        await this.sendMessage(
          `🔄 Retry job <code>${jobId}</code>?`,
          ButtonKit.confirm("retry", jobId)
        );
        break;

      case "cancel":
        await this.sendMessage(
          `❌ Cancel job <code>${jobId}</code>?`,
          ButtonKit.confirm("cancel", jobId)
        );
        break;
    }

    return null;
  }

  private async handleConfirmAction(action: string, targetId: string): Promise<string | null> {
    // Write to job pipe for pi-harness to process
    const dir = dirname(this.jobPipeFile);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    appendFileSync(this.jobPipeFile, JSON.stringify({
      command: action,
      jobId: targetId,
      timestamp: new Date().toISOString(),
    }) + "\n");

    const messages: Record<string, string> = {
      retry: `🔄 Retrying job <code>${targetId}</code>...`,
      cancel: `❌ Cancelled job <code>${targetId}</code>`,
    };

    await this.sendMessage(messages[action] || "Action completed", ButtonKit.mainMenu());
    return null;
  }

  private async handleMenuAction(action: string): Promise<string | null> {
    switch (action) {
      case "menu":
        await this.sendMessage(
          "🏠 <b>pi-harness</b>\n\nSelect an action:",
          ButtonKit.mainMenu()
        );
        break;

      case "jobs":
        const jobs = this.state.getJobs();
        if (jobs.length === 0) {
          await this.sendMessage("📋 <b>No Jobs</b>\n\nNo active jobs.", ButtonKit.mainMenu());
        } else {
          await this.sendMessage(
            "📋 <b>Your Jobs</b>\n\nSelect a job:",
            ButtonKit.jobList(jobs)
          );
        }
        break;

      case "status":
        const latest = this.state.getJobs()[0];
        if (latest) {
          await this.sendMessage(formatJobCard(latest), ButtonKit.jobCard(latest));
        } else {
          await this.sendMessage("✅ <b>All Clear</b>\n\nNo active jobs.", ButtonKit.mainMenu());
        }
        break;

      case "search":
        const searchJobs = this.state.getJobs();
        await this.sendMessage(
          "🔍 <b>Search</b>\n\nSelect a job to view:",
          ButtonKit.jobList(searchJobs)
        );
        break;

      case "settings":
        await this.sendMessage(
          "⚙️ <b>Settings</b>\n\n" +
          "• Notifications: ON\n" +
          "• Auto-retry: OFF\n" +
          "• Log verbosity: Normal",
          ButtonKit.mainMenu()
        );
        break;
    }

    return null;
  }

  private async sendJobLogs(jobId: string, page: number): Promise<void> {
    // Get logs from storage
    const logs = await this.getJobLogs(jobId);
    const pageSize = 5;
    const startIdx = page * pageSize;
    const pageLogs = logs.slice(startIdx, startIdx + pageSize);
    const hasMore = logs.length > startIdx + pageSize;

    const text = `<b>📜 Logs</b>\n<code>${jobId}</code>\n─────────────────\n` +
      pageLogs.map(l => `📍 ${escapeHtml(l)}`).join("\n") +
      `\n─────────────────\nPage ${page + 1}`;

    await this.sendMessage(text, ButtonKit.logPagination(jobId, page, hasMore));
  }

  private async getJobDetail(jobId: string): Promise<JobDetail> {
    const job = this.state.getJob(jobId);
    return {
      id: jobId,
      title: job?.title || "Unknown Job",
      status: job?.status || "unknown",
      logs: await this.getJobLogs(jobId),
    };
  }

  private async getJobLogs(_jobId: string): Promise<string[]> {
    // TODO: Load from actual log storage
    return [
      "[10:00] Job started",
      "[10:01] Running tests...",
      "[10:02] Test 1: PASS",
      "[10:02] Test 2: PASS",
      "[10:03] All tests passed!",
    ];
  }

  /**
   * Send message to Telegram
   */
  private async sendMessage(text: string, keyboard?: InlineKeyboard): Promise<void> {
    await fetch(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: "HTML",
        reply_markup: keyboard,
      }),
    });
  }

  /**
   * Update job state from pi-harness
   */
  updateJobState(job: JobInfo): void {
    this.state.updateJob(job);

    // Send notification with quick actions
    const emoji = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";
    const text = `${emoji} <b>${escapeHtml(job.title)}</b>\n` +
      `Status: ${job.status}${job.progress ? ` (${job.progress})` : ""}`;

    this.sendMessage(text, ButtonKit.jobCard(job));
  }
}

// ============================================================================
// Usage Example
// ============================================================================

/**
 * In your telegram-webhook-server.ts, integrate like this:
 * 
 * import { MobileBot, ButtonKit } from "./telegram-mobile-integration.ts";
 * 
 * const mobileBot = new MobileBot(
 *   process.env.PIBOT_DATA_DIR || "~/.pi-harness-runtime",
 *   BOT_TOKEN,
 *   CHAT_ID,
 *   JOB_PIPE_FILE
 * );
 * 
 * // In callback handler:
 * if (update.callback_query) {
 *   const result = await mobileBot.handleCallback(update.callback_query.data);
 *   if (result) {
 *     // Show error message
 *     await mobileBot.sendMessage(result);
 *   }
 * }
 */
