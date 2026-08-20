/**
 * pi-harness-runtime — Codex-style /usage status for pi.
 *
 * Slash commands:
 *   /usage         — show full status (model, local tracking, provider mirror)
 *   /usage today   — focused: this 5h + today (UTC)
 *   /usage week    — focused: this week + lifetime
 *   /usage reset   — clear mirror (forces a fresh auto fetch)
 *
 * Auto-tracks every assistant message via the message_end event.
 * Stores data in ~/.pi/usage-status/  (override with PI_USAGE_DIR for testing).
 *
 * Runs directly from Bun.
 */
import { UsageTracker } from "./tracker.ts";
import { MirrorStore } from "./mirror.ts";
import { MiniMaxQuotaScraper } from "./harness/e2e/minimax-quota-scraper.js";
import { OpenAIQuotaScraper } from "./harness/e2e/openai-quota-scraper.js";
import { parseMiniMaxQuotaText } from "./harness/e2e/minimax-quota-parser.js";
import { CookieWatcher, DEFAULT_DROP_DIR as COOKIE_DROP_DIR, hasAnyCookieSource as sanitizerHasAnyCookieSource, } from "./packages/cookie-sanitizer/src/index.ts";
import { providerFromModelId, } from "./packages/providers/src/provider-id.ts";
import { TUIUsageMonitor, } from "./packages/quota-manager/src/tui-usage-monitor.ts";
import { QuotaManager } from "./packages/quota-manager/src/quota-manager.ts";
import { buildFooterStatusValue } from "./footer-status.ts";
import { registerGithubLoginCommand } from "./packages/clipboard/src/github-login.js";
import { MAX_PROACTIVE_COMPACT_FAILURES, OUTPUT_LIMIT_RESUME_PROMPT, PROACTIVE_COMPACT_COOLDOWN_MS, shouldQueueOutputLimitResume, shouldQueuePostCompactionResume, shouldTriggerProactiveCompact, } from "./proactive-compact.ts";
import { aggregateWindows } from "./windows.ts";
import { renderStatus } from "./renderer.ts";
import { JobStateMachine, } from "./harness/job-state-machine.ts";
import { createTaskGraphManager, } from "./harness/task-graph.js";
import { MasterPlanner } from "./harness/master-planner.ts";
import { RepairEngine } from "./harness/repair-engine.ts";
import { createBlackboard, } from "./harness/blackboard.ts";
import { scheduleAutoResume, cancelAutoResume } from "./harness/index.js";
// --- todo-bd-sync: Two-way sync between rpiv-todo and bd --------------------
// Lazy import - only loads when packages/todo-bd-sync exists
async function initTodoBdSync(pi) {
    try {
        const mod = await import("./packages/todo-bd-sync/src/extension.js");
        mod.registerTodoBdSync(pi, { debug: false });
    }
    catch {
        // todo-bd-sync not available
    }
}
// --- config-capture: Auto-detect and document API configuration -------------
// Lazy import - only loads when packages/config-capture exists
async function initConfigCapture(pi) {
    try {
        const mod = await import("./packages/config-capture/src/index.js");
        mod.registerConfigCapture(pi, { debug: false });
    }
    catch {
        // config-capture not available
    }
}
// --- write-review: Two-agent write with review loop --------------------------
// Lazy import - only loads when packages/write-review exists
async function initWriteReview(pi) {
    try {
        const mod = await import("./packages/write-review/src/index.js");
        mod.injectWriterInstructions(pi);
    }
    catch {
        // write-review not available
    }
}
import { homedir } from "node:os";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
// --- Debug log → file instead of TUI ---------------------------------
const DEBUG_LOG_DIR = join(homedir(), ".pi", "harness-logs");
const DEBUG_LOG_PATH = join(DEBUG_LOG_DIR, "harness-debug.log");
try {
    if (!existsSync(DEBUG_LOG_DIR))
        mkdirSync(DEBUG_LOG_DIR, { recursive: true });
}
catch {
    /* non-fatal */
}
// Write harness runtime logs to file only (NOT to TUI stdout)
function _debugLog(...args) {
    try {
        const line = new Date().toISOString() +
            " " +
            args
                .map((a) => (typeof a === "object" ? JSON.stringify(a) : String(a)))
                .join(" ");
        appendFileSync(DEBUG_LOG_PATH, line + "\n");
    }
    catch {
        // non-fatal
    }
}
// --- Selective console override — harness DEBUG → file only --------
// Real errors (no [DEBUG prefix) still print to TUI so you notice problems.
const _origLog = console.log.bind(console);
const _origError = console.error.bind(console);
console.log = (...args) => {
    _origLog(...args);
    _debugLog(...args);
};
console.error = (...args) => {
    const first = String(args[0] ?? "");
    if (first.startsWith("[DEBUG")) {
        _debugLog(...args);
    }
    else {
        _origError(...args);
        _debugLog(...args);
    }
};
// --- Harness Runtime State --------------------------------------------
const HARNESS_ROOT_DIR = join(homedir(), ".pi", "harness");
let currentSession = null;
/**
 * Safely extract a text view from an LLM message. Used to feed the TUI
 * quota-signal extractor. Handles string content, array-of-parts content
 * (with `text` fields), and falls back to a stringified JSON for unknown
 * shapes. Never throws.
 */
function readMessageText(message) {
    try {
        if (!message || typeof message !== "object")
            return "";
        const m = message;
        if (typeof m.content === "string")
            return m.content;
        if (Array.isArray(m.content)) {
            const parts = [];
            for (const p of m.content) {
                if (!p)
                    continue;
                if (typeof p === "string") {
                    parts.push(p);
                }
                else if (typeof p === "object") {
                    const obj = p;
                    if (typeof obj.text === "string")
                        parts.push(obj.text);
                    else if (typeof obj.content === "string")
                        parts.push(obj.content);
                }
            }
            return parts.join("\n");
        }
        // Fallback: best-effort stringification. Never include cookie-shaped
        // data; we only stringify LLM message shapes which are JSON-safe.
        return JSON.stringify(message).slice(0, 8000);
    }
    catch {
        return "";
    }
}
function ensureHarnessDir() {
    if (!existsSync(HARNESS_ROOT_DIR)) {
        mkdirSync(HARNESS_ROOT_DIR, { recursive: true });
    }
    // Also ensure the shared cookie drop folder exists
    const cookieDropDir = join(homedir(), ".pi-harness-runtime", "cookies");
    if (!existsSync(cookieDropDir)) {
        mkdirSync(cookieDropDir, { recursive: true });
    }
}
async function getCheckpointManager() {
    const { JsonCheckpointManager } = await import("./packages/checkpoint/src/checkpoint-manager.ts");
    return new JsonCheckpointManager(HARNESS_ROOT_DIR);
}
function isOutputLimitResumePromptMessage(message) {
    if (message.role !== "user") {
        return false;
    }
    if (typeof message.content === "string") {
        return message.content === OUTPUT_LIMIT_RESUME_PROMPT;
    }
    if (!Array.isArray(message.content)) {
        return false;
    }
    return (message.content
        .filter((part) => part &&
        typeof part === "object" &&
        part.type === "text" &&
        typeof part.text === "string")
        .map((part) => part.text)
        .join("\n") === OUTPUT_LIMIT_RESUME_PROMPT);
}
export default function (pi) {
    const tracker = new UsageTracker();
    const mirrorStore = new MirrorStore();
    ensureHarnessDir();
    // --- todo-bd-sync: Initialize two-way sync with bd ---------------
    // Start async init but don't await - runs in background
    void initTodoBdSync(pi);
    // --- config-capture: Auto-detect API config and document it -----------
    void initConfigCapture(pi);
    // --- write-review: Two-agent write with review loop ----------------------
    void initWriteReview(pi);
    // --- Auto-Invoke rpiv-todo via System Prompt ------------------------
    // This makes the todo overlay ALWAYS activate at session start
    const AUTO_TODO_INVOKE_HINT = `

You have access to a todo tool that shows a persistent task overlay.
ALWAYS use it at the START of every session to capture user requirements as tasks.
When the user gives you a multi-step task:
1. Immediately create todo items for each step using the todo tool
2. Keep tasks updated - mark in_progress when working, completed when done
3. When a task is completed, continue to the next or ask the user

The todo overlay persists and helps track progress across your conversation.
`;
    const COMMIT_BUILD_CHECKLIST = `

BEFORE committing code or triggering builds, ALWAYS check:
1. Run 'bd ready' to see pending tasks
2. Mark completed tasks with 'bd close <id> --reason "Done"'
3. Acknowledge pending tasks before proceeding
4. Never commit/build without acknowledging pending todos
`;
    const WRITE_REVIEW_HINT = `

WRITER-REVIEWER WORKFLOW:
When working on a feature from {project}/wiki/* or {project}/.write-review/:
1. Read the prompt/task file to understand requirements
2. Write clean, complete code
3. Mark task "in_progress" in todos
4. When code is ready, trigger review with \`{done} bd create "Review: <task>" -t review -p 1 && bd close <id> --reason "Approved"\`
5. If reviewer requests changes, update code and re-review
6. Never skip review on non-trivial features
`;
    const DOCKER_CLEANUP_HINT = `

DOCKER CLEANUP WORKFLOW:
AFTER running any Docker build command (docker build, docker compose build, docker compose up --build):
1. ALWAYS run \`docker builder prune -f\` to clean up build cache
2. This saves disk space - Docker build cache grows fast
3. Example: After \`docker compose up --build\`, run \`docker builder prune -f\`
4. For aggressive cleanup: \`docker builder prune -a -f\` (removes ALL unused cache)
`;
    let firstAgentStart = true;
    pi.on("before_agent_start", async (event) => {
        if (firstAgentStart) {
            event.systemPrompt += AUTO_TODO_INVOKE_HINT;
            event.systemPrompt += COMMIT_BUILD_CHECKLIST;
            event.systemPrompt += WRITE_REVIEW_HINT;
            event.systemPrompt += DOCKER_CLEANUP_HINT;
            firstAgentStart = false;
        }
    });
    // --- Auto-Todo Reminder on Build Commands ---------------------------
    // Detect build commands and remind agent to update todos
    const BUILD_COMMANDS = [
        "docker build",
        "docker compose build",
        "docker compose up",
        "npm run build",
        "yarn build",
        "pnpm build",
        "bun run build",
        "make build",
        "gradle build",
        "dotnet build",
        "cargo build",
        "go build",
        "bench build",
    ];
    const TODO_BUILD_REMINDER = `

IMPORTANT - TODO UPDATE REMINDER:
Before running a build, ensure you update the current task status:
1. Mark the task as in_progress with bd update <id> --status in_progress
2. After build succeeds, update the task: bd close <id> --reason "Done" or bd update <id> --status pending

Run \`bd ready\` to see current tasks.
`;
    // Detect build commands and append todo reminder to their output
    pi.on("tool_execution_end", async (event) => {
        const toolName = event.toolName;
        if (toolName !== "bash")
            return;
        const result = event.result;
        if (!result)
            return;
        // Handle content that might be an array or object
        const rawContent = result.content;
        let content;
        if (typeof rawContent === "string") {
            content = rawContent;
        }
        else if (Array.isArray(rawContent)) {
            content = rawContent.map((c) => typeof c === "string" ? c : JSON.stringify(c)).join("\n");
        }
        else {
            content = JSON.stringify(rawContent ?? "");
        }
        // Check if this is a build command
        const isBuildCommand = BUILD_COMMANDS.some((cmd) => content.toLowerCase().includes(cmd.toLowerCase()));
        if (isBuildCommand && !content.includes("bd ready") && !content.includes("TODO UPDATE")) {
            // Append todo reminder without changing the tool result content shape.
            const reminderBlock = { type: "text", text: TODO_BUILD_REMINDER };
            if (Array.isArray(rawContent)) {
                result.content = [...rawContent, reminderBlock];
            }
            else {
                result.content = [{ type: "text", text: content + TODO_BUILD_REMINDER }];
            }
        }
    });
    // --- Auto-track every assistant message ------------------------------
    pi.on("message_end", async (event, ctx) => {
        if (isOutputLimitResumePromptMessage(event.message)) {
            pendingOutputLimitResumeAfterSettled = false;
            return;
        }
        if (event.message.role !== "assistant")
            return;
        // DEBUG: Log model ID
        const m = event.message;
        if (shouldQueueOutputLimitResume(m, outputLimitResumeAttempts, ctx.hasPendingMessages())) {
            outputLimitResumeAttempts += 1;
            pendingOutputLimitResumeAfterCompact = true;
            pendingOutputLimitResumeAfterSettled = true;
            queueAutoResume("output-limit", OUTPUT_LIMIT_RESUME_PROMPT, "steer");
        }
        else if (m.stopReason === "stop") {
            outputLimitResumeAttempts = 0;
            pendingOutputLimitResumeAfterSettled = false;
        }
        if (!m.usage)
            return;
        tracker.append({
            ts: Date.now(),
            model: ctx.model?.id ?? "unknown",
            input: m.usage.input ?? 0,
            output: m.usage.output ?? 0,
            cache_read: m.usage.cacheRead ?? 0,
            cache_write: m.usage.cacheWrite ?? 0,
            cost: m.usage.cost?.total ?? 0,
        });
        // Feed TUI quota-signal extractor with the assistant message text.
        // Best-effort — never throws. Coalesces provider quota notifications
        // (e.g. "OpenAI: context length exceeded, reset in 3 hr 27 min") into
        // the per-provider mirror via `tuiMonitor`.
        try {
            const text = readMessageText(event.message);
            if (text) {
                // 	"[DEBUG message_end] Processing TUI text (first 200 chars):",
                // 	text.substring(0, 200),
                // );
                tuiMonitor.processMessage(text);
            }
        }
        catch (e) {
            // console.error("[DEBUG message_end] TUI processMessage error:", e);
        }
    });
    // --- Smart quota fetch for MiniMax status ------------------------
    const MINIMAX_REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;
    const MINIMAX_REFRESH_TOKEN_THRESHOLD = 200_000;
    const MINIMAX_REFRESH_REQUEST_THRESHOLD = 12;
    const quotaScraper = process.env.QUOTA_COOKIE_FILE
        ? new MiniMaxQuotaScraper({ cookieFile: process.env.QUOTA_COOKIE_FILE })
        : new MiniMaxQuotaScraper();
    // --- Smart quota fetch for OpenAI status -------------------------
    const OPENAI_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    const _openaiQuotaScraper = new OpenAIQuotaScraper({ quiet: true });
    let lastOpenAIQuotaFetchAt = 0;
    // --- Cookie sanitizer integration ------------------------------------
    // The drop folder is the user-facing, forgiving input. The canonical
    // cache (`~/.config/minimax-cookies.txt`) is the runtime-owned,
    // normalized output that `MiniMaxQuotaScraper` reads. Either being
    // present enables scraping.
    const cookieDropDir = COOKIE_DROP_DIR;
    const cookieCachePath = join(homedir(), ".config", "minimax-cookies.txt");
    const hasCookieSource = () => {
        try {
            if (existsSync(cookieCachePath))
                return true;
        }
        catch {
            // ignore
        }
        try {
            return sanitizerHasAnyCookieSource(cookieDropDir);
        }
        catch {
            return false;
        }
    };
    const cookieQuotaAutoFetchAvailable = hasCookieSource();
    // --- TUI quota signal plumbing (OpenAI / GLM / Anthropic / OpenRouter) --
    // The TUIUsageMonitor parses provider quota-exhaustion messages from pi's
    // TUI / message stream and emits signals we write to per-provider mirror
    // entries. For providers that don't expose a continuous usage API this is
    // the only path to surface data in the footer.
    const quotaManager = new QuotaManager();
    const tuiMonitor = new TUIUsageMonitor({ quotaManager });
    tuiMonitor.on("signal", (signal) => {
        // 	"[DEBUG tuiMonitor signal] Received signal:",
        // 	JSON.stringify(signal),
        // );
        try {
            writeMirrorRecord(signal.provider, {
                synced_at: signal.timestamp,
                source: "tui-signal",
                exhausted: signal.exhausted,
                limitType: signal.limitType,
                remainingPct: signal.remainingPct,
                resets_at: signal.resetsAt,
            });
        }
        catch (e) {
            console.error("[pi-harness] tui-signal write failed:", e instanceof Error ? e.message : String(e));
        }
    });
    let lastQuotaAutoFetchAt = 0;
    // Live watcher — sanitises on every change in the drop folder.
    const cookieWatcher = new CookieWatcher({
        dropDir: cookieDropDir,
        syncOptions: { cachePath: cookieCachePath, providerHint: "minimax" },
        onEvent: (event) => {
            if (event.kind === "sync-error" || event.kind === "watcher-error") {
                const msg = "message" in event ? event.message : "";
                if (msg.includes("ENOSPC")) {
                    console.error("[pi-harness] cookie-sanitizer: ENOSPC — inotify watchers exhausted.\n" +
                        "  Fix (run once as sudo):\n" +
                        "    echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-watch.conf\n" +
                        "    sudo sysctl --system");
                }
                else {
                    console.error("[pi-harness] cookie-sanitizer:", msg);
                }
            }
            // A successful sync means the canonical cache is fresh; the
            // next autoFetchQuota() should pick it up immediately. Reset
            // the rate-limit so we don't wait 15 min for the first scrape.
            if (event.kind === "sync-ok") {
                lastQuotaAutoFetchAt = 0;
            }
        },
    });
    try {
        cookieWatcher.start();
        // Sync existing drop-folder cookies now (ignoreInitial: true means
        // the watcher won't do this automatically on startup).
        cookieWatcher.triggerNow();
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("ENOSPC")) {
            console.error("[pi-harness] cookie-sanitizer watcher: ENOSPC — " +
                "inotify watcher limit reached.\n" +
                "Fix (once, as root):\n" +
                "  echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-watch.conf\n" +
                "  sudo sysctl --system\n" +
                "Drop folder sync still works — polling will resume automatically.");
        }
        else {
            console.error("[pi-harness] cookie-sanitizer watcher failed to start:", msg);
        }
    }
    let footerStatusCtx = null;
    let quotaAutoFetchInFlight = false;
    let proactiveCompactInFlight = false;
    let lastProactiveCompactAt = 0;
    let consecutiveCompactFailures = 0;
    let proactiveCompactCircuitReported = false;
    let outputLimitResumeAttempts = 0;
    let pendingOutputLimitResumeAfterCompact = false;
    let pendingOutputLimitResumeAfterSettled = false;
    // --- Context-usage escalating warning tiers -----------------------------
    // Amber at 75%, red at 85%. No notify above 90% (proactive compact handles it).
    // Per-session dedup: only notify when crossing INTO a new higher tier.
    const TIER_WARNING = 0.75; // amber
    const TIER_ERROR = 0.85; // red
    let lastNotifiedTier = "none";
    function maybeNotifyContextUsage(ctx) {
        const usage = ctx.getContextUsage();
        const pct = usage?.percent;
        if (pct === null || pct === undefined)
            return;
        if (pct >= 0.9)
            return; // proactive compact handles 90%+
        const tier = pct >= TIER_ERROR ? "error" : pct >= TIER_WARNING ? "warning" : "none";
        // Only notify when crossing into a strictly higher tier
        if (tier === "none") {
            lastNotifiedTier = "none";
            return;
        }
        if (tier === "warning" &&
            lastNotifiedTier !== "warning" &&
            lastNotifiedTier !== "error") {
            lastNotifiedTier = "warning";
            ctx.ui.notify(`Context at ${Math.round(pct * 100)}% — consider condensing`, "info");
            return;
        }
        if (tier === "error" && lastNotifiedTier !== "error") {
            lastNotifiedTier = "error";
            ctx.ui.notify(`Context at ${Math.round(pct * 100)}% — approaching limit`, "warning");
            return;
        }
    }
    function writeMirrorRecord(provider, record) {
        // 	"[DEBUG writeMirrorRecord] Writing record for provider:",
        // 	provider,
        // 	"record:",
        // 	JSON.stringify(record),
        // );
        mirrorStore.writeProvider(provider, { ...record, provider });
        if (footerStatusCtx) {
            refreshFooterStatus(footerStatusCtx, tracker, mirrorStore, hasCookieSource, () => lastActiveProvider);
        }
    }
    async function hasBrowserProfileAutoFetchSource() {
        try {
            const { getLiveSessionPath, getStatusPath } = await import("./packages/auth/src/minimax-browser-auth.ts");
            return existsSync(getLiveSessionPath()) || existsSync(getStatusPath());
        }
        catch {
            return false;
        }
    }
    function isMiniMaxModel(modelId) {
        return providerFromModelId(modelId) === "minimax";
    }
    /** Active provider for the current/last-seen model. Updated by event handlers. */
    let lastActiveProvider = null;
    /** Set the active provider; triggers a footer refresh. */
    function noteActiveProvider(modelId) {
        const p = providerFromModelId(modelId);
        // 	"[DEBUG noteActiveProvider] modelId =",
        // 	modelId,
        // 	"-> provider =",
        // 	p,
        // );
        if (p !== lastActiveProvider) {
            lastActiveProvider = p;
            if (footerStatusCtx) {
                refreshFooterStatus(footerStatusCtx, tracker, mirrorStore, hasCookieSource, () => lastActiveProvider);
            }
        }
    }
    function getMiniMaxUsageSince(sinceMs) {
        const records = tracker
            .since(sinceMs)
            .filter((record) => isMiniMaxModel(record.model));
        return {
            tokens: records.reduce((sum, record) => sum + record.input + record.output, 0),
            requests: records.length,
        };
    }
    async function autoFetchQuotaFromBrowserProfile(suppressErrors = false) {
        if (!(await hasBrowserProfileAutoFetchSource())) {
            return null;
        }
        try {
            const { scrapeWithExistingProfile } = await import("./packages/auth/src/minimax-browser-auth.ts");
            const status = await scrapeWithExistingProfile({ quiet: true });
            if (status.page_url.includes("unified-login") ||
                status.page_url.includes("login")) {
                return null;
            }
            const rawText = status.usage_lines?.join("\n")?.trim() ||
                status.detected_text_sample?.trim() ||
                "";
            if (!rawText) {
                return null;
            }
            const parsed = parseMiniMaxQuotaText(rawText);
            if (parsed.h5UsedPct === undefined &&
                parsed.weeklyUsedPct === undefined) {
                return null;
            }
            return {
                synced_at: status.checked_at,
                provider: "minimax",
                h5_used_pct: parsed.h5UsedPct,
                h5_resets_at: parsed.h5ResetsAt,
                weekly_used_pct: parsed.weeklyUsedPct,
                weekly_resets_at: parsed.weeklyResetsAt,
            };
        }
        catch (error) {
            if (!suppressErrors) {
                console.error("[pi-harness] Browser-profile quota fetch skipped:", error instanceof Error ? error.message : String(error));
            }
            return null;
        }
    }
    async function autoFetchQuota(options) {
        const suppressErrors = options?.suppressErrors === true;
        const profileRecord = await autoFetchQuotaFromBrowserProfile(suppressErrors);
        if (profileRecord) {
            writeMirrorRecord("minimax", {
                synced_at: profileRecord.synced_at,
                source: "scrape",
                model: profileRecord.model,
                h5_used_pct: profileRecord.h5_used_pct,
                h5_resets_at: profileRecord.h5_resets_at,
                weekly_used_pct: profileRecord.weekly_used_pct,
                weekly_resets_at: profileRecord.weekly_resets_at,
            });
            return true;
        }
        if (!cookieQuotaAutoFetchAvailable) {
            return false;
        }
        try {
            const data = await quotaScraper.scrape();
            writeMirrorRecord("minimax", {
                synced_at: data.scrapedAt,
                source: "scrape",
                h5_used_pct: data.h5UsedPct,
                h5_resets_at: data.h5ResetsAt,
                h5_resets_at_epoch: data.h5ResetsAtEpoch,
                weekly_used_pct: data.weeklyUsedPct,
                weekly_resets_at: data.weeklyResetsAt,
                weekly_resets_at_epoch: data.weeklyResetsAtEpoch,
            });
            return true;
        }
        catch (error) {
            if (!suppressErrors) {
                console.error("[pi-harness] Quota auto-fetch skipped:", error instanceof Error ? error.message : String(error));
            }
            return false;
        }
    }
    /**
     * Auto-fetch OpenAI quota via ChatGPT Codex analytics.
     * GPT has WEEKLY-ONLY limits (no 5h window).
     */
    async function autoFetchOpenAIQuota(options) {
        const suppressErrors = options?.suppressErrors === true;
        try {
            // Try direct API first (faster)
            const directResult = await _openaiQuotaScraper.scrapeDirect();
            if (directResult) {
                writeMirrorRecord("openai", {
                    synced_at: directResult.scrapedAt,
                    source: "scrape",
                    weekly_used_pct: directResult.weeklyUsedPct,
                    weekly_resets_at: directResult.weeklyResetsAt,
                    weekly_resets_at_epoch: directResult.weeklyResetsAtEpoch,
                    // No 5h window for GPT - set to undefined
                    h5_used_pct: undefined,
                });
                return true;
            }
            // Fall back to browser scrape
            const data = await _openaiQuotaScraper.scrape();
            writeMirrorRecord("openai", {
                synced_at: data.scrapedAt,
                source: "scrape",
                weekly_used_pct: data.weeklyUsedPct,
                weekly_resets_at: data.weeklyResetsAt,
                weekly_resets_at_epoch: data.weeklyResetsAtEpoch,
                // No 5h window for GPT - set to undefined
                h5_used_pct: undefined,
            });
            return true;
        }
        catch (error) {
            if (!suppressErrors) {
                console.error("[pi-harness] OpenAI quota auto-fetch skipped:", error instanceof Error ? error.message : String(error));
            }
            return false;
        }
    }
    async function maybeAutoFetchQuota(modelId) {
        const provider = providerFromModelId(modelId);
        // MiniMax path
        if (provider === "minimax") {
            if (quotaAutoFetchInFlight)
                return;
            const nowMs = Date.now();
            if (nowMs - lastQuotaAutoFetchAt < MINIMAX_REFRESH_MIN_INTERVAL_MS) {
                return;
            }
            const mirror = mirrorStore.read();
            const freshness = mirrorStore.freshness(mirror, nowMs);
            const shouldFetchBaseline = !mirror || freshness === "expired";
            const usageSinceSync = getMiniMaxUsageSince(mirror?.synced_at ? Date.parse(mirror.synced_at) : 0);
            const shouldFetchFromUsage = usageSinceSync.tokens >= MINIMAX_REFRESH_TOKEN_THRESHOLD ||
                usageSinceSync.requests >= MINIMAX_REFRESH_REQUEST_THRESHOLD ||
                (freshness === "stale" && usageSinceSync.requests > 0);
            if (!shouldFetchBaseline && !shouldFetchFromUsage) {
                return;
            }
            quotaAutoFetchInFlight = true;
            lastQuotaAutoFetchAt = nowMs;
            try {
                await autoFetchQuota({ suppressErrors: true });
            }
            finally {
                quotaAutoFetchInFlight = false;
            }
            return;
        }
        // OpenAI path (GPT has weekly-only limits, no 5h window)
        if (provider === "openai") {
            if (quotaAutoFetchInFlight)
                return;
            const nowMs = Date.now();
            if (nowMs - lastOpenAIQuotaFetchAt < OPENAI_REFRESH_MIN_INTERVAL_MS) {
                return;
            }
            // Check if OpenAI cookie file exists
            const openaiCookieFile = join(homedir(), ".config", "openai-cookies.txt");
            if (!existsSync(openaiCookieFile)) {
                return;
            }
            quotaAutoFetchInFlight = true;
            lastOpenAIQuotaFetchAt = nowMs;
            try {
                await autoFetchOpenAIQuota({ suppressErrors: true });
            }
            finally {
                quotaAutoFetchInFlight = false;
            }
            return;
        }
        // Other providers (GLM, Anthropic, etc.) - TUI signal path only for now
        return;
    }
    // --- /usage — show full status ---------------------------------------
    pi.registerCommand("usage", {
        description: "Show Codex-style usage status (local + provider mirror)",
        handler: async (_args, ctx) => {
            const local = aggregateWindows(tracker.all());
            const mirror = mirrorStore.read();
            const output = renderStatus({
                model: ctx.model?.id ?? null,
                cwd: ctx.cwd ?? process.cwd(),
                local,
                mirror,
                mirrorStore,
                nowMs: Date.now(),
            });
            ctx.ui.notify(output, "info");
        },
    });
    // --- /usage refresh — force auto-fetch ----------------------------
    pi.registerCommand("usage-refresh", {
        description: "Force refresh quota from provider console",
        handler: async (_args, ctx) => {
            const autoFetchAvailable = cookieQuotaAutoFetchAvailable ||
                (await hasBrowserProfileAutoFetchSource());
            if (!autoFetchAvailable) {
                ctx.ui.notify("MiniMax cookies not found. Drop any cookie file (Netscape or EditThisCookie JSON) into ~/.pi-harness-runtime/cookies/ — the runtime normalizes it for you. Or run `bun packages/auth/src/run-minimax-auth.ts auth`.", "warning");
                return;
            }
            ctx.ui.notify("Fetching quota from MiniMax console...", "info");
            const refreshed = await autoFetchQuota();
            ctx.ui.notify(refreshed
                ? "Quota refreshed. Run `/usage` to see updated status."
                : "Quota refresh skipped. Check cookie validity or MiniMax auth profile, then run `/usage` again.", "info");
        },
    });
    // --- /usage today — focused view -------------------------------------
    pi.registerCommand("usage-today", {
        description: "Show today's usage + 5h window",
        handler: async (_args, ctx) => {
            const local = aggregateWindows(tracker.all());
            const lines = [
                " Today's usage",
                "-------------------------------------",
                ` Model:       ${ctx.model?.id ?? "unknown"}`,
                ` Today:       ${local.today.tokens} tokens · ${local.today.requests} requests · $${local.today.cost.toFixed(4)}`,
                ` This 5h:     ${local.five_h.tokens} tokens · ${local.five_h.requests} requests · $${local.five_h.cost.toFixed(4)}`,
                "",
                " Run `/usage` for full status with the latest auto-fetched provider quota.",
            ];
            ctx.ui.notify(lines.join("\n"), "info");
        },
    });
    // --- /usage week — focused view --------------------------------------
    pi.registerCommand("usage-week", {
        description: "Show this week's usage + lifetime totals",
        handler: async (_args, ctx) => {
            const local = aggregateWindows(tracker.all());
            const lines = [
                " This week's usage",
                "-------------------------------------",
                ` Model:       ${ctx.model?.id ?? "unknown"}`,
                ` This week:   ${local.weekly.tokens} tokens · ${local.weekly.requests} requests · $${local.weekly.cost.toFixed(4)}`,
                ` Lifetime:    ${local.lifetime.tokens} tokens · ${local.lifetime.requests} requests · $${local.lifetime.cost.toFixed(4)}`,
                "",
                " Run `/usage` for full status with provider mirror.",
            ];
            ctx.ui.notify(lines.join("\n"), "info");
        },
    });
    // --- /usage reset — clear mirror -------------------------------------
    pi.registerCommand("usage-reset", {
        description: "Clear the provider mirror (force re-sync next time)",
        handler: async (_args, ctx) => {
            const ok = await ctx.ui.confirm("Clear provider mirror?", "This will delete ~/.pi/usage-status/mirror.json. Local usage log is preserved.");
            if (!ok) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }
            // Delete mirror file
            try {
                const { unlinkSync, existsSync } = await import("node:fs");
                if (existsSync(mirrorStore["path"] ?? "")) {
                    // The path is private; use the JSON path getter via internal logic
                    // Cleaner: just unlink the known mirror path
                }
                // Simpler: import getMirrorPath and unlink
                const { getMirrorPath } = await import("./cli.ts");
                unlinkSync(getMirrorPath());
                ctx.ui.notify("Mirror cleared. The next auto refresh will repopulate it.", "info");
                footerStatusCtx = ctx;
                refreshFooterStatus(ctx, tracker, mirrorStore, hasCookieSource, () => lastActiveProvider);
            }
            catch (e) {
                ctx.ui.notify(`Failed to clear mirror: ${e}`, "error");
            }
        },
    });
    // --- /github-login — Connect GitHub Gist for clipboard sync ------------
    registerGithubLoginCommand(pi);
    // --- Ctrl+Shift+C — Copy to clipboard + sync to Gist ------------
    // NOTE: Shortcut disabled to avoid conflict with pi-usage-status extension
    // which also registers ctrl+shift+c for clipboard sync.
    // The copyAndSync function is still exported and can be called manually.
    // registerCopySyncShortcut(pi, Key);
    // --- /harness start — Start a new harness job ----------------------
    pi.registerCommand("harness-start", {
        description: "Start a new harness job: /harness start <requirement>",
        handler: async (args, ctx) => {
            if (!args.trim()) {
                ctx.ui.notify("Usage: /harness start <requirement>", "error");
                return;
            }
            const jobId = `job-${Date.now()}`;
            const requirement = args.trim();
            ctx.ui.notify(`Starting harness job ${jobId}...`, "info");
            try {
                const cm = await getCheckpointManager();
                const machine = new JobStateMachine({ checkpointManager: cm });
                const result = await machine.createJob(jobId, requirement);
                if (!result.success) {
                    ctx.ui.notify(`Failed to create job: ${result.error}`, "error");
                    return;
                }
                // Create task graph using heuristic planner
                const planner = new MasterPlanner();
                const planResult = await planner.createPlan(requirement, jobId, HARNESS_ROOT_DIR);
                if (!planResult.success) {
                    ctx.ui.notify(`Failed to create plan: ${planResult.error}`, "error");
                    return;
                }
                // Create blackboard
                const blackboard = createBlackboard(jobId, HARNESS_ROOT_DIR, planResult.graph);
                // Create repair engine
                const repairEngine = new RepairEngine(HARNESS_ROOT_DIR);
                // Store session
                currentSession = {
                    jobId,
                    machine,
                    graph: createTaskGraphManager(),
                    blackboard,
                    repairEngine,
                    createdAt: new Date().toISOString(),
                };
                const taskCount = planResult.graph?.nodes
                    ? Object.keys(planResult.graph.nodes).length
                    : 0;
                ctx.ui.notify(`Job ${jobId} created with ${taskCount} tasks.\n` +
                    `Requirement: ${requirement}\n\n` +
                    `Run /harness status to see tasks, or /harness tasks to list them.`, "info");
            }
            catch (e) {
                ctx.ui.notify(`Error starting harness: ${e}`, "error");
            }
        },
    });
    // --- /harness status — Show harness job status ---------------------
    pi.registerCommand("harness-status", {
        description: "Show current harness job status",
        handler: async (_args, ctx) => {
            if (!currentSession) {
                ctx.ui.notify("No active harness job. Run /harness start <requirement> to begin.", "info");
                return;
            }
            const summary = currentSession.machine.getStatusSummary();
            if (!summary) {
                ctx.ui.notify("Failed to get job status.", "error");
                return;
            }
            const progress = currentSession.graph.getProgressSummary();
            const lines = [
                `Harness Job Status`,
                `${"-".repeat(40)}`,
                `Job ID:     ${currentSession.jobId}`,
                `Status:     ${summary.status}`,
                `Terminal:   ${summary.isTerminal ? "Yes" : "No"}`,
                `Can Resume: ${summary.canResume ? "Yes" : "No"}`,
                `${"-".repeat(40)}`,
                `Tasks:      ${progress.done}/${progress.total} done, ${progress.running} running, ${progress.failed} failed`,
                `Created:    ${currentSession.createdAt}`,
                `${"-".repeat(40)}`,
                `Run /harness tasks for task list`,
            ];
            ctx.ui.notify(lines.join("\n"), "info");
        },
    });
    // --- /harness tasks — List all tasks -------------------------------
    pi.registerCommand("harness-tasks", {
        description: "List all tasks in the current harness job",
        handler: async (_args, ctx) => {
            if (!currentSession) {
                ctx.ui.notify("No active harness job. Run /harness start <requirement> to begin.", "info");
                return;
            }
            const tasks = currentSession.graph.getAllTasks();
            if (tasks.length === 0) {
                ctx.ui.notify("No tasks found. The job may not have been planned yet.", "info");
                return;
            }
            const lines = [
                `Tasks for Job ${currentSession.jobId}`,
                `${"-".repeat(50)}`,
            ];
            for (const task of tasks) {
                const status = task.status.padEnd(10);
                lines.push(`[${task.id}] ${status} ${task.title}`);
            }
            lines.push(`${"-".repeat(50)}`);
            const ready = currentSession.graph.getReadyTasks();
            lines.push(`${ready.length} tasks ready to execute.`);
            ctx.ui.notify(lines.join("\n"), "info");
        },
    });
    // --- /harness pause — Pause the harness job -----------------------
    pi.registerCommand("harness-pause", {
        description: "Pause the current harness job",
        handler: async (_args, ctx) => {
            if (!currentSession) {
                ctx.ui.notify("No active harness job to pause.", "info");
                return;
            }
            const checkpoint = currentSession.machine.getCheckpoint();
            if (!checkpoint) {
                ctx.ui.notify("Failed to get checkpoint.", "error");
                return;
            }
            // Read 5h reset epoch from mirror so we can schedule auto-resume
            const mirror = mirrorStore.readProvider("minimax");
            const resumeAtIso = mirror?.h5_resets_at_epoch
                ? new Date(mirror.h5_resets_at_epoch).toISOString()
                : undefined;
            const result = await currentSession.machine.transition("paused_quota");
            if (!result.success) {
                ctx.ui.notify(`Failed to pause: ${result.error}`, "error");
                return;
            }
            // Persist resumeAt so auto-resume survives worker restart
            if (resumeAtIso) {
                await currentSession.machine.setResumeTime(resumeAtIso);
            }
            // Schedule auto-resume for 5h quota
            if (resumeAtIso) {
                const scheduled = scheduleAutoResume("minimax", currentSession.machine, mirrorStore);
                ctx.ui.notify(`Job paused.\n` +
                    `Auto-resume at ${scheduled ?? resumeAtIso} (5h quota exhausted).\n` +
                    `Run /harness cancel to abort.`, "info");
            }
            else {
                ctx.ui.notify(`Job ${currentSession.jobId} paused.\n` +
                    `Current status: paused_quota\n` +
                    `Run /harness resume to continue.`, "info");
            }
        },
    });
    // --- /harness resume — Resume the harness job -----------------------
    pi.registerCommand("harness-resume", {
        description: "Resume a paused harness job",
        handler: async (_args, ctx) => {
            if (!currentSession) {
                ctx.ui.notify("No active harness job to resume.", "info");
                return;
            }
            const checkpoint = currentSession.machine.getCheckpoint();
            if (!checkpoint || checkpoint.status !== "paused_quota") {
                ctx.ui.notify("Job is not paused. Run /harness start to begin a new job.", "info");
                return;
            }
            const result = await currentSession.machine.transition("running");
            if (!result.success) {
                ctx.ui.notify(`Failed to resume: ${result.error}`, "error");
                return;
            }
            // Cancel any scheduled auto-resume for this job
            cancelAutoResume(currentSession.jobId);
            ctx.ui.notify(`Job ${currentSession.jobId} resumed.\n` +
                `Current status: running\n` +
                `Run /harness status to monitor progress.`, "info");
        },
    });
    // --- /harness cancel — Cancel the harness job ----------------------
    pi.registerCommand("harness-cancel", {
        description: "Cancel the current harness job",
        handler: async (_args, ctx) => {
            if (!currentSession) {
                ctx.ui.notify("No active harness job to cancel.", "info");
                return;
            }
            const ok = await ctx.ui.confirm(`Cancel job ${currentSession.jobId}?`, "This will mark the job as cancelled. Task state is preserved but work stops.");
            if (!ok) {
                ctx.ui.notify("Cancelled", "info");
                return;
            }
            const result = await currentSession.machine.transition("cancelled");
            if (!result.success) {
                ctx.ui.notify(`Failed to cancel: ${result.error}`, "error");
                return;
            }
            cancelAutoResume(currentSession.jobId);
            const sessionJobId = currentSession.jobId;
            currentSession = null;
            ctx.ui.notify(`Job ${sessionJobId} cancelled.\n` +
                `Run \`/harness start\` to begin a new job.`, "info");
        },
    });
    // --- Footer status (persistent badge) --------------------------------
    pi.on("session_start", (_event, ctx) => {
        footerStatusCtx = ctx;
        refreshFooterStatus(ctx, tracker, mirrorStore, hasCookieSource, () => lastActiveProvider);
    });
    pi.on("turn_end", (_event, ctx) => {
        noteActiveProvider(ctx.model?.id ?? null);
        footerStatusCtx = ctx;
        refreshFooterStatus(ctx, tracker, mirrorStore, hasCookieSource, () => lastActiveProvider);
        void maybeAutoFetchQuota(ctx.model?.id ?? null);
        maybeTriggerProactiveCompact(ctx);
        maybeNotifyContextUsage(ctx);
    });
    pi.on("agent_end", () => {
        setTimeout(() => {
            if (!pendingOutputLimitResumeAfterSettled) {
                return;
            }
            pendingOutputLimitResumeAfterSettled = false;
            queueAutoResume("output-limit-settled", OUTPUT_LIMIT_RESUME_PROMPT, "followUp");
        }, 0);
    });
    pi.on("session_compact", (event, ctx) => {
        footerStatusCtx = ctx;
        proactiveCompactInFlight = false;
        lastProactiveCompactAt = Date.now();
        consecutiveCompactFailures = 0;
        proactiveCompactCircuitReported = false;
        refreshFooterStatus(ctx, tracker, mirrorStore, hasCookieSource, () => lastActiveProvider);
        const forceOutputLimitResume = pendingOutputLimitResumeAfterCompact;
        pendingOutputLimitResumeAfterCompact = false;
        if (!shouldQueuePostCompactionResume(event, ctx.hasPendingMessages(), {
            force: forceOutputLimitResume,
        })) {
            return;
        }
        if (forceOutputLimitResume) {
            queueAutoResume("post-compact-output-limit", OUTPUT_LIMIT_RESUME_PROMPT, event.willRetry ? "steer" : "followUp");
            return;
        }
        outputLimitResumeAttempts = 0;
        // pi.dev expects the literal "resume" command to continue after compaction.
        queueAutoResume("post-compact", "resume", "followUp");
    });
    // --- Periodic quota refresh every 15 minutes ---
    // `maybeAutoFetchQuota` checks its own rate-limit (MINIMAX_REFRESH_MIN_INTERVAL_MS)
    // so this is safe to call frequently.
    setInterval(() => {
        void maybeAutoFetchQuota(lastActiveProvider ?? null);
    }, MINIMAX_REFRESH_MIN_INTERVAL_MS);
    function queueAutoResume(reason, content, deliverAs) {
        try {
            pi.sendUserMessage(content, { deliverAs });
        }
        catch (error) {
            console.error(`[pi-harness] Failed to queue ${reason} auto-resume:`, error instanceof Error ? error.message : String(error));
        }
    }
    function maybeTriggerProactiveCompact(ctx) {
        if (proactiveCompactInFlight) {
            return;
        }
        if (consecutiveCompactFailures >= MAX_PROACTIVE_COMPACT_FAILURES) {
            if (!proactiveCompactCircuitReported) {
                proactiveCompactCircuitReported = true;
                console.error(`[pi-harness] Proactive compact disabled after ${consecutiveCompactFailures} consecutive failures`);
            }
            return;
        }
        if (!ctx.isIdle() || ctx.hasPendingMessages()) {
            return;
        }
        const usage = ctx.getContextUsage();
        if (!shouldTriggerProactiveCompact(usage)) {
            return;
        }
        if (Date.now() - lastProactiveCompactAt < PROACTIVE_COMPACT_COOLDOWN_MS) {
            return;
        }
        proactiveCompactInFlight = true;
        lastProactiveCompactAt = Date.now();
        const compactOptions = {
            customInstructions: "Preserve the current task, recent code changes, pending work, exact next step, and any unresolved errors. This compaction was triggered proactively near the context limit. After compaction, continue seamlessly without asking the user to resume or recap.",
            onComplete: () => {
                proactiveCompactInFlight = false;
                lastProactiveCompactAt = Date.now();
                consecutiveCompactFailures = 0;
                proactiveCompactCircuitReported = false;
            },
            onError: (error) => {
                proactiveCompactInFlight = false;
                consecutiveCompactFailures += 1;
                console.error("[pi-harness] Proactive compact failed:", error.message);
            },
        };
        ctx.compact(compactOptions);
    }
}
// ----------------------------------------------------------------------
// Helper: refresh persistent footer status with one-line summary
// ----------------------------------------------------------------------
function refreshFooterStatus(ctx, tracker, mirrorStore, hasCookieSource, getActiveProvider = () => null) {
    const nowMs = Date.now();
    const local = aggregateWindows(tracker.all());
    const provider = getActiveProvider();
    const mirror = provider ? mirrorStore.readProvider(provider) : null;
    // 	"[DEBUG refreshFooterStatus] mirror =",
    // 	mirror ? JSON.stringify(mirror) : null,
    // );
    const freshness = mirrorStore.freshness(mirror, nowMs);
    ctx.ui.setStatus("harness-runtime", buildFooterStatusValue(local, mirror, freshness, hasCookieSource(), provider));
}
