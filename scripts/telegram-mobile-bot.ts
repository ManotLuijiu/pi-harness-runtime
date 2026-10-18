/**
 * Telegram Mobile Bot - Mobile-First Control Surface
 * 
 * Design principles:
 * - ZERO typing - all actions via buttons
 * - One-tap navigation - contextual action buttons
 * - Persistent context - job state always visible
 * - Quick status - current job at a glance
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";

const keysDir = path.join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "keys");
const dataDir = path.join(process.env.HOME || "/home/frappe", ".pi-harness-runtime", "data");

// Load config
const botToken = fs.readFileSync(path.join(keysDir, "telegram-bot-token.txt"), "utf8").trim();
const chatId = fs.readFileSync(path.join(keysDir, "telegram-chat-id.txt"), "utf8").trim();

// API helpers
async function sendMessage(text: string, keyboard?: InlineKeyboard): Promise<number | null> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    }),
  });
  const data = await response.json() as { ok: boolean; result?: { message_id: number } };
  return data.ok ? data.result?.message_id ?? null : null;
}

async function editMessage(messageId: number, text: string, keyboard?: InlineKeyboard): Promise<boolean> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
    }),
  });
  const data = await response.json() as { ok: boolean };
  return data.ok;
}

async function answerCallback(queryId: string, text?: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: queryId,
      text,
      show_alert: false,
    }),
  });
}

// Types
type InlineKeyboard = Array<Array<{ text: string; callback_data: string }>>;

interface JobStatus {
  id: string;
  title: string;
  status: "pending" | "running" | "done" | "failed";
  progress?: string;
  updatedAt: string;
  messageId?: number;
}

interface JobDetail {
  id: string;
  title: string;
  description?: string;
  status: string;
  logs?: string[];
  diff?: string;
  error?: string;
}

// State management
class JobState {
  private stateFile: string;
  private jobs: Map<string, JobStatus> = new Map();
  private currentJobId: string | null = null;

  constructor() {
    fs.mkdirSync(dataDir, { recursive: true });
    this.stateFile = path.join(dataDir, "telegram-jobs.json");
    this.load();
  }

  private load() {
    try {
      if (existsSync(this.stateFile)) {
        const data = JSON.parse(readFileSync(this.stateFile, "utf8"));
        this.jobs = new Map(data.jobs || []);
        this.currentJobId = data.currentJobId || null;
      }
    } catch (e) {
      console.error("Failed to load state:", e);
    }
  }

  private save() {
    writeFileSync(this.stateFile, JSON.stringify({
      jobs: Array.from(this.jobs.entries()),
      currentJobId: this.currentJobId,
    }));
  }

  setCurrentJob(jobId: string | null) {
    this.currentJobId = jobId;
    this.save();
  }

  getCurrentJob(): JobStatus | null {
    return this.currentJobId ? this.jobs.get(this.currentJobId) ?? null : null;
  }

  updateJob(job: JobStatus) {
    this.jobs.set(job.id, job);
    this.save();
  }

  getAllJobs(): JobStatus[] {
    return Array.from(this.jobs.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  removeJob(jobId: string) {
    this.jobs.delete(jobId);
    if (this.currentJobId === jobId) {
      this.currentJobId = this.jobs.keys().next().value ?? null;
    }
    this.save();
  }
}

// Button generators - NO typing required!
class ButtonKit {
  static jobCard(job: JobStatus): InlineKeyboard {
    const statusIcon = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";
    return [
      [
        { text: "📋 Details", callback_data: `job:details:${job.id}` },
        { text: "📜 Logs", callback_data: `job:logs:${job.id}` },
      ],
      [
        { text: "🔄 Retry", callback_data: `job:retry:${job.id}` },
        { text: "❌ Cancel", callback_data: `job:cancel:${job.id}` },
      ],
    ];
  }

  static mainMenu(): InlineKeyboard {
    return [
      [
        { text: "📋 My Jobs", callback_data: "nav:jobs" },
        { text: "🔍 Search", callback_data: "nav:search" },
      ],
      [
        { text: "📊 Status", callback_data: "nav:status" },
        { text: "⚙️ Settings", callback_data: "nav:settings" },
      ],
    ];
  }

  static jobList(jobs: JobStatus[]): InlineKeyboard {
    const buttons: InlineKeyboard = [];
    for (const job of jobs.slice(0, 5)) {
      const icon = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";
      buttons.push([{ text: `${icon} ${job.title.slice(0, 30)}`, callback_data: `job:select:${job.id}` }]);
    }
    buttons.push([{ text: "🔙 Back to Menu", callback_data: "nav:menu" }]);
    return buttons;
  }

  static detailsPage(job: JobDetail): InlineKeyboard {
    return [
      [
        { text: "📜 Full Logs", callback_data: `job:logs:${job.id}` },
        { text: "📝 View Diff", callback_data: `job:diff:${job.id}` },
      ],
      [
        { text: "🔄 Retry", callback_data: `job:retry:${job.id}` },
        { text: "🗑️ Dismiss", callback_data: `job:dismiss:${job.id}` },
      ],
      [
        { text: "🔙 Back", callback_data: "nav:jobs" },
      ],
    ];
  }

  static confirmAction(action: string, targetId: string): InlineKeyboard {
    return [
      [
        { text: "✅ Confirm", callback_data: `action:confirm:${action}:${targetId}` },
        { text: "❌ Cancel", callback_data: `action:cancel:${action}:${targetId}` },
      ],
    ];
  }
}

// Renderers
function formatJobCard(job: JobStatus): string {
  const statusIcon = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";
  const time = new Date(job.updatedAt).toLocaleTimeString();
  
  return `<b>${statusIcon} ${job.title}</b>\n` +
    `Status: ${job.status}${job.progress ? ` (${job.progress})` : ""}\n` +
    `Updated: ${time}`;
}

function formatJobDetail(job: JobDetail): string {
  const statusIcon = job.status === "running" ? "🔄" : job.status === "done" ? "✅" : job.status === "failed" ? "❌" : "⏳";
  
  let text = `<b>${statusIcon} ${job.title}</b>\n`;
  text += `─────────────────\n`;
  text += `Status: <code>${job.status}</code>\n`;
  
  if (job.description) {
    text += `\n${job.description}\n`;
  }
  
  if (job.error) {
    text += `\n⚠️ <b>Error:</b>\n<code>${job.error.slice(0, 200)}</code>`;
  }
  
  if (job.logs && job.logs.length > 0) {
    text += `\n\n📜 <b>Recent Logs:</b>`;
    for (const log of job.logs.slice(0, 3)) {
      text += `\n<code>${log.slice(0, 100)}</code>`;
    }
  }
  
  return text;
}

// Actions
async function handleJobDetails(jobId: string): Promise<string> {
  // In real implementation, fetch from job state or API
  return formatJobDetail({
    id: jobId,
    title: "Sample Job",
    status: "running",
    description: "This job is processing...",
    logs: ["Starting process...", "Running tests...", "All tests passed"],
  });
}

async function handleJobLogs(jobId: string, page = 0): Promise<{ text: string; keyboard: InlineKeyboard }> {
  // In real implementation, fetch from log storage
  const logs = [
    `[10:00] Job started`,
    `[10:01] Running tests...`,
    `[10:02] Test 1: PASS`,
    `[10:02] Test 2: PASS`,
    `[10:03] All 24 tests passed!`,
  ];
  
  const startIdx = page * 5;
  const pageLogs = logs.slice(startIdx, startIdx + 5);
  
  const text = `<b>📜 Job Logs</b>\n<code>${jobId}</code>\n─────────────────\n` +
    pageLogs.map(l => `📍 ${l}`).join("\n") +
    `\n─────────────────\nPage ${page + 1}`;
  
  const keyboard: InlineKeyboard = [];
  if (logs.length > startIdx + 5) {
    keyboard.push([{ text: "▶️ Next", callback_data: `job:logs:${jobId}:${page + 1}` }]);
  }
  if (page > 0) {
    keyboard.push([{ text: "◀️ Prev", callback_data: `job:logs:${jobId}:${page - 1}` }]);
  }
  keyboard.push([{ text: "🔙 Back", callback_data: `job:details:${jobId}` }]);
  
  return { text, keyboard };
}

// Command handlers - triggered by buttons
export async function handleCallback(queryId: string, data: string): Promise<void> {
  const parts = data.split(":");
  const action = parts[0];
  const subAction = parts[1];
  const targetId = parts[2];
  
  switch (action) {
    case "job": {
      switch (subAction) {
        case "select": {
          // Show job details with action buttons
          const job = new JobState().getAllJobs().find(j => j.id === targetId);
          if (job) {
            const details = await handleJobDetails(targetId);
            await sendMessage(details, ButtonKit.detailsPage({ ...job, description: "" }));
          }
          break;
        }
        
        case "details": {
          const details = await handleJobDetails(targetId);
          await sendMessage(details, ButtonKit.detailsPage({ id: targetId, title: "", status: "" }));
          break;
        }
        
        case "logs": {
          const page = parseInt(parts[3] || "0");
          const { text, keyboard } = await handleJobLogs(targetId, page);
          await sendMessage(text, keyboard);
          break;
        }
        
        case "retry": {
          await sendMessage(
            `🔄 Retry <code>${targetId}</code>?`,
            ButtonKit.confirmAction("retry", targetId)
          );
          break;
        }
        
        case "cancel": {
          await sendMessage(
            `❌ Cancel <code>${targetId}</code>?`,
            ButtonKit.confirmAction("cancel", targetId)
          );
          break;
        }
        
        case "dismiss": {
          new JobState().removeJob(targetId);
          await sendMessage("🗑️ Job dismissed", ButtonKit.mainMenu());
          break;
        }
      }
      break;
    }
    
    case "action": {
      if (subAction === "confirm") {
        const actionToConfirm = parts[2];
        const id = parts[3];
        
        // Execute the confirmed action
        const jobPipe = path.join(dataDir, "job-commands.jsonl");
        appendFileSync(jobPipe, JSON.stringify({
          command: actionToConfirm,
          jobId: id,
          timestamp: new Date().toISOString(),
        }) + "\n");
        
        const messages: Record<string, string> = {
          retry: `🔄 Retrying job <code>${id}</code>...`,
          cancel: `❌ Cancelled job <code>${id}</code>`,
        };
        
        await sendMessage(messages[actionToConfirm] || "Action completed", ButtonKit.mainMenu());
      }
      break;
    }
    
    case "nav": {
      switch (subAction) {
        case "menu": {
          await sendMessage(
            "🏠 <b>pi-harness Control Panel</b>\n\nSelect an action:",
            ButtonKit.mainMenu()
          );
          break;
        }
        
        case "jobs": {
          const jobs = new JobState().getAllJobs();
          if (jobs.length === 0) {
            await sendMessage("📋 <b>No Active Jobs</b>\n\nNo jobs in progress.", ButtonKit.mainMenu());
          } else {
            await sendMessage(
              "📋 <b>Your Jobs</b>\n\nSelect a job:",
              ButtonKit.jobList(jobs)
            );
          }
          break;
        }
        
        case "status": {
          const current = new JobState().getCurrentJob();
          const text = current 
            ? formatJobCard(current) + "\n\n<i>Last updated: just now</i>"
            : "✅ <b>All Clear</b>\n\nNo active jobs.";
          await sendMessage(text, ButtonKit.mainMenu());
          break;
        }
        
        case "search": {
          await sendMessage(
            "🔍 <b>Search</b>\n\nClick a job to search its logs:",
            ButtonKit.jobList(new JobState().getAllJobs())
          );
          break;
        }
        
        case "settings": {
          await sendMessage(
            "⚙️ <b>Settings</b>\n\n" +
            "• Notifications: ON\n" +
            "• Auto-retry: OFF\n" +
            "• Log verbosity: Normal",
            ButtonKit.mainMenu()
          );
          break;
        }
      }
      break;
    }
  }
  
  await answerCallback(queryId);
}

// Send initial welcome
export async function sendWelcome(): Promise<void> {
  await sendMessage(
    "🏠 <b>pi-harness Control Panel</b>\n\n" +
    "Manage your coding tasks from anywhere.\n" +
    "Tap a button below to get started:",
    ButtonKit.mainMenu()
  );
}


