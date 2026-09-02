/**
 * Loop Daemon — Auto-triggered write-review loop.
 *
 * Design philosophy: Human *on* the loop, not *in* the loop.
 * The daemon starts itself, routes itself, and only notifies the human at gates
 * (approval, escalation, blocked). No human ever acts as the message bus between
 * GPT and MiniMax.
 *
 * Architecture:
 *
 *   TRIGGERS
 *   bd task created  ─┐
 *   inbox file       ─┤
 *   bus event        ─┼──► watcher (poll) ─► LeaseManager.claim ─► LangGraph.run
 *   cron (stub)     ─┘                     │
 *                                           │ publish (loop-events.ts) ─► HerdrEventBus
 *                                           │ gates ─► NotificationCenter
 *
 * Milestones:
 *   M1 — Daemon skeleton + inbox/bus watchers
 *   M2 — Runner integration: LeaseManager → buildWriteReviewLoop → publish
 *   M3 — Gates & notifications
 *   M4 — Robustness: surge/529 auto-resume + retry backoff, stale-lease, bd-tasks
 *          watcher (worker heartbeats: still TODO)
 *
 * Wiki: wiki/auto-trigger-multi-agent.md
 */
import type { ApprovalClass } from "../../packages/autonomous-runtime/src/types.js";
import { type SurgePolicy } from "./surge.js";
import type { LoopWidget } from "./widget.js";
import { type LoopDeps } from "./graph.js";
export type TriggerSource = "bd-tasks" | "inbox" | "bus" | "cron";
export type ApprovalPolicy = "never" | "on_blocked" | "on_class" | "always";
export interface DaemonConfig {
    /** Agent/worker identity. Default: "loop-daemon" */
    agentId?: string;
    /** Trigger poll interval in ms. Default: 2000 */
    pollMs?: number;
    /** Max write-review rounds per task. Default: 3 */
    maxIterations?: number;
    /** Human gate policy. Default: "never" */
    approvalPolicy?: ApprovalPolicy;
    /** Use deterministic stubs (no API keys). Default: false */
    dryRun?: boolean;
    /** Abort loop if cumulative cost exceeds this. Default: no cap */
    costCapUsd?: number;
    /** Surge (529/overloaded) retry policy. Default: 3→6→12 min, max 5 pauses */
    surgePolicy?: Partial<SurgePolicy>;
    /** Kill a task if it runs longer than this (ms). Prevents permanent freezes. Default: no timeout */
    taskTimeoutMs?: number;
    /** Use persistent file-based checkpointer for crash-resume. Default: false (MemorySaver). */
    checkpointer?: boolean | string;
    /** @internal Test injection — overrides dryRun/real deps entirely */
    deps?: LoopDeps;
    /** Which watchers to enable. Default: ["inbox", "bus"] */
    sources?: TriggerSource[];
    /** Herdr workspace override. Default: from herdr-bus */
    workspace?: string;
    /** NotificationCenter config */
    notificationConfig?: {
        telegramBotToken?: string;
        telegramChatId?: string;
        ntfyTopic?: string;
        webhookUrl?: string;
    };
    /**
     * Path to a tunnel-start script (e.g. tailscale-tunnel.sh).
     * If set, the daemon health-checks the tunnel before each task and
     * auto-restarts it if the target port is unreachable.
     *
     * Set to "auto" to search for scripts/tailscale-tunnel.sh in the
     * project root, or give an absolute path.
     * Default: none (no tunnel management)
     */
    tunnelCommand?: string;
    /**
     * Optional widget for TUI / status-line display.
     * When set, the daemon updates the widget at each loop transition
     * (mirrors pi-lens footer style: !NW ●ME).
     */
    widget?: LoopWidget;
}
export interface TriggeredTask {
    /** Stable id — derived from the trigger source */
    taskId: string;
    /** Human-readable task description */
    request: string;
    /** How the task arrived */
    source: TriggerSource;
    /** Optional approval class from task metadata */
    approvalClass?: ApprovalClass;
    /** ISO timestamp of when the trigger was observed */
    triggeredAt: string;
}
export interface TaskProposedPayload {
    taskId: string;
    request: string;
    approvalClass?: ApprovalClass;
}
/** Write an ack file (used by tests / manual approval). */
export declare function writeAck(inboxDir: string, taskId: string, decision: "approved" | "denied"): void;
/**
 * The main daemon class. Coordinates watchers, leasing, loop execution, and
 * notifications.
 *
 * Usage:
 *   const daemon = new LoopDaemon({ dryRun: true, sources: ["inbox", "bus"] });
 *   daemon.start();
 *   // ... daemon runs in the background ...
 *   daemon.stop();
 */
export declare class LoopDaemon {
    private readonly config;
    private readonly agentId;
    private readonly leaseManager;
    private readonly bus;
    private readonly notificationCenter;
    private readonly inboxDir;
    private readonly inboxWatcher;
    private readonly busWatcher;
    private readonly bdWatcher;
    private readonly cronWatcher;
    private readonly tunnelMonitor;
    private readonly statusLine;
    private readonly widget;
    /** Currently running tasks (taskId → RunningTask) */
    private readonly running;
    private stopped;
    constructor(config?: DaemonConfig);
    /** Start the daemon — begins watching all configured sources. */
    start(): void;
    /** Stop all watchers and release all held leases. */
    stop(): void;
    /** Returns true if stop() has been called. */
    get isStopped(): boolean;
    private _onTriggered;
    private _runTask;
    private _publishTransition;
    /**
     * Drive the TUI widget through loop transitions.
     * Called from onStep within _runTask.
     */
    private _updateWidget;
    private _reviewReportPath;
    private _releaseLease;
    private _notifyHumanReviewNeeded;
    private _notifyReadyForClient;
    private _buildChannels;
}
export { LoopDaemon as default };
//# sourceMappingURL=daemon.d.ts.map