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

import type {
	CompactOptions,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { HarnessStartupStatus, harnessStatusMarker, type HarnessStatus } from "./harness-startup-status.ts";
import {
	auditKeyFiles,
	displayKeysDir,
	fallbackKeyFileFixes,
	formatExposedKeyFileFixes,
	formatKeyFileFixes,
	formatKeyPermissionFixes,
	formatUnrepairableKeyFix,
	selectKeyFileFixes,
	secureKeyTree,
	type KeyFileAuditResult,
} from "./harness/key-file-audit.ts";
import { renderDetailLines } from "./harness/startup-lines.ts";
import {
	isQuestionOpen,
	isRejection,
	mayContinue,
	userReplyEffect,
} from "./harness/pending-question-state.ts";
import {
	clearObsoleteWait,
	isObsoleteQuestion,
	jevWaitEligibility,
	jevWaitRegistration,
	jevWorkContext,
	ownsQuestion,
	questionRelevance,
	type JevQuestionRelevance,
	type JevWorkState,
	type TodoStateLike,
} from "./harness/jev-wait-eligibility.ts";
import { RequestScopeTracker } from "./harness/jev-request-scope.ts";
import { describeInboundAccess, getAllowedUserIds } from "./harness/telegram-auth.ts";
import { buildTelegramCallbackUpdate, buildTelegramMessageUpdate } from "./harness/telegram-update.ts";
import { installConsoleGuard } from "./harness/console-guard.ts";
import {
	beadsReport,
	exposedKeyFilesReport,
	jevMissingKeyReport,
	lineConfigurationReport,
	oneLineError,
	relayEndpointReport,
	relayShouldBeReported,
} from "./harness/startup-report.ts";
import {
	findOnPath,
	readToolVersion,
	versionNumber,
} from "./harness/tool-availability.ts";
import { localSkillsReport, skillsReport } from "./harness/skills-startup.ts";
import {
	PendingQuestionCountdown,
	type CountdownView,
} from "./harness/pending-countdown.ts";
import {
	createPendingActionRegistry,
	createPendingActionTicker,
} from "./harness/pending-actions.ts";
import { classifyProviderFailure, usesBoundedRecovery } from "./harness/provider-failure.ts";
import { watchHonchoMcpTools as watchHonchoMcpToolsModule } from "./harness/honcho-mcp-watcher.ts";
import {
	piRetryOutcome,
	readPiRetrySettings,
} from "./harness/pi-retry-policy.ts";
import { ProviderRecoveryRuntime } from "./harness/provider-recovery-runtime.ts";
import type { ProviderFailure } from "./harness/provider-failure.ts";
import {
	createProviderRecoveryController,
	MAX_RECOVERY_ATTEMPTS,
	type RecoveryResetEvidence,
} from "./harness/provider-recovery.ts";
import { HARNESS_ACTIONS_STATUS_KEY } from "./packages/tui/dist/harness-footer.js";
import { endPendingWait, releaseWait } from "./harness/pending-wait.ts";
import { isChannelDisabled, setChannelDisabled } from "./harness/notification-settings.ts";
import {
	createMcpConnector,
	type McpClientLibrary,
	type McpConnector,
	type McpConnectorApi,
} from "./harness/mcp-connector.ts";
// The Honcho contract lives with the Honcho integration. A type-only import
// is erased at runtime, so the startup keeps loading the module lazily.
import type {
	HonchoInitResult,
	HonchoMcpRegistrar,
	HonchoMcpReport,
	HonchoMcpState,
} from "./harness/honcho-init.ts";
import { UsageTracker } from "./tracker.ts";
import { MirrorStore, type MirrorRecord } from "./mirror.ts";
import { MiniMaxQuotaScraper } from "./harness/e2e/minimax-quota-scraper.js";
import { OpenAIQuotaScraper } from "./harness/e2e/openai-quota-scraper.js";
import { GLMQuotaScraper } from "./harness/e2e/glm-quota-scraper.js";
import { parseMiniMaxQuotaText } from "./harness/e2e/minimax-quota-parser.js";
import {
	CookieWatcher,
	DEFAULT_DROP_DIR as COOKIE_DROP_DIR,
	hasAnyCookieSource as sanitizerHasAnyCookieSource,
} from "./packages/cookie-sanitizer/src/index.ts";
import {
	providerFromModelId,
	type ProviderId,
} from "./packages/providers/src/provider-id.ts";
import {
	TUIUsageMonitor,
	type TUIUsageSignal,
} from "./packages/quota-manager/src/tui-usage-monitor.ts";
import { QuotaManager } from "./packages/quota-manager/src/quota-manager.ts";
import { buildFooterStatusValue } from "./footer-status.ts";
import { registerGithubLoginCommand } from "./packages/clipboard/dist/src/github-login.js";
import {
	MAX_PROACTIVE_COMPACT_FAILURES,
	OUTPUT_LIMIT_RESUME_PROMPT,
	PROVIDER_OVERLOAD_AUTO_RESUME_LIMIT,
	PROVIDER_OVERLOAD_RESUME_PROMPT,
	getProviderOverloadResumeDelayMs,
	PROACTIVE_COMPACT_COOLDOWN_MS,
	shouldQueueOutputLimitResume,
	shouldQueueProviderOverloadResume,
	isProviderRetryFailedReport,
	shouldQueuePostCompactionResume,
	shouldTriggerProactiveCompact,
} from "./proactive-compact.ts";
import { aggregateWindows } from "./windows.ts";

// Relay client for streaming callbacks (t3code-style two-way communication)
import { RelayClient } from "./packages/relay/dist/client.js";
import type { CallbackPayload } from "./packages/relay/src/types.js";
import { describeRelayEndpoint, resolveRelayEndpoint } from "./packages/relay/dist/relay-endpoint.js";
import { renderStatus } from "./renderer.ts";
import {
	JobStateMachine,
	type CheckpointManager,
} from "./harness/job-state-machine.ts";
import { TaskGraphManager } from "./harness/task-graph.js";
import { MasterPlanner } from "./harness/master-planner.ts";
import { RepairEngine } from "./harness/repair-engine.ts";
import {
	type SharedBlackboard,
	createBlackboard,
} from "./harness/blackboard.ts";
import { scheduleAutoResume, cancelAutoResume, getGLMQuotaCountdown } from "./harness/index.js";
import { initWiki, getWikiInstruction } from "./harness/wiki-integration.js";
import { startWatcher, classifyMessage, detectReviewMarker } from "./packages/codex-watcher/dist/src/index.js";
import {
	getPaperclipConfig,
	hasPaperclipConfig,
	PaperclipWatcher,
} from "./packages/paperclip-integration/dist/index.js";
// Centralized application logging: R2 (durable archive) + webhook (live),
// with a local spool as the fallback. Optional - without credentials the
// logs simply stay local.
import { centralInfo, initCentralLogging, redactText } from "./packages/logging/dist/index.js";

// --- Jev Auto-Continue: Agent autonomous decision-making --------------------
// Lazy import - only loads when packages/jev-judge exists and API key available


/**
 * Get tasks from bd (beads) for Jev decision context.
 * Returns { completed, remaining } arrays of task descriptions.
 */
async function getTaskContext(): Promise<{
	completed: string[];
	remaining: string[];
	total: number;
}> {
	try {
		const { execSync } = await import("node:child_process");
		// Get open (pending + in_progress) tasks
		const output = execSync("bd list --json 2>/dev/null", {
			encoding: "utf8",
			timeout: 5000,
		});
		const tasks = JSON.parse(output) as Array<{ title?: string; status?: string }>;

		const completed: string[] = [];
		const remaining: string[] = [];

		for (const task of tasks ?? []) {
			if (!task.title) continue;
			if (task.status === "closed" || task.status === "done") {
				completed.push(task.title);
			} else {
				remaining.push(task.title);
			}
		}

		return {
			completed,
			remaining,
			total: completed.length + remaining.length,
		};
	} catch {
		// bd not available or error - return empty context
		return { completed: [], remaining: [], total: 0 };
	}
}

// --- Harness Startup Widget Messages (used by init functions) -----------------
const startupStatus = new HarnessStartupStatus();
const harnessMessages = startupStatus.messages;
const addHarnessMessage = startupStatus.update.bind(startupStatus);

// --- Key file audit ---------------------------------------------------------
// The startup summary must tell the user HOW to fix a missing key file, not
// only that a credential is missing. The audit scans ~/.pi-harness-runtime/keys
// once per session; the fix commands are attached to the startup line of the
// feature that needs the credential.
let keyFileAudit: KeyFileAuditResult | null = null;
let keyFileAuditDone = false;
/**
 * What happened to the LINE channel in this run?
 *
 * The extension is initialised once per load - a session that starts after
 * the user created the LINE key files still has no LINE channel, so the
 * startup line must not claim a green "configured".
 */
let lineChannelState: "started" | "failed" | "not-started" = "not-started";
/**
 * Why the LINE channel did not start (from the adapter).
 *
 * The adapter knows the difference between an invalid or revoked token
 * (401/403), a LINE API failure and a network failure - the startup
 * summary shows it so the user knows what to fix. It never contains a
 * credential.
 */
let lineChannelDiagnostic: string | null = null;
let telegramChannelState: "started" | "failed" | "not-started" = "not-started";
/** Did the relay client connect at least once in this extension load? */
let relayStreamConnected = false;

function harnessKeysDir(): string {
	return join(homedir(), ".pi-harness-runtime", "keys");
}

function getKeyFileAudit(): KeyFileAuditResult | null {
	if (keyFileAuditDone) return keyFileAudit;
	keyFileAuditDone = true;
	try {
		keyFileAudit = auditKeyFiles({ keysDir: harnessKeysDir() });
	} catch {
		keyFileAudit = null;
	}
	return keyFileAudit;
}

/**
 * Report the key files that other users on this machine can read.
 *
 * A key file is a secret. The harness reads its own key files, so a file
 * that the group or the others can read works perfectly - and is published
 * to every account on the machine. No other line notices, so this is the
 * only place where the fact can surface.
 *
 * The line shows ONE command for the whole key tree: one command per file
 * is a list nobody runs. The command is never executed here.
 */
function reportExposedKeyFiles(): void {
	let audit = getKeyFileAudit();
	let exposed = audit?.exposed ?? [];
	let exposedDirectories = audit?.exposedDirectories ?? [];
	if (exposed.length === 0 && exposedDirectories.length === 0) return;

	// Key files belong to this app and are private by design. Repair unsafe
	// Unix permissions automatically; keep the actionable warning only when
	// the platform cannot express the repair or a path cannot be changed.
	const repair = secureKeyTree(harnessKeysDir());
	if (repair.supported) {
		try {
			audit = auditKeyFiles({ keysDir: harnessKeysDir() });
			keyFileAudit = audit;
		} catch {
			// Preserve the original findings if the verification scan fails.
		}
		exposed = audit?.exposed ?? exposed;
		exposedDirectories = audit?.exposedDirectories ?? exposedDirectories;
		if (exposed.length === 0 && exposedDirectories.length === 0) {
			addHarnessMessage(
				"Keys",
				`permissions secured automatically (${repair.securedFiles} files, ${repair.securedDirectories} directories)`,
				"ok",
			);
			return;
		}
	}

	// The entries the harness could not repair are only reported when they
	// are the exposed ones: an entry that is already private needs nothing.
	const exposedPaths = new Set<string>();
	for (const entry of exposed) exposedPaths.add(join(harnessKeysDir(), entry.file));
	for (const entry of exposedDirectories) {
		exposedPaths.add(join(harnessKeysDir(), entry.name));
	}
	const unrepairable = repair.failures
		.filter((failure) => exposedPaths.has(failure.path))
		.map((failure) => ({
			path: displayKeysDir(failure.path),
			command: formatUnrepairableKeyFix(failure),
			reason: failure.reason,
		}));

	const report = exposedKeyFilesReport({
		exposed,
		exposedDirectories,
		fixes: formatKeyPermissionFixes({ keysDir: harnessKeysDir() }),
		fileFixes: formatExposedKeyFileFixes(exposed, harnessKeysDir()),
		unrepairable,
	});
	if (!report) return;
	addHarnessMessage(report.label, report.text, report.status, report.details);
}

/**
 * Report the issue tracker of the session.
 *
 * The harness keeps its issues with bd (beads): the loop of the session
 * closes an issue with it, and the checklist before a commit asks for the
 * open ones. A user without bd gets a session where a part of the harness
 * is silently missing, so the notice names the dependency and the way to
 * install it.
 *
 * The notice is shown when the tracker is there as well: a dependency the
 * user cannot see is a dependency the user cannot install.
 */
async function reportBeadsTracker(): Promise<void> {
	const path = findOnPath("bd", {
		path: process.env.PATH ?? process.env.Path ?? "",
		pathext: process.env.PATHEXT,
	});
	const version = path ? versionNumber(await readToolVersion("bd")) : undefined;
	const report = beadsReport({ available: Boolean(path), version });
	addHarnessMessage(report.label, report.text, report.status, report.details);
}

/**
 * The `echo` commands that create the missing key files of one feature.
 *
 * `labels` narrows the result to specific credentials (e.g. only the bot token
 * and the chat id for a Telegram that is not configured yet).
 */
function keyFileFixes(feature: string, labels?: string[]): string[] {
	const selected = selectKeyFileFixes(getKeyFileAudit(), feature, labels);
	return formatKeyFileFixes(selected, harnessKeysDir());
}

/**
 * The fix commands for a credential the runtime has already found missing.
 *
 * The audit can disagree with the runtime - a key file that exists but holds
 * a value the reader rejects (too short) counts as present for the audit
 * while the feature stays unconfigured. In that case the command is shown
 * anyway, so a warning line never appears without a way to fix it.
 */
function keyFileFixesOrFallback(feature: string, labels: string[]): string[] {
	const fixes = keyFileFixes(feature, labels);
	if (fixes.length > 0) return fixes;
	return fallbackKeyFileFixes(feature, labels, harnessKeysDir());
}

/**
 * The pending automatic actions of the session.
 *
 * The registry is the shared view of the automatic actions: every executor
 * registers the deadline it scheduled, the rows are drawn from the
 * registry, and nothing here dispatches an action. A row never claims a
 * deadline that does not exist - an action without one shows its real state
 * (queued, running, blocked).
 */
const pendingActions = createPendingActionRegistry();

/**
 * The session of the Pi runtime. The pending actions belong to it.
 */
let activeSessionId = "";

/**
 * Publishes the rows of the pending actions in the footer.
 *
 * The rows go into their own status key, so the harness footer renders them
 * on their own row: a blocked provider stays visible next to the other
 * statuses.
 */
let setPendingActionsStatus: ((value: string | undefined) => void) | null = null;

/**
 * The ticker of the rows of the pending actions.
 *
 * The ticker draws the rows once per second while an action is pending and
 * stops itself when there is nothing to draw. A tick never dispatches an
 * action, never sends a message and never notifies a channel.
 */
const pendingActionTicker = createPendingActionTicker({
	registry: pendingActions,
	render: (rows) => {
		setPendingActionsStatus?.(rows.join("\n"));
	},
});

/** The identity of the pending action of the provider overload resume. */
const PROVIDER_OVERLOAD_ACTION_ID = "provider-overload-resume";

/** The identity of the pending action of the bounded provider recovery. */
const PROVIDER_RECOVERY_ACTION_ID = "provider-recovery";

/** The identity of the pending action of a provider that cannot be retried. */
const PROVIDER_BLOCKED_ACTION_ID = "provider-blocked";

/**
 * The runtime of the automatic resumes after a provider failure.
 *
 * The runtime owns the sequence of a failure: it waits for the settled
 * boundary, and it checks that a scheduled resume still owns the session
 * before it dispatches. The Jev scope uses it to cancel the pending
 * resumes when the user pauses the work.
 */
let providerRecoveryRuntime: ProviderRecoveryRuntime | null = null;

/**
 * The continuation controller of the todos.
 *
 * The runtime reads the pause state of the user through this handle: the
 * injected resume is a resume, and a resume that ignores a pause overrides
 * the decision of the user.
 */
let todoContinuationHandle: { isExplicitlyPaused(): boolean } | null = null;

/**
 * The context of the running extension.
 *
 * The context knows whether messages wait in the queue. A resume that
 * injects itself while the user is typing competes with the user.
 */
let activeExtensionContext: ExtensionContext | null = null;

/**
 * The controller of the bounded recovery cycles.
 *
 * The controller decides the deadlines of the attempts; the executor that
 * owns the resume stays the only owner of the execution.
 */
const providerRecovery = createProviderRecoveryController();

/**
 * The counter of the failures that carry no identity.
 *
 * A failure without a response id still needs its own identity, so a copy
 * of it cannot be mistaken for a later attempt.
 */
let providerFailureCounter = 0;

/**
 * The number of provider failures of the current run.
 *
 * Pi retries a failed turn internally. Every attempt of that retry
 * produces another failed message, so the counter tells the harness
 * whether Pi made a retry attempt after the failure that it holds.
 */
let providerFailureAttemptsInRun = 0;

/**
 * The abort signal of the run that is going.
 *
 * The signal of the context is the signal of the active run. The user
 * aborts a run with Escape, and the aborted signal is the way the harness
 * learns about it: the installed core does not carry an abort flag on the
 * settled event.
 */
let activeRunAbortSignal: AbortSignal | undefined;

/**
 * The identity of the pending action of the decision of the judge.
 *
 * The request is part of the identity: a question that replaces another one
 * has its own row, and the row of the replaced question is not cleared by
 * the stop of the new countdown.
 */
function jevDecisionActionId(requestId: string): string {
	return `jev-decision:${requestId}`;
}

/**
 * The identity of the pending action of the resume of a job.
 *
 * The job is part of the identity: two jobs have two resumes.
 */
function jobQuotaResumeActionId(jobId: string): string {
	return `job-quota-resume:${jobId}`;
}

/**
 * The identity of the pending action of the countdown of the GLM quota.
 */
function glmQuotaActionId(jobId: string): string {
	return `glm-quota:${jobId}`;
}

/**
 * The identities of the continuations that have no scheduled deadline.
 *
 * The output limit and the compaction continue the work right away, so
 * there is no countdown to show for them.
 */
const OUTPUT_LIMIT_CONTINUATION_ID = "continuation:output-limit";
const POST_COMPACTION_CONTINUATION_ID = "continuation:post-compaction";

/**
 * Register a continuation that runs right away.
 *
 * The row says that the continuation is queued. It never shows a
 * countdown, because there is no deadline: a continuation that runs
 * immediately has no deadline to wait for.
 */
function registerQueuedContinuation(id: string, reason: string): void {
	pendingActions.register({
		id,
		sessionId: activeSessionId,
		owner: "continuation",
		kind: "resume",
		state: "queued",
		reason,
	});
}

// The countdown of the GLM quota owns the deadline of the reset, so the
// row shows the reset it really waits for. The row leaves when the
// countdown ends, so it never stays at 00:00.
getGLMQuotaCountdown().onTick((event) => {
	const countdown = getGLMQuotaCountdown().getCountdown(event.jobId);
	const resetAtEpoch =
		countdown?.resetAtEpoch ?? Date.now() + event.remainingSeconds * 1000;
	pendingActions.register({
		id: glmQuotaActionId(event.jobId),
		sessionId: activeSessionId,
		owner: "glm-quota",
		kind: "quota-check",
		state: "scheduled",
		dueAt: resetAtEpoch,
		provider: "GLM",
		reason: "the quota of GLM is exhausted",
	});
});
getGLMQuotaCountdown().onEnd((jobId) => {
	pendingActions.remove(glmQuotaActionId(jobId));
});

/**
 * The observer of the scheduled job resumes.
 *
 * The job resume registers the deadline it really schedules, so the row
 * shows the moment the resume runs and not the reset of the quota.
 */
const quotaResumeObserver = {
	scheduled(jobId: string, provider: string, resumeAt: number): void {
		pendingActions.register({
			id: jobQuotaResumeActionId(jobId),
			sessionId: activeSessionId,
			owner: "job-quota",
			kind: "resume",
			state: "scheduled",
			dueAt: resumeAt,
			provider,
			reason: "the quota of the job is exhausted",
		});
	},
	ended(jobId: string, _provider: string): void {
		pendingActions.remove(jobQuotaResumeActionId(jobId));
	},
};

// Shared state for callback handlers (accessible across init functions)
const sharedState = {
	/**
	 * Release the wait of the lifecycle controller.
	 *
	 * The controller owns the wait: a question that was answered must
	 * release it, so a late evaluation of that question cannot change
	 * anything.
	 */
	cancelWait: null as null | (() => void),
	todoContinuationController: null as unknown,
	// The ledger of the validation runs. The two-phase workflow reads it to
	// know whether the final tier of a test item passed.
	validationLedger: null as unknown,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	updateAutoContinueStatus: null as any,
	// The live countdown of the pending question. The channels stop it when
	// a human answer arrives.
	pendingCountdown: null as PendingQuestionCountdown | null,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	pqController: null as any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	delegationHarness: null as any,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	workspaceEnvMessage: null as string | null,
};

/**
 * The scope of the request that is running.
 *
 * The task list is the history of the session: the todos of a request that
 * was finished stay in it. A new request therefore inherits a list that is
 * already complete, and the completion of the old request says nothing
 * about the new one.
 *
 * The tracker remembers the list as it was when the request started, so the
 * work of the request is told apart from the work that was done before it.
 * Nothing is deleted: the history stays a record of what happened.
 */
const requestScopeTracker = new RequestScopeTracker({
	readTodos: async () => {
		const controller = sharedState.todoContinuationController as {
			getSnapshot?: () => Promise<{ items?: TodoStateLike[] }>;
		} | null;
		if (!controller || typeof controller.getSnapshot !== "function") {
			return null;
		}
		const snapshot = await controller.getSnapshot();
		return snapshot?.items ?? null;
	},
	readHistory: async () => {
		// The history says what a change touched, also when the todo is
		// back in the state it had before: a todo that the request
		// reopened and finished again is work of the request that did it.
		const controller = sharedState.todoContinuationController as {
			getHistory?: () => Promise<
				{ items: TodoStateLike[] }[]
			>;
		} | null;
		if (!controller || typeof controller.getHistory !== "function") {
			return null;
		}
		const history = await controller.getHistory();
		return Array.isArray(history) ? history : null;
	},
});

/**
 * A request of the human begins.
 *
 * Every path that carries the words or the decision of the human into Pi
 * is a boundary of a request. The interactive input event is one. A
 * message of a channel is another, because it reaches Pi as a message of
 * the harness and the input event cannot tell it apart from the traffic
 * of the harness itself.
 *
 * A path that forwards the human without this boundary leaves the scope of
 * the previous request in place, and the new request inherits the
 * completion of the old one: a question of the new request is then a
 * question about work that was already done, and it is dropped.
 *
 * The messages of the harness itself begin nothing. They continue the work
 * of the request that is running.
 */
function beginHumanRequest(): void {
	requestScopeTracker.begin();
}

/**
 * Apply an approval decision from a channel to the pending question.
 *
 * Telegram and LINE share this one resolver: the canonical request ID
 * decides, the channel only records where the answer came from. A stale,
 * duplicated or unauthorized click resolves nothing and leaves the running
 * wait untouched.
 */
function applyChannelApproval(
	action: string,
	requestId: string,
	channel: "telegram" | "line",
): boolean {
	const controller = sharedState.pqController;
	if (!controller?.applyApproval) {
		logToFile("[Approval]", "No pending question controller - click ignored");
		return false;
	}

	const result = controller.applyApproval(action, requestId, channel);
	if (!result?.applied) {
		logToFile(
			"[Approval]",
			`Stale or duplicate ${channel} click for ${requestId}: ${result?.reason ?? "ignored"}`,
		);
		return false;
	}

	logToFile("[Approval]", `${channel} decision '${action}' applied to ${requestId}`);
	logQuestionTransition(requestId, "answered", `${channel}:${action}`);

	// The question is answered, so the wait is over. The wait state is only
	// cleared after a successful resolution.
	// The controller owns the wait: the answer ends it, and an evaluation
	// that is still running is invalidated with it.
	sharedState.cancelWait?.();
	sharedState.updateAutoContinueStatus?.("IDLE");
	// The countdown of the answered question is over with it.
	sharedState.pendingCountdown?.stop();

	if (result.resolution === "yes") {
		(sharedState.todoContinuationController as any)?.resume?.();
	} else {
		(sharedState.todoContinuationController as any)?.explicitPause?.();
	}

	return true;
}

/**
 * Does the shared wait state still belong to the captured request?
 *
 * A newer question can become active while Jev is evaluating the captured
 * one. Clearing the shared wait state then would stop the Jev checks of
 * the new question, so the state is only cleared when it still belongs to
 * the captured request.
 */
function waitBelongsToRequest(requestId: string | undefined): boolean {
	if (!requestId) return true;
	const active = sharedState.pqController?.getCurrentQuestion?.()?.requestId;
	if (!active) return true;
	return active === requestId;
}

/**
 * Log a state transition of a pending question.
 *
 * The transitions make the decision observable: "no action yet" has to be
 * distinguishable from a stuck timer. Only the request ID and a safe
 * reason code are logged - never the question itself.
 */
function logQuestionTransition(
	requestId: string | undefined,
	state: string,
	reason?: string,
): void {
	if (!requestId) return;
	logToFile(
		"[PendingQuestion]",
		`${requestId} ${state}${reason ? ` (${reason})` : ""}`,
	);
}

// --- tooling-preference: the Biome proposal ---------------------------------
//
// The proposal ("use Biome.js instead of ESLint and Prettier") is a decision
// of its own. It never travels through the task-approval path: a "No" here
// must not pause the work and a "Yes" must not resume a pending question.

/** The proposals of this session - the first answer wins. */
interface ToolingProposalRequest {
	requestId: string;
	workspaceRoot: string;
	userKey: string;
}

interface ToolingProposalRegistry {
	register(request: ToolingProposalRequest): boolean;
	claim(
		requestId: string,
		choice: "yes" | "no",
		channel?: string,
	): {
		request: ToolingProposalRequest;
		resolution: {
			choice: "yes" | "no";
			preference: "prefer_biome" | "use_project_tools";
			channel?: string;
		};
	} | null;
}

interface ToolingProposalStore {
	read(
		userKey: string,
		workspaceRoot: string,
	): { decision?: "prefer_biome" | "use_project_tools"; askedAt?: string } | undefined;
	markAsked(userKey: string, workspaceRoot: string, requestId: string): void;
	recordDecision(
		userKey: string,
		workspaceRoot: string,
		decision: "prefer_biome" | "use_project_tools",
		requestId: string,
		channel?: string,
	): void;
}

let _toolingRegistry: ToolingProposalRegistry | null = null;
let _toolingStore: ToolingProposalStore | null = null;
/** The identity of the person the notifications reach (never logged). */
let _toolingIdentity = "";
/**
 * The identity of the person the notifications reach.
 *
 * It is read from the channel key files, so a LINE-only setup is recognized
 * too. The value is hashed before it is stored and never reaches a log.
 */
function readToolingIdentity(): string {
	if (_toolingIdentity) return _toolingIdentity;
	const home = process.env.HOME || process.env.USERPROFILE || "";
	if (!home) return "";
	const keysDir = `${home}/.pi-harness-runtime/keys`;
	for (const name of ["telegram-chat-id.txt", "line-user-id.txt"]) {
		try {
			const value = readFileSync(`${keysDir}/${name}`, "utf8").trim();
			if (value) {
				_toolingIdentity = value;
				return value;
			}
		} catch {
			// The key file is optional - the channel may not be configured.
		}
	}
	return "";
}
/** The running extension API - the relay path has no `pi` of its own. */
let _extensionApi: ExtensionAPI | null = null;
/** How long an unanswered proposal stays quiet before it is offered again. */
const TOOLING_PROPOSAL_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

// --- two-phase-review: implementation first, review as a second phase -----

/** The package of the two-phase workflow. */
type TwoPhaseModule = typeof import("./packages/two-phase-review/dist/index.js");

/** The todo shape the workflow needs. */
type TwoPhaseTodoLike = import("./packages/two-phase-review/dist/index.js").TodoLike;

/**
 * Load the two-phase review package.
 */
async function loadTwoPhaseModule(): Promise<TwoPhaseModule | null> {
	try {
		return await import("./packages/two-phase-review/dist/index.js");
	} catch (error) {
		logToFile("[TwoPhase]", `package unavailable: ${oneLineError(error)}`);
		return null;
	}
}

/**
 * Measure the scope of a request in the workspace.
 *
 * The measurement is the only source of the numbers the delegation
 * assessment uses: the request names the files, or the session changed
 * them. When nothing can be measured the result is null, and the caller
 * says that instead of inventing a scope.
 */
async function measureDelegationScope(
	userMessage: string,
): Promise<import("./packages/jev-judge/dist/delegation-harness.js").ScopeFacts | null> {
	try {
		const scope = await import("./packages/jev-judge/dist/delegation-scope.js");
		const harness = await import("./packages/jev-judge/dist/delegation-harness.js");
		const measurement = scope.measureScope({
			workspacePath: _piSessionCwd || process.cwd(),
			hints: scope.scopeHintsFromText(userMessage),
		});
		if (measurement.files.length === 0) return null;
		return harness.scopeFactsFromMeasurement(measurement);
	} catch (error) {
		logToFile("[Delegation]", "Scope measurement failed:", oneLineError(error));
		return null;
	}
}

/**
 * The decision of the delegation assessment, as the harness returns it.
 */
type DelegationDecisionLike = {
	strategy: string;
	reason: string;
	workGroups?: { id: string; files: string[] }[];
	dispatched?: boolean;
	dispatchTool?: string;
};

/**
 * Register the two-phase workflow in the session.
 *
 * The wiring itself lives in the package (it is tested there). The session
 * only provides the todo list of the session and the workspace.
 */
async function initTwoPhaseReview(pi: ExtensionAPI): Promise<void> {
	const mod = await loadTwoPhaseModule();
	if (!mod) return;

	/** Read the todo list of the session (the local one, never bd). */
	const readTodos = async (ctx: unknown): Promise<{
		available: boolean;
		todos: TwoPhaseTodoLike[];
		reason?: string;
	}> => {
		try {
			const jev = await import("./packages/jev-judge/dist/index.js");
			const provider = jev.createTodoProvider(ctx as never);
			const availability = await provider.availability();
			if (!availability.available) {
				return {
					available: false,
					todos: [],
					reason: availability.error ?? "the todo provider is not available",
				};
			}
			const snapshot = await provider.getSnapshot();
			return { available: true, todos: (snapshot.items ?? []) as TwoPhaseTodoLike[] };
		} catch (error) {
			return { available: false, todos: [], reason: oneLineError(error) };
		}
	};

	/**
	 * Read the validation state of the test items of the session.
	 *
	 * The ledger is the only mechanical source for "did the final tier
	 * pass?". The workflow never runs a test itself, it only reads what the
	 * ledger recorded.
	 */
	const readValidation = async (todos: TwoPhaseTodoLike[]) => {
		const ledger = sharedState.validationLedger as
			| import("./packages/jev-judge/dist/validation-ledger.js").ValidationLedger
			| null
			| undefined;
		if (!ledger) {
			return {
				available: false,
				pendingFinalTier: 0,
				failedFinalTier: 0,
				incompletePlan: 0,
				missingPilot: 0,
				reason: "the validation ledger is not initialized",
			};
		}
		let pendingFinalTier = 0;
		let failedFinalTier = 0;
		let incompletePlan = 0;
		let missingPilot = 0;
		for (const todo of todos) {
			if (todo.id === undefined) continue;
			if (mod.classifyTodo(todo) !== "test") continue;
			const state = ledger.stateFor(todo as never);
			if (state.planIncomplete) {
				// A plan that declares a large job without a pilot is a
				// different defect than a plan without a final tier, and
				// the two need different repairs.
				if (state.missingPilot) {
					missingPilot += 1;
				} else {
					incompletePlan += 1;
				}
				continue;
			}
			if (!state.finalTierRequired) continue;
			const status = state.full.status;
			if (status === "passed") continue;
			if (status === "failed" || status === "timeout" || status === "error") {
				failedFinalTier += 1;
			} else {
				pendingFinalTier += 1;
			}
		}
		return { available: true, pendingFinalTier, failedFinalTier, incompletePlan, missingPilot };
	};

	/**
	 * The delegation state of the session.
	 *
	 * The numbers are the observed ones: the children that really ran and
	 * the groups the harness measured. A plan that was never dispatched
	 * shows zero dispatched children.
	 */
	const readDelegation = () => {
		const harness = sharedState.delegationHarness as
			| import("./packages/jev-judge/dist/delegation-harness.js").DelegationHarness
			| null
			| undefined;
		if (!harness) return undefined;
		try {
			const receipt = harness.getReceipt();
			const groups = receipt?.decision.workGroups?.length ?? 0;
			const dispatched = harness.getChildren().length;
			return { groups, dispatched };
		} catch {
			return undefined;
		}
	};

	try {
		await mod.initTwoPhaseReview({
			pi,
			readTodos,
			readValidation,
			readDelegation,
			workspaceRoot: () => {
				try {
					return realpathSync(process.cwd());
				} catch {
					return process.cwd();
				}
			},
			log: (message: string) => logToFile("[TwoPhase]", message),
		});
	} catch (error) {
		logToFile("[TwoPhase]", `runtime not registered: ${oneLineError(error)}`);
	}
}

/**
 * Load the tooling preference package and watch for the session start.
 *
 * The proposal is offered once per workspace: the answer is stored, and a
 * workspace that already uses Biome is never asked at all.
 */
async function initToolingPreference(pi: ExtensionAPI): Promise<void> {
	try {
		const mod = await import("./packages/tooling-preference/dist/index.js");
		_toolingRegistry = new mod.ToolingRequestRegistry();
		_toolingStore = new mod.ToolingPreferenceStore(
			mod.ToolingPreferenceStore.defaultFilePath(),
		);
	} catch (error) {
		logToFile("[ToolingPreference]", `package unavailable: ${oneLineError(error)}`);
		return;
	}

	pi.on("session_start", () => {
		void offerToolingPreference();
	});
}

/**
 * Offer the tooling proposal for the workspace of this session.
 *
 * The proposal never blocks: it is a message with two buttons, and the work
 * continues while the user decides.
 */
async function offerToolingPreference(): Promise<void> {
	const registry = _toolingRegistry;
	const store = _toolingStore;
	const center = _nc?.center as NcCenter | undefined;
	if (!registry || !store || !center?.notifyWithButtons) return;

	let workspaceRoot: string;
	try {
		workspaceRoot = realpathSync(process.cwd());
	} catch {
		return;
	}

	try {
		const mod = await import("./packages/tooling-preference/dist/index.js");
		const userKey = mod.buildToolingUserKey(readToolingIdentity());
		const record = store.read(userKey, workspaceRoot);
		if (!mod.shouldAskAgain(record, TOOLING_PROPOSAL_COOLDOWN_MS)) return;

		const context = mod.detectToolingContext(workspaceRoot);
		const eligibility = mod.evaluateBiomeProposalEligibility(context);
		if (!eligibility.eligible) {
			logToFile("[ToolingPreference]", `no proposal: ${eligibility.reason}`);
			return;
		}

		const requestId = mod.buildToolingRequestId(userKey, workspaceRoot);
		if (!registry.register({ requestId, workspaceRoot, userKey })) return;

		await center.notifyWithButtons(
			"ToolingPreferenceProposal",
			{
				jobId: requestId,
				questionId: requestId,
				requirement: mod.buildToolingProposalMessage(context),
				taskTitle: "Biome.js proposal",
			},
			mod.buildToolingButtons(requestId),
			{ additionalDetails: { _actionPrompt: "Use Biome.js in this workspace?" } },
		);
		store.markAsked(userKey, workspaceRoot, requestId);
		logToFile("[ToolingPreference]", `proposal sent (${requestId})`);
	} catch (error) {
		logToFile("[ToolingPreference]", `proposal failed: ${oneLineError(error)}`);
	}
}

/**
 * Apply the answer of the user to the tooling proposal.
 *
 * The first answer wins: a second click finds nothing and changes nothing.
 */
async function resolveToolingPreference(
	targetId: string,
	channel: "telegram" | "line",
	pi: ExtensionAPI | null,
): Promise<{ applied: boolean; reason: string }> {
	const registry = _toolingRegistry;
	const store = _toolingStore;
	if (!registry || !store) {
		return { applied: false, reason: "no proposal is open" };
	}

	let target: { choice: "yes" | "no"; requestId: string } | null = null;
	try {
		const mod = await import("./packages/tooling-preference/dist/index.js");
		target = mod.parseToolingTarget(targetId);
	} catch (error) {
		logToFile("[ToolingPreference]", `package unavailable: ${oneLineError(error)}`);
		return { applied: false, reason: "the proposal cannot be read" };
	}
	if (!target) {
		return { applied: false, reason: "the button does not belong to a proposal" };
	}

	const claimed = registry.claim(target.requestId, target.choice, channel);
	if (!claimed) {
		return { applied: false, reason: "the proposal was already answered" };
	}

	store.recordDecision(
		claimed.request.userKey,
		claimed.request.workspaceRoot,
		claimed.resolution.preference,
		target.requestId,
		channel,
	);
	logToFile(
		"[ToolingPreference]",
		`${channel} answered the proposal: ${claimed.resolution.preference}`,
	);

	if (claimed.resolution.choice === "yes" && pi) {
		await startBiomeImplementation(claimed.request.workspaceRoot, channel, pi);
	}
	return {
		applied: true,
		reason:
			claimed.resolution.choice === "yes"
				? "Biome.js will be implemented"
				: "the current tools stay",
	};
}

/**
 * Start the Biome implementation after a "Yes".
 *
 * The harness does not change the repository itself: the agent does the
 * work, so the change stays reviewable in the session.
 */
async function startBiomeImplementation(
	workspaceRoot: string,
	channel: string,
	pi: ExtensionAPI,
): Promise<void> {
	try {
		const mod = await import("./packages/tooling-preference/dist/index.js");
		const context = mod.detectToolingContext(workspaceRoot);
		// The decision of the human starts new work: it begins a request.
		// The prompt reaches Pi as a message of the harness, so the input
		// event cannot begin the scope of the request.
		beginHumanRequest();
		await pi.sendUserMessage(
			mod.buildToolingImplementationPrompt(context, workspaceRoot),
			{ deliverAs: "steer" },
		);
		logToFile("[ToolingPreference]", `agent asked to implement Biome (${channel})`);
	} catch (error) {
		logToFile("[ToolingPreference]", `steer failed: ${oneLineError(error)}`);
	}
}

/** The last time a quality check ran - the check is not repeated in a loop. */
let _toolingCheckAt = 0;
/** Is a quality check running right now? */
let _toolingCheckRunning = false;
/** The shortest time between two quality checks. */
const TOOLING_CHECK_INTERVAL_MS = 15_000;

/**
 * Run the post-change quality check of the workspace.
 *
 * The check honors the saved preference: Biome when the user asked for it,
 * the project's own script otherwise. It never writes, it never blocks the
 * session and it never runs without a decision of the user.
 */
async function maybeRunToolingCheck(ctx: ExtensionContext): Promise<void> {
	const store = _toolingStore;
	if (!store || _toolingCheckRunning) return;
	const now = Date.now();
	if (now - _toolingCheckAt < TOOLING_CHECK_INTERVAL_MS) return;

	let workspaceRoot: string;
	try {
		workspaceRoot = realpathSync(process.cwd());
	} catch {
		return;
	}

	try {
		const mod = await import("./packages/tooling-preference/dist/index.js");
		const userKey = mod.buildToolingUserKey(readToolingIdentity());
		const record = store.read(userKey, workspaceRoot);
		// Without a decision of the user no tool is selected, so nothing runs.
		if (!record?.decision) return;

		const changed = mod.detectChangedJsTsFiles(workspaceRoot);
		if (!changed.detected || changed.files.length === 0) return;

		const context = mod.detectToolingContext(workspaceRoot);
		const plan = mod.selectQualityCheck({
			context,
			preference: record.decision,
			files: changed.files,
		});
		if (plan.tool === "none") return;

		_toolingCheckRunning = true;
		_toolingCheckAt = now;
		try {
			const result = mod.runQualityCheck(plan, {
				cwd: workspaceRoot,
				timeoutMs: 60_000,
			});
			const line = mod.formatQualityCheckStatus(result);
			logToFile("[ToolingCheck]", line);
			// The status line names the tool and says whether the check ran.
			ctx.ui.setStatus("harness-tooling", line);
		} finally {
			_toolingCheckRunning = false;
		}
	} catch (error) {
		logToFile("[ToolingCheck]", `check failed: ${oneLineError(error)}`);
	}
}

async function initAutoContinue(pi: ExtensionAPI): Promise<void> {
	addHarnessMessage("Jev", "initializing", "wait");
	try {
		// Check if Jev API key is available (env var or keys file)
		const home = process.env.HOME || process.env.USERPROFILE || homedir();
		const keysDir = `${home}/.pi-harness-runtime/keys`;
		const { existsSync, mkdirSync } = await import("fs");

		// Auto-create directory if doesn't exist. The directory holds
		// secrets, so it is created private: the mode of a new directory
		// depends on the umask of the shell, and a world readable key
		// directory publishes the name of every key on the machine.
		if (!existsSync(keysDir)) {
			mkdirSync(keysDir, { recursive: true, mode: 0o700 });
		}

		// Resolve the provider chain. Every credential stays bound to its own
		// provider: a TypeSafe key is never sent to OpenRouter and an OpenRouter
		// key is never sent to the TypeSafe API.
		const { resolveJevProviders, classifyQuestionRisk, extractProposedAction, extractQuestionAction } = await import("./packages/jev-judge/dist/index.js");
		const jevProviders = resolveJevProviders({ keysDir });

		// Create pending question controller - works independently of Jev
		const { createPendingQuestionController } = await import("./packages/notification/dist/index.js");
		const pqController = createPendingQuestionController();
		sharedState.pqController = pqController;

		// Initialize delegation harness for large refactor assessment
		const { createDelegationHarness } = await import("./packages/jev-judge/dist/delegation-harness.js");
		sharedState.delegationHarness = createDelegationHarness(pi, {
			minFiles: 10,
			minCallSites: 50,
			minComponents: 2,
		});
		logStartup("[pi-harness] Delegation harness initialized");

		// The lifecycle of a continuation the harness started itself: the
		// status stays "RUN" until the turn settles.
		const { ContinuationGate } = await import(
			"./packages/jev-judge/dist/continuation-status.js"
		);

		// The Jev key is missing: the fix commands must survive every later
		// message with the same label - `HarnessStartupStatus.update` replaces
		// a message by label, so a later "verifying API..." line would drop
		// them.
		const jevKeyMissing = jevProviders.length === 0;
		if (jevKeyMissing) {
			const report = jevMissingKeyReport(keyFileFixesOrFallback("Jev", ["API key"]));
			addHarnessMessage(report.label, report.text, report.status, report.details);
			logToFile("[auto-continue]", "No Jev API key found, but question detection is active. Set TYPESAFE_API_KEY or write the key to ~/.pi-harness-runtime/keys/typesafe-api-key.txt");
			// Don't return - question handling still works without Jev
		}

		// The dist build is used on purpose: it is the published build output
		// of the package. The source tree is not shipped as compiled
		// JavaScript, so importing "src/auto-continue.js" would depend on
		// build artifacts that are not part of the package.
		const mod = await import("./packages/jev-judge/dist/auto-continue.js");
		// The lifecycle of the wait for a human answer.
		//
		// The controller owns the question that is waiting, the moment it
		// was asked, the countdown and the decision. The runtime reads the
		// state of the wait; it does not keep a second copy of it, so the
		// countdown, the evaluation and the log always measure the same
		// wait.
		const { WaitLifecycleController } = await import(
			"./packages/jev-judge/dist/wait-lifecycle.js"
		);
		// The instruction of an autonomous decision: it names the selected
		// option, the scope and the reasoning of the decision.
		const autonomy = await import("./packages/jev-judge/dist/autonomy-instruction.js");

		let lastUserMessage: Date | null = null;
		let autoContinueTimer: NodeJS.Timeout | null = null;
		let _inferenceInProgress = false; // Track for overlap prevention
		// The timing of the wait. The countdown in the status row and the
		// decision of the judge use the same constants, so the displayed
		// deadline and the decision can never drift apart.
		const AUTO_CONTINUE_INTERVAL_MS = 60 * 1000; // Fallback poll: every minute
		const MIN_WAIT_MINUTES = 5; // The question is decided once, after this wait
		// The lifecycle of the wait.
		//
		// The controller owns the request the wait belongs to, the moment
		// the question was asked, the countdown and the evaluation. It runs
		// the evaluation exactly once: a decision to wait ends the automatic
		// attempt, and a provider failure is an error, not a decision.
		const waitLifecycle = new WaitLifecycleController({
			waitMinutes: MIN_WAIT_MINUTES,
			countdown: {
				get active() {
					return pendingCountdown.active;
				},
				start: (requestId: string, startedAt: number) => {
					_countdownSessionId = _piSessionId;
					pendingCountdown.start(requestId, startedAt);
				},
				stop: () => pendingCountdown.stop(),
			},
			currentSessionId: () => _sessionId,
			evaluate: (request, waitedMs) => evaluatePendingQuestion(request, waitedMs),
			eligibility: () => currentWaitEligibility(),
			onState: (state, detail) => {
				logToFile("[auto-continue]", `The wait is ${state}: ${detail.reason}`);
			},
			onError: (error) => {
				logToFile("[auto-continue]", "The wait lifecycle failed:", oneLineError(error));
			},
		});

		/**
		 * Is the harness waiting for an answer of a human?
		 *
		 * The controller owns that state: the runtime only asks.
		 */
		function isWaitingForUser(): boolean {
			return (
				waitLifecycle.currentState === "waiting" ||
				waitLifecycle.currentState === "evaluating"
			);
		}

		/**
		 * Is the question of this session still open?
		 *
		 * The wait can be over while the question is not: after the decision
		 * of Jev asked a human, and after an evaluation that failed, the
		 * question stays open so the human can still answer it. Its buttons
		 * stay valid with it, so a later click would inject a second answer.
		 */
		function hasOpenQuestion(): boolean {
			return isQuestionOpen(sharedState.pqController?.getCurrentQuestion?.());
		}

		/**
		 * The last state of the work that was read.
		 *
		 * The countdown asks synchronously, so it reads the state that is
		 * known instead of waiting for a new one.
		 */
		let _lastWorkState: JevWorkState = "unknown";

		/**
		 * The state of the work of the current request and the scope that
		 * was requested.
		 *
		 * The task list is the only source. A list that could not be read
		 * says nothing: an unreadable list is never an empty list, and an
		 * empty list is never a finished request.
		 *
		 * The scope is the work that was asked for: the subjects of the
		 * todos. A question that names the same work is a question about
		 * the request, and a question that names something else proposes
		 * work that was never asked for.
		 */
		async function currentWorkContext(): Promise<{
			work: JevWorkState;
			scope: string[];
		}> {
			const controller = todoContinuationController;
			if (!controller) return { work: "unknown", scope: [] };
			try {
				// The scope of the request delimits the work that belongs to
				// it: the todos of an earlier request are history, and their
				// completion is not the completion of this one. The list and
				// the scope are read together, so they belong to the same
				// request.
				const read = await requestScopeTracker.read();
				if (!read.items) return { work: "unknown", scope: [] };
				// A todo that is marked complete while its final tier has not
				// passed is not done: the required validation is work that
				// remains, so the request is not finished.
				const validationPending = (item: TodoStateLike) =>
					Boolean(
						validationLedger?.isFinalTierPending(
							item as unknown as import("./packages/jev-judge/dist/todo-provider.js").TodoItem,
						),
					);
				return jevWorkContext(read.items, {
					scope: read.scope,
					validationPending,
				});
			} catch {
				return { work: "unknown", scope: [] };
			}
		}

		/**
		 * The state of the work of the current request.
		 */
		async function currentWorkState(): Promise<JevWorkState> {
			return (await currentWorkContext()).work;
		}

		/**
		 * May the current question be decided automatically?
		 *
		 * One decision, shared by the creation of the wait, the
		 * reconciliation with the finished work, the evaluation at the
		 * deadline and the application of the result.
		 */
		async function currentWaitEligibility(): Promise<{
			eligible: boolean;
			reason: string;
		}> {
			const question = sharedState.pqController?.getCurrentQuestion?.();
			if (!question) {
				return { eligible: false, reason: "there is no question" };
			}
			const relevance =
				(question.relevance as JevQuestionRelevance | undefined) ??
				"current-request";
			const work = await currentWorkState();
			_lastWorkState = work;
			return jevWaitEligibility({ relevance, work });
		}

		/**
		 * Cancel a question whose work is done.
		 *
		 * The question was asked while the work of the request remained.
		 * That work is done now, so the question is obsolete: it blocks
		 * nothing, and it keeps no countdown.
		 *
		 * Only the Jev owner is touched. A countdown of another owner keeps
		 * its deadline and its state.
		 */
		async function reconcileObsoleteQuestion(): Promise<void> {
			const question = sharedState.pqController?.getCurrentQuestion?.();
			if (!question || !isQuestionOpen(question)) return;
			// The identity of the question is kept: the state of the work is
			// read with an await, and a question that replaces this one in
			// the meantime must not be closed by the check of the old one.
			const requestId = question.requestId;
			const relevance =
				(question.relevance as JevQuestionRelevance | undefined) ??
				"current-request";
			const work = await currentWorkState();
			_lastWorkState = work;
			// The question that waits now must be the question that was
			// checked: a replaced question is not closed by the check of the
			// one it replaced.
			const current = sharedState.pqController?.getCurrentQuestion?.();
			if (!ownsQuestion(current, requestId) || !isQuestionOpen(current)) {
				logToFile(
					"[auto-continue]",
					"The question was replaced while the work was read - the check is stale",
				);
				return;
			}
			const obsolete = isObsoleteQuestion({ relevance, work });
			if (!obsolete.obsolete) return;
			logToFile(
				"[auto-continue]",
				"The work of the question is done - the question is obsolete:",
				requestId,
			);
			// The question is closed without an answer: nobody clicked
			// anything, so no answer is injected. Only the Jev owner is
			// touched: a countdown of another owner keeps its deadline.
			clearObsoleteWait({
				requestId,
				cancelQuestion: (reason) => {
					// The question that is closed is the one that was checked:
					// the cancel of the controller acts on the current
					// question, so it runs only while that is the same one.
					const still = sharedState.pqController?.getCurrentQuestion?.();
					if (!ownsQuestion(still, requestId)) return;
					sharedState.pqController?.cancel(reason);
				},
				cancelWait: () => {
					waitLifecycle.cancel();
				},
				removeRow: (id) => {
					pendingActions.remove(jevDecisionActionId(id));
				},
			});
			updateAutoContinueStatus("IDLE");
		}

		// A continuation was dispatched and its turn has not settled yet.
		// The gate owns that state: the status stays "RUN" until the turn
		// settles, and no timer may clear it in the meantime.
		const _continuation = new ContinuationGate();
		// The measured scope that was already handed to the agent. The
		// plan is sent once per scope, not once per message.
		let _lastDelegationPlanFingerprint: string | null = null;

		/**
		 * Hand the measured delegation plan to the agent.
		 *
		 * The harness measured the scope; the agent is the one that sends
		 * the groups to the sub-agent tool. The message says so, and the
		 * plan is not repeated for a scope the agent already knows.
		 */
		async function handDelegationPlanToAgent(
			decision: DelegationDecisionLike | null,
			fingerprint: string,
		): Promise<void> {
			if (!decision) return;
			if (_lastDelegationPlanFingerprint === fingerprint) return;
			let message: string | null = null;
			try {
				const harness = await import("./packages/jev-judge/dist/delegation-harness.js");
				message = harness.buildDelegationSteer(decision);
			} catch (error) {
				logToFile("[Delegation]", "The delegation plan could not be built:", oneLineError(error));
				return;
			}
			if (!message) return;
			_lastDelegationPlanFingerprint = fingerprint;
			try {
				await pi.sendUserMessage(message, { deliverAs: "steer" });
				logToFile("[Delegation]", "The measured delegation plan was handed to the agent");
			} catch (error) {
				logToFile("[Delegation]", "The delegation steer failed:", oneLineError(error));
			}
		}

		// The children of a delegation are observed, not assumed. The
		// harness does not dispatch anything: the agent sends the measured
		// groups to the sub-agent tool, and the tool events are the proof
		// that a child really ran.
		pi.on("tool_execution_start", (event) => {
			try {
				const toolEvent = event as {
					toolCallId?: string;
					toolName?: string;
					args?: unknown;
				};
				const child = sharedState.delegationHarness?.observeToolStart?.({
					toolCallId: String(toolEvent.toolCallId ?? ""),
					toolName: String(toolEvent.toolName ?? ""),
					args: toolEvent.args,
				});
				if (child) {
					logToFile(
						"[Delegation]",
						`A child was dispatched: ${child.toolName} (${child.groupId ?? "no group"})`,
					);
				}
			} catch (error) {
				logToFile("[Delegation]", "The child could not be recorded:", oneLineError(error));
			}
		});

		pi.on("tool_execution_end", (event) => {
			try {
				const toolEvent = event as {
					toolCallId?: string;
					toolName?: string;
					result?: unknown;
					isError?: boolean;
				};
				const child = sharedState.delegationHarness?.observeToolEnd?.({
					toolCallId: String(toolEvent.toolCallId ?? ""),
					toolName: String(toolEvent.toolName ?? ""),
					result: toolEvent.result,
					isError: toolEvent.isError === true,
				});
				if (child) {
					logToFile(
						"[Delegation]",
						`The child ended: ${child.toolName} (${child.status})${child.model ? `, model ${child.model}` : ""}`,
					);
				}
			} catch (error) {
				logToFile("[Delegation]", "The child could not be closed:", oneLineError(error));
			}
		});
		let _sessionId = Date.now().toString(36); // Track session for cancellation
		// The session of the Pi runtime. A countdown belongs to the session
		// that asked the question.
		let _piSessionId = "";
		// The session the running countdown belongs to. A countdown of a
		// session that is gone must not draw its status any more.
		let _countdownSessionId = "";
		// The request the row of the footer belongs to. A countdown that
		// stops must not clear the row of a newer question.
		let _countdownRowRequestId: string | null = null;
		let _lastNotifiedQuestion = ""; // Track last question to prevent repeat notifications
		let _completedNotifiedFor: string | null = null; // Track completion notification deduplication

		// UI status for auto-continue (captured from session_start ctx)
		let _setAutoContinueStatus: ((text: string | undefined) => void) | null = null;
		let _currentAutoContinueState = ""; // Track current state for deduplication

		// Auto-continue state labels
		const AC_STATE = {
			IDLE: "",
			WAITING: "WAIT",
			CHECKING: "CHECK",
			CONTINUING: "RUN",
			ERROR: "WARN",
		} as const;

		// Status message for each state
		const AC_STATE_MESSAGES = {
			IDLE: "",
			WAITING: "Awaiting your response",
			CHECKING: "Evaluating continuation",
			CONTINUING: "Continuing autonomously",
			ERROR: "Auto-continue unavailable",
		} as const;

		// The live countdown of the pending question.
		//
		// It owns the deadline of the wait: it shows the remaining time in
		// the status row once per second and starts the decision of the
		// judge exactly at the deadline. The fallback poll only takes over
		// when there is no countdown, so a decision is never started twice.
		const pendingCountdown = new PendingQuestionCountdown({
			// The one policy of the wait belongs to the countdown, so the
			// displayed deadline and the deadline of the judge cannot drift
			// apart.
			waitMinutes: MIN_WAIT_MINUTES,
			render: (view: CountdownView) => {
				_countdownRowRequestId = view.requestId;
				// The countdown owns the deadline of the decision, so the row
				// of the pending action shows the same deadline. The request
				// is part of the identity of the action: a question that
				// replaces another one has its own row.
				pendingActions.register({
					id: jevDecisionActionId(view.requestId),
					sessionId: _piSessionId,
					owner: "jev-decision",
					kind: "jev-decision",
					state: "scheduled",
					dueAt: Date.now() + view.remainingMs,
					reason: "the decision of the judge",
				});
				updateAutoContinueStatus(
					"WAITING",
					view.requestId.slice(0, 8),
					`Jev decision in ${view.remaining}`,
				);
			},
			onDeadline: (requestId: string) => {
				logToFile("[auto-continue]", "The decision deadline was reached:", requestId);
				checkAndAutoContinue("countdown")
					.then(() => {
						// The decision did not start: another one was still in
						// flight, or the wait was gone before it ran. The
						// deadline is not lost: the fallback poll takes the
						// decision over, because the lifecycle evaluates a
						// request exactly once.
						if (pendingCountdown.fired && pendingCountdown.requestId === requestId) {
							logToFile(
								"[auto-continue]",
								"The decision did not start - the fallback poll takes over:",
								requestId,
							);
						}
					})
					.catch((error) => {
						logToFile("[auto-continue]", "The decision failed:", oneLineError(error));
						// The decision did not run: the countdown releases the
						// wait, so the fallback poll can take over again.
						pendingCountdown.stop();
					});
			},
			isPending: (requestId: string) => {
				// The wait must still belong to the request: a late tick of
				// an answered or replaced question must not draw its status
				// and must not trigger a decision.
				if (!isWaitingForUser()) return false;
				if (_countdownSessionId !== _piSessionId) return false;
				const current = sharedState.pqController?.getCurrentQuestion?.();
				if (!current) return false;
				// A wait that is no longer eligible draws no row: an
				// obsolete question must not keep a countdown on the screen.
				const relevance =
					(current.relevance as JevQuestionRelevance | undefined) ??
					"current-request";
				if (!jevWaitEligibility({ relevance, work: _lastWorkState }).eligible) {
					return false;
				}
				return (
					current.requestId === requestId &&
					(current.state === "pending" || current.state === "evaluating")
				);
			},
			onStop: (requestId: string | null) => {
				// The countdown is over: the row is cleared with it, so no
				// row claims a decision that is not due any more. Only the row
				// of that countdown is cleared: a row of another state - the
				// judge continues, for example - belongs to that state, and
				// the row of a newer question belongs to that question.
				if (requestId) {
					pendingActions.remove(jevDecisionActionId(requestId));
				}
				if (_countdownRowRequestId && requestId && _countdownRowRequestId !== requestId) {
					return;
				}
				_countdownRowRequestId = null;
				if (_currentAutoContinueState.startsWith("[WAIT]")) {
					_currentAutoContinueState = "";
					_setAutoContinueStatus?.(undefined);
				}
			},
			onError: (error: unknown) => {
				logToFile("[auto-continue]", "The countdown failed:", oneLineError(error));
			},
		});
		sharedState.pendingCountdown = pendingCountdown;

		// Wire shared state for callback handlers
		sharedState.cancelWait = () => {
			waitLifecycle.cancel();
		};
		sharedState.updateAutoContinueStatus = updateAutoContinueStatus;

		/**
		 * The short hash of the current question.
		 *
		 * It identifies the question in the status row without showing the
		 * question itself.
		 */
		function questionHash(): string {
			return _lastNotifiedQuestion
				? Math.abs(
						_lastNotifiedQuestion.split("").reduce((a, c) => {
							a = ((a << 5) - a) + c.charCodeAt(0);
							return a & a;
						}, 0),
					).toString(36)
				: "";
		}

		// Update auto-continue status in TUI footer
		function updateAutoContinueStatus(
			state: keyof typeof AC_STATE_MESSAGES,
			requestId?: string,
			detail?: string,
		): void {
			const message = AC_STATE_MESSAGES[state];
			if (state === "IDLE") {
				// Only the row is cleared here: the countdown belongs to the
				// wait, not to the row. A settled continuation must not stop
				// the countdown of a question that the agent asked in the
				// same turn, and it must not blank its row either.
				if (!pendingCountdown.active) {
					_currentAutoContinueState = "";
					_setAutoContinueStatus?.(undefined);
				}
				return;
			}

			const parts = [`[${AC_STATE[state]}] ${message}`];
			if (requestId) parts.push(requestId);
			if (detail) parts.push(detail);
			const statusText = parts.join(" | ");

			// Only update if state changed (prevent flicker). The state is
			// kept even without a UI binding: a session that starts without
			// a TUI shows the current state as soon as the UI is there.
			if (statusText !== _currentAutoContinueState) {
				_currentAutoContinueState = statusText;
				_setAutoContinueStatus?.(statusText);
			}
		}

		/**
		 * Clear the state of a wait.
		 *
		 * The moment the wait began and the marker of the question that
		 * was notified belong to the wait: a question that is closed must
		 * not keep the harness from noticing the same question again.
		 */
		function clearWaitState(): void {
			// The controller owns the wait: it releases the request, the
			// countdown and the timestamp in one move.
			waitLifecycle.cancel();
			_lastNotifiedQuestion = "";
		}

		/**
		 * Release a wait whose question is closed already.
		 *
		 * The state of the wait and the countdown of the wait die
		 * together: a live countdown without a wait draws a row for a
		 * question that is not waiting any more.
		 */
		function clearWait(): void {
			releaseWait({
				clearWaitState,
				stopCountdown: () => pendingCountdown.stop(),
			});
		}

		/**
		 * End the wait for a pending question.
		 *
		 * The countdown, the wait state and the pending question belong
		 * together: when one of them ends, the others end with it. A wait
		 * that outlives its question would let the judge decide about a
		 * question of a session that is gone.
		 */
		function endWait(reason: string): void {
			endPendingWait(reason, {
				currentQuestion: () => sharedState.pqController?.getCurrentQuestion?.(),
				expireQuestion: (requestId: string, why: string) =>
					sharedState.pqController?.expireByTimeout?.(requestId, why) === true,
				clearWaitState,
				stopCountdown: () => pendingCountdown.stop(),
				clearStatus: () => updateAutoContinueStatus("IDLE"),
				logTransition: (requestId: string, outcome: string, why: string) =>
					logQuestionTransition(requestId, outcome, why),
			});
		}

		// Capture UI context from session_start
		pi.on("session_start", (_event, ctx) => {
			// The context of the running extension: a resume checks it
			// before it dispatches, so it does not compete with the user.
			activeExtensionContext = ctx;
			// The session of the runtime: the countdown of a question belongs
			// to the session that asked it.
			const sessionId = (
				ctx as { sessionManager?: { getSessionId?: () => string | undefined } }
			).sessionManager?.getSessionId?.();
			if (typeof sessionId === "string" && sessionId) {
				if (_piSessionId && _piSessionId !== sessionId) {
					// The session changed: the wait of the old session is
					// over with it. The question is closed and the wait
					// state is cleared, so the judge is not asked about a
					// question that nobody can answer any more.
					endWait("session-switched");
				}
				_piSessionId = sessionId;
				activeSessionId = sessionId;
			}
			if (ctx.hasUI && ctx.ui) {
				_setAutoContinueStatus = ctx.ui.setStatus.bind(ctx.ui, "harness-auto-continue");
				// The pending actions of the session get their own row of the
				// footer: a blocked provider stays visible next to the other
				// statuses.
				setPendingActionsStatus = ctx.ui.setStatus.bind(
					ctx.ui,
					HARNESS_ACTIONS_STATUS_KEY,
				);
				pendingActionTicker.start();
				// A session without a TUI collected the state already: it is
				// shown as soon as the UI is there.
				if (_currentAutoContinueState) {
					_setAutoContinueStatus(_currentAutoContinueState);
				}
			}

		});

		// Clear status and cancel background work on session shutdown
		pi.on("session_shutdown", () => {
			// Cancel the auto-continue interval
			if (autoContinueTimer) {
				clearInterval(autoContinueTimer);
				autoContinueTimer = null;
			}

			// A restart does not survive in memory: the wait state and the
			// pending question are gone with the process. The question is
			// therefore closed explicitly, so the buttons of that request
			// do not stay open and look like a request that is still
			// waiting.
			endWait("session-ended");

			// Clear UI binding and status
			if (_setAutoContinueStatus) {
				_setAutoContinueStatus(undefined);
				_setAutoContinueStatus = null;
			}
			_currentAutoContinueState = "";

			// The pending actions die with the session: a restart does not
			// inherit a countdown or a blocked provider.
			pendingActionTicker.stop();
			pendingActions.clear();
			providerRecovery.clear();
			// The pending resumes die with the session: a restart does not
			// inherit a countdown, a blocked provider, or a resume that would
			// inject itself into the new session.
			providerRecoveryRuntime?.reset();
			setPendingActionsStatus?.(undefined);
			setPendingActionsStatus = null;
			activeSessionId = "";

			// Reset state
			_inferenceInProgress = false;
		});

		// Extract assistant message text and detect actual confirmation requests
		function extractAssistantText(msg: { role?: string; content?: string | Array<{ type?: string; text?: string }> } | undefined): string {
			if (!msg) return "";
			let content = "";
			if (typeof msg.content === "string") {
				content = msg.content;
			} else if (Array.isArray(msg.content)) {
				content = msg.content
					.filter((block): block is { type: "text"; text: string } =>
						block.type === "text" && typeof block.text === "string"
					)
					.map(block => block.text)
					.join("\n");
			}
			return content;
		}

		// Set up pending question callback to dispatch answers to Pi
		pqController.onUserAnswer((question, answer) => {
			logToFile("[PendingQuestion]", `User answered: ${answer} for question ${question.requestId}`);
			logQuestionTransition(question.requestId, "answered", answer);
			// The question is answered, so the wait is over. The wait state
			// is cleared here, after a successful resolution: a stale click
			// must never clear a valid pending wait. The wait and the
			// countdown of the wait are over with it.
			clearWait();
			updateAutoContinueStatus("IDLE");
			// Dispatch answer to Pi
			const message = answer === "yes" ? "yes" : "not yet";
			pi.sendUserMessage(message, { deliverAs: "steer" });
		});

		// Detect when agent asks for continuation
		pi.on("message_end", async (event) => {
			const msg = event.message as { role?: string; content?: string | Array<{ type?: string; text?: string }> } | undefined;
			if (!msg || msg.role !== "assistant") return;

			const content = extractAssistantText(msg);
			
			// Detect new work cycle: check if message contains tool usage
			// Tool calls indicate actual work being done, not just status replies
			const hasToolUsage = Array.isArray(msg.content) && 
				msg.content.some((block) => block.type === "tool_use");
			
			// Only reset completion deduplication when new work is detected
			// This prevents repeated notifications after informational replies
			if (hasToolUsage) {
				_completedNotifiedFor = null;
			}

			// The complete message is the context of the question: the
			// sentence that carries the question often leaves out what the
			// agent is really waiting for ("I need your OK before ...").
			const result = pqController.detectQuestion(content, { contextText: content });

			// Only trigger if: we found a question AND it's different from last notification
			// Skip routine continuation questions - let Jev/todo controller decide
			if (result.detected && result.questionText && result.questionText !== _lastNotifiedQuestion && !isWaitingForUser()) {
				// Skip routine continuation - don't block automatic continuation
				if (result.isRoutine) {
					logToFile("[auto-continue]", "Routine continuation detected, not blocking");
					return;
				}
				
				// Create question in controller
				const questionKind = result.kind || "approval";
				// The risk is about the action that is proposed, not about the
				// whole message: a message that talks about many things
				// carries words that have nothing to do with the action that
				// is proposed. The action is extracted from the message, and
				// a prohibition ("do not delete anything") does not count as
				// a proposal.
				const proposedAction = extractProposedAction(
					result.contextText,
					result.questionText,
				);
				// The action of the question is assessed on its own text: a
				// long message around it cannot push it out of the
				// assessment, and a negation of the message cannot govern
				// it.
				const questionAction = extractQuestionAction(result.questionText);
				const riskFacts = classifyQuestionRisk({
					kind: questionKind,
					askType: result.askType,
					text: result.questionText,
					proposedAction,
					questionAction,
				});
				// The state of the work decides whether the question belongs
				// to the request. It is read before the wait starts, because
				// the wait is the thing that must not start for a question
				// that nobody may answer by silence.
				//
				// The scope that was requested decides whether the question
				// is about that work: the wording of a question is not a
				// fact about what was asked for.
				const workContext = await currentWorkContext();
				const workState = workContext.work;
				_lastWorkState = workState;
				const relevance = questionRelevance({
					text: result.questionText,
					work: workState,
					scope: workContext.scope,
					action: questionAction,
					kind: questionKind,
				});
				// Keeping the question open and letting the judge answer it
				// are two decisions. The question stays open while the
				// request runs: it holds the continuation and the human can
				// answer it.
				const registration = jevWaitRegistration({
					relevance,
					work: workState,
				});
				if (!registration.register) {
					logToFile(
						"[auto-continue]",
						"The question is not registered:",
						registration.reason,
					);
					return;
				}
				const question = pqController.createQuestion({
					text: result.questionText,
					sessionId: _sessionId,
					workspacePath: _piSessionCwd || "/",
					kind: questionKind,
					askType: result.askType,
					alternatives: result.alternatives,
					contextText: result.contextText,
					relevance,
					risk: {
						requiresExplicitAuthorization: riskFacts.requiresExplicitAuthorization,
						destructive: riskFacts.destructive,
						reversible: riskFacts.reversible,
						external: riskFacts.external,
						signals: riskFacts.signals,
					},
				});
				
				logToFile("[PendingQuestion]", `Question created: ${question.requestId} - ${result.questionText?.slice(0, 50)}`);
				logQuestionTransition(question.requestId, "detected", result.askType ?? questionKind);

					_lastNotifiedQuestion = result.questionText;

					// Use question.requestId as the jobId for callback matching
					const questionJobId = question.requestId;

				// The wait starts here. The controller owns the question,
				// the moment it was asked and the countdown, so the
				// deadline of the decision and the deadline of the
				// countdown are the same moment. A question that replaces
				// this one invalidates the evaluation of this one.
				//
				// The wait counts down only when the judge may answer the
				// question: a question that offers work that was not asked
				// for stays open, but its silence decides nothing.
				const eligibility = jevWaitEligibility({
					relevance,
					work: workState,
				});
				if (eligibility.eligible) {
					waitLifecycle.begin({
						requestId: questionJobId,
						sessionId: _sessionId,
						kind: questionKind,
						askType: result.askType,
						text: result.questionText,
						contextText: result.contextText,
						alternatives: result.alternatives,
						relevance,
					});
				} else {
					logToFile(
						"[auto-continue]",
						"The question does not wait for an automatic decision:",
						eligibility.reason,
					);
				}

				// Get task context for additional info
				const taskContext = await getTaskContext().catch(() => ({ total: 0, completed: 0, remaining: [] as string[] }));

				// Build rich context message
				const waitMinutes = Math.round(waitLifecycle.waitedMinutes());
				const taskInfo = taskContext.total > 0
					? `Tasks: ${taskContext.completed}/${taskContext.total} done`
					: "No active tasks";
				const contextInfo = eligibility.eligible
					? `Waiting: ${waitMinutes}m | ${taskInfo}`
					: `Waiting for your answer | ${taskInfo}`;

				// Emit WaitingForUserInput to Telegram and LINE with the same
				// Yes/No actions. The canonical request ID is the correlation
				// key of the callback: a prefixed jobId would never match the
				// pending question and every click would be reported stale.
				// A choice question shows its alternatives: the human has to
				// see what the agent is choosing between.
				const requirement = result.alternatives && result.alternatives.length >= 2
					? `${result.questionText}\n\nOptions:\n${result.alternatives.map((alternative, index) => `${index + 1}. ${alternative}`).join("\n")}`
					: result.questionText;
				_nc?.notifyWithApproval("WaitingForUserInput", {
					jobId: questionJobId,
					questionId: questionJobId,
					questionKind: question.kind,
					requirement,
				}, {
					approveLabel: "Continue",
					rejectLabel: "Not yet",
				}).catch((e) => logToFile("[Notification]", "notifyWithApproval failed:", String(e)));
				logQuestionTransition(questionJobId, "notified", "waiting-for-user");

				// Also send context info as a follow-up message (not in error field)
				_nc?.notify("Info", {
					jobId: `info-${questionJobId}`,
					requirement: contextInfo,
				}).catch((e) => logToFile("[Notification]", "Info notification failed:", String(e)));
			}
		});

	// Track pending user prompts with debounce for queue-based task capture
	let pendingUserPromptCount = 0;
	let lastPromptTime = 0;
	let intakeTimer: ReturnType<typeof setTimeout> | null = null;
	let pendingPromptContents: string[] = []; // Accumulate batch prompt contents
	const PROMPT_WINDOW_MS = 2000; // 2 second debounce window

	// Capture our Pi session's cwd on session_start
	pi.on("session_start", async () => {
		try {
			_piSessionCwd = realpathSync(process.cwd());
			logToFile("[codex-trigger]", "Pi session cwd captured:", _piSessionCwd);

			// --- Detect workspace environment ---
			try {
				const { formatEnvForAgent } = await import("./packages/contracts/dist/workspace-env.js");
				const envMessage = formatEnvForAgent(_piSessionCwd);
				logToFile("[WorkspaceEnv]", envMessage);
				sharedState.workspaceEnvMessage = envMessage;
			} catch (e) {
				logToFile("[WorkspaceEnv]", "Detection failed:", String(e));
			}

			// --- Drain pending greeting when Pi becomes active ---
			if (codexSessionState.pendingGreeting) {
				const pg = codexSessionState.pendingGreeting;
				// Check expiry (5 minutes)
				if (Date.now() - pg.timestamp > 5 * 60 * 1000) {
					logToFile("[codex-greeting]", "Pending greeting expired");
					codexSessionState.pendingGreeting = null;
				} else if (_piSessionCwd === pg.projectRoot) {
					// Roots match - send greeting with followUp mode
					const greetKey = `${_piSessionCwd}:${pg.sessionId}`;
					if (!codexSessionState.greetedSessions.has(greetKey)) {
						logToFile("[codex-greeting]", "Delivering pending greeting for:", pg.sessionId);
						try {
							await pi.sendUserMessage(
								`Codex opened in this workspace (session ${pg.sessionId.slice(0, 8)}...). Say hello briefly, then wait for the user's next instruction.`,
								{ deliverAs: "followUp" }
							);
							codexSessionState.greetedSessions.add(greetKey);
								} catch (err) {
									logToFile("[codex-greeting]", "Failed to deliver greeting:", String(err));
									// Keep pendingGreeting for retry - don't clear on failure
									return;
								}
							}
						codexSessionState.pendingGreeting = null;
						}
				}
			} catch {
				logToFile("[codex-greeting]", "Error in session_start greeting drain");
		}
	});

	// Detect user responses - track prompts for debounced task capture
		pi.on("message_start", async (event) => {
			const msg = event.message as { role?: string } | undefined;
			if (msg?.role === "user") {
				// Normalize content to string (handle array of text blocks)
				let content = "";
				const rawContent = (msg as { content?: string | Array<{ text?: string }> } | undefined)?.content;
				if (Array.isArray(rawContent)) {
					content = rawContent.map((c) => c.text ?? "").join("\n");
				} else if (typeof rawContent === "string") {
					content = rawContent;
				}

				// Skip harness-generated follow-ups (not real user prompts)
				if (!content.includes("Please add all tasks to task list todo")) {
					const now = Date.now();
					// Reset batch if window expired
					if (now - lastPromptTime > PROMPT_WINDOW_MS) {
						pendingUserPromptCount = 0;
						pendingPromptContents = [];
					}
					pendingUserPromptCount++;
					pendingPromptContents.push(content);
					lastPromptTime = now;
					logToFile("[auto-continue]", "User prompt arrived, pending count:", String(pendingUserPromptCount));

					// Clear any pending timer
					if (intakeTimer) {
						clearTimeout(intakeTimer);
						intakeTimer = null;
					}

					// Set debounce timer - evaluate after window expires
					if (taskIntakeController && todoContinuationController) {
						const intake = taskIntakeController;
						const controller = todoContinuationController;
						const capturedCount = pendingUserPromptCount;
						const capturedContents = [...pendingPromptContents];

						intakeTimer = setTimeout(async () => {
							// Only trigger if multiple prompts arrived
							if (capturedCount > 1) {
								pendingUserPromptCount = 0;
								pendingPromptContents = [];
								logToFile("[auto-continue]", "Multiple prompts in queue, evaluating for task capture");
								try {
									// Check if stopped before dispatching
									if (intake.isStopped()) {
										logToFile("[auto-continue]", "Task intake skipped - stopped after evaluation");
										return;
									}
									// Evaluate all prompts in batch
									const combinedContent = capturedContents.join("\n---\n");
									const result = await intake.evaluateWithTodos(combinedContent, controller);
									if (result.actionable && result.action !== "skip") {
										await intake.requestCapture(combinedContent, "harness:task-capture");
									}
									} catch (err) {
										logToFile("[auto-continue]", "Task intake error:", String(err));
									}
								}
							}, PROMPT_WINDOW_MS);
						}
					}
				lastUserMessage = new Date();
				const replyEffect = userReplyEffect({
					waiting: isWaitingForUser(),
					questionOpen: hasOpenQuestion(),
				});
				if (replyEffect !== "none") {
					// The user answered in Pi: the wait and the countdown of
					// the wait are over with it, and the question is closed
					// so that its buttons cannot inject a second answer.
					clearWait();
					updateAutoContinueStatus("IDLE");
					// Cancel pending question on user response
					// (User answered via Pi instead of button)
					sharedState.pqController?.cancel("User responded via Pi");
					if (isRejection(content)) {
						// The reply declines the proposal. The work must not
						// continue behind a decline: the pause is explicit,
						// so nothing but an explicit resume directive clears
						// it.
						(sharedState.todoContinuationController as any)?.explicitPause?.();
						// The user took over: a pending resume of the provider
						// would inject itself against the decline.
						providerRecoveryRuntime?.cancel();
						logToFile(
							"[auto-continue]",
							"The reply declined the proposal; the work is paused",
						);
					} else if (replyEffect === "cancelled-question") {
						// Closing the question is not an authorization: the
						// work that waits for an answer stays paused, also
						// when the reply declines the proposal. Only an
						// explicit resume directive continues the work - an
						// acknowledgment ("okay", "yes") never does.
						logToFile(
							"[auto-continue]",
							"The reply closed the question; the work stays paused until it is resumed explicitly",
						);
					} else {
						logToFile(
							"[auto-continue]",
							"The reply closed the question and ended the wait",
						);
					}
				}
			}
		});

		// Periodic check for auto-continue decision

		/**
		 * The evaluation of the pending question.
		 *
		 * The controller owns the lifecycle of the wait; this function is
		 * the evaluation itself: it asks the judge once and returns the
		 * result. The application of the outcome happens in the caller, so
		 * a result that belongs to a question that is gone never reaches
		 * the work.
		 */
		const evaluatePendingQuestion = async (
			request: {
				requestId: string;
				sessionId: string;
				kind?: string;
				askType?: string;
				text?: string;
				contextText?: string;
				alternatives?: string[];
			},
			waitedMs: number,
		): Promise<import("./packages/jev-judge/dist/wait-lifecycle.js").WaitEvaluation> => {
			// The one elapsed time: the wait that the controller measured
			// from the moment the question was asked.
			const waitMinutes = waitedMs / 60000;
			// Use same hash algorithm as detection
			const questionHash = _lastNotifiedQuestion
				? Math.abs(_lastNotifiedQuestion.split("").reduce((a, c) => {
						a = ((a << 5) - a) + c.charCodeAt(0);
						return a & a;
					}, 0)).toString(36)
				: "";

			// Update status to checking
			updateAutoContinueStatus("CHECKING", questionHash);
			try {
				// Mark inference as in progress to prevent overlap
				_inferenceInProgress = true;

				const judge = new mod.AutoContinueJudge({
					providers: jevProviders,
					proceedThreshold: 0.7,
					maxWaitMinutes: 30,
				});

				// Get task context from local todo controller (not bd)
				const snapshot = await (todoContinuationController?.getSnapshot() ?? Promise.resolve({ items: [] }));
				// An item whose final tier is still pending is NOT done, even when
				// it is already marked completed. The judge must see it as
				// remaining work, otherwise the session ends on a false
				// completion.
				const pendingFinalTier = validationLedger
					? snapshot.items.filter((item) => validationLedger?.isFinalTierPending(item))
					: [];
				const pendingFinalTierIds = new Set(pendingFinalTier.map((item) => item.id));
				if (pendingFinalTier.length > 0) {
					logToFile(
						"[auto-continue]",
						"Final tier still pending for:",
						pendingFinalTier.map((item) => `${item.id}:${item.subject}`).join(", "),
					);
				}
				const taskContext = {
					completed: snapshot.items
					.filter((item: { id?: number; status?: string; subject?: string }) =>
						item.status === "completed" && !(item.id !== undefined && pendingFinalTierIds.has(item.id)))
					.map((item: { status?: string; subject?: string }) => item.subject ?? ""),
					remaining: snapshot.items
					.filter((item: { id?: number; status?: string; subject?: string }) =>
						item.status !== "completed" || (item.id !== undefined && pendingFinalTierIds.has(item.id)))
					.map((item: { status?: string; subject?: string }) => item.subject ?? ""),
					total: snapshot.items.length,
				};

				// Guard against empty task list AND no pending questions
				const hasPendingQuestion = sharedState.pqController?.hasPendingQuestion() ?? false;
				if (taskContext.total === 0 && !hasPendingQuestion) {
					logToFile("[auto-continue]", "No tasks and no pending questions, skipping auto-continue check");
					_inferenceInProgress = false;
					// There is nothing to decide about: the work has no task
					// and no question. The wait ends with it, and no decision
					// is made: a decision would claim that a human is
					// needed, and nobody is. The controller releases the
					// wait, so the result of this evaluation is discarded as
					// stale and the work is not paused.
					waitLifecycle.cancel();
					// The countdown is over with the wait.
					updateAutoContinueStatus("IDLE");
					return {
						outcome: "wait",
						reasoning: "there is no task and no pending question to decide about",
						policyApplied: "nothing-to-decide",
					};
				}

				// The question Jev has to decide about. Without it Jev only
				// sees progress, not what the agent asked permission to do.
				const pendingQuestion = sharedState.pqController?.getCurrentQuestion?.();
				// The risk facts of the proposed action. They are recorded
				// with the question; a question without them is classified
				// again, so the safeguards never run on missing facts.
				const riskFacts = pendingQuestion
					? pendingQuestion.requiresExplicitAuthorization !== undefined
						? {
								requiresExplicitAuthorization:
									pendingQuestion.requiresExplicitAuthorization,
								destructive: pendingQuestion.destructive ?? false,
								reversible: pendingQuestion.reversible ?? true,
								external: pendingQuestion.external ?? false,
							}
						: classifyQuestionRisk({
								kind: pendingQuestion.kind,
								askType: pendingQuestion.askType,
								text: pendingQuestion.questionText,
								proposedAction: extractProposedAction(
									pendingQuestion.contextText,
									pendingQuestion.questionText,
								),
								questionAction: extractQuestionAction(
									pendingQuestion.questionText,
								),
							})
					: undefined;
				// The question of the request that was evaluated. The request
				// owns it: the evaluation belongs to that request, not to
				// whatever question happens to be current.
				const questionContext = {
					requestId: request.requestId,
					text: pendingQuestion?.questionText ?? request.text ?? "",
					kind: (pendingQuestion?.kind ?? request.kind ?? "approval") as
						| "routine"
						| "approval"
						| "choice"
						| "clarification"
						| "explicit",
					askType: (pendingQuestion?.askType ?? request.askType) as
						| "approval"
						| "choice"
						| "clarification"
						| "explicit_authorization"
						| "routine"
						| undefined,
					alternatives: request.alternatives ?? pendingQuestion?.alternatives,
					contextText: request.contextText ?? pendingQuestion?.contextText,
					proposedAction: extractProposedAction(
						request.contextText ?? pendingQuestion?.contextText,
						request.text ?? pendingQuestion?.questionText,
					),
					requiresExplicitAuthorization: riskFacts?.requiresExplicitAuthorization,
					destructive: riskFacts?.destructive,
					external: riskFacts?.external,
					reversible: riskFacts?.reversible,
				};

				const decisionContext = {
					question: questionContext,
					currentTask: taskContext.remaining[0],
					completionRatio:
						taskContext.total > 0
							? taskContext.completed.length / taskContext.total
							: 0,
					totalTasks: taskContext.total,
					completedTasks: taskContext.completed.length,
					blockers: [] as string[],
					nextTasks: taskContext.remaining.slice(0, 5),
					validationStatus:
						pendingFinalTier.length > 0
							? `${pendingFinalTier.length} final tier(s) pending`
							: "no pending final tier",
					waitedMinutes: Math.round(waitMinutes),
					deadlineMinutes: MIN_WAIT_MINUTES,
					lastUserActivity: lastUserMessage || undefined,
				};

				const taskState = mod.createTaskState(
					taskContext.completed,
					taskContext.remaining,
					lastUserMessage || undefined,
					new Date(Date.now() - waitMinutes * 60000),
					decisionContext,
					// The wait is measured from the moment the question was
					// asked: the evaluation and the countdown see one time.
					{ questionAskedAt: new Date(Date.now() - waitedMs) },
				);

					logQuestionTransition(request.requestId, "eligible", `waited ${Math.round(waitMinutes)}m`);

				const decision = await judge.decide(taskState);
				logQuestionTransition(request.requestId, "jev-outcome", decision.outcome ?? decision.action);

				// The typed outcome of the decision. The action is the
				// fallback for a judge that does not know the outcome yet.
				let outcome = decision.outcome;
				if (!outcome) {
					if (decision.action === "proceed") outcome = "approve";
					else if (decision.action === "proceed_with_caution") outcome = "proceed_with_caution";
					else if (decision.action === "reject") outcome = "reject";
					else outcome = "wait";
				}

				// The evaluation is done. The controller decides whether the
				// result still belongs to the question that waits: a result
				// of an answered or replaced question is discarded there.
				return {
					outcome,
					selectedOption: decision.selectedOption,
					scope: decision.scope,
					reasoning: decision.reasoning,
					policyApplied: decision.policyApplied,
					riskLevel: decision.riskLevel,
					error: decision.evaluationError,
				};
			} catch (error) {
				// The evaluation failed. That is an error, not a decision:
				// nothing was decided, the question stays open and the work
				// is not continued.
				_inferenceInProgress = false;
				logToFile("[auto-continue]", "The evaluation of the question failed:", oneLineError(error));
				return {
					outcome: "wait",
					reasoning: "",
					error: {
						kind: "provider",
						message: error instanceof Error ? error.message : String(error),
					},
				};
			}
		};

		/**
		 * Apply the decision of the judge.
		 *
		 * The decision belongs to the request that was evaluated: the
		 * controller stamps that identity on the result, and the result is
		 * applied only while it is the request that waits. The question
		 * itself may have been answered in the meantime, and then the
		 * decision is discarded.
		 */
		const applyWaitDecision = async (
			evaluation: import("./packages/jev-judge/dist/wait-lifecycle.js").WaitEvaluation,
		): Promise<void> => {
			// The decision belongs to the request it was evaluated for.
			//
			// The controller stamps that identity on the result. A decision
			// of a question that was answered, replaced or cancelled in the
			// meantime belongs to a question that is gone: it must not
			// resolve, continue, pause or clear anything. The question that
			// is current now is a different one and owns its own wait.
			if (!waitLifecycle.ownsEvaluation(evaluation)) {
				logToFile(
					"[auto-continue]",
					"The decision belongs to a question that is gone - discarding it",
				);
				return;
			}
			// The decision is checked once more: the work of the question can
			// be done while the judge was thinking. A decision about an
			// obsolete question steers nothing, pauses nothing and resolves
			// nothing.
			const eligibility = await currentWaitEligibility();
			// The ownership is checked again after the await: the question
			// may have been answered, replaced or cancelled while the work
			// was read, and then the decision belongs to a question that is
			// gone. It must not pause the work of a newer question.
			if (!waitLifecycle.ownsEvaluation(evaluation)) {
				logToFile(
					"[auto-continue]",
					"The question was replaced while the decision was checked - discarding the decision",
				);
				return;
			}
			if (!eligibility.eligible) {
				logToFile(
					"[auto-continue]",
					"The question is no longer eligible - discarding the decision:",
					eligibility.reason,
				);
				return;
			}
			const outcome = evaluation.outcome;
			const requestId = evaluation.requestId;
			const waitMinutes = waitLifecycle.waitedMinutes();
			const pendingQuestion = sharedState.pqController?.getCurrentQuestion?.();
			const questionText = pendingQuestion?.questionText;
			const reasoning = evaluation.reasoning;

			// Check if question was explicitly rejected - don't auto-continue after "Not yet"
			if (sharedState.pqController?.isResolved()) {
				const resolution = sharedState.pqController?.getResolution();
				if (resolution === "no") {
					logToFile("[auto-continue]", "Question was rejected - not auto-continuing");
					updateAutoContinueStatus("IDLE");
					return;
				}
			}

			if (outcome === "wait") {
				// The decision asks for a human. The work pauses: the
				// evaluation does not run again, and the question stays open
				// so the human can still answer it.
				logToFile(
					"[auto-continue]",
					`Jev needs a human (${Math.round(waitMinutes)}m waited): ${logReasoning(reasoning)}`,
				);
				logQuestionTransition(
					requestId,
					"wait",
					evaluation.policyApplied ?? "human-required",
				);
				(sharedState.todoContinuationController as any)?.explicitPause?.();
				// The wait is over: the work is paused until a human answers.
				clearWait();
				updateAutoContinueStatus("IDLE");
				return;
			}

			// Close the question with the Jev decision. The buttons of
			// that request ID become stale and no synthetic user answer is
			// injected: nobody clicked anything.
			//
			// A failed close means the request is no longer pending: a
			// human answered while Jev was still evaluating. The human
			// answer wins, so the stale decision is discarded and no
			// continuation steer is sent.
			const closed = requestId
				? sharedState.pqController?.resolveByJev?.(
						requestId,
						outcome,
						reasoning,
						{
							selectedOption: evaluation.selectedOption,
							scope: evaluation.scope,
							reasoning,
						},
					) === true
				: false;
			const application = mod.decideOutcomeApplication(outcome, closed);

			if (application === "discard") {
				logToFile(
					"[auto-continue]",
					"Question is no longer pending - discarding the stale Jev decision",
				);
				// The wait state belongs to the captured question: a
				// newer question keeps its own wait.
				if (waitBelongsToRequest(requestId)) {
					// The stale decision is discarded: the wait and
					// the countdown of the wait are over with it.
					clearWait();
					updateAutoContinueStatus("IDLE");
				} else {
					logToFile(
						"[auto-continue]",
						"A newer question is active - keeping its wait state",
					);
				}
				return;
			}

			if (application === "pause") {
				// Jev refused the proposed action. The question is
				// closed and the work pauses: no continuation steer
				// is sent, so the agent waits for a human.
				logToFile(
					"[auto-continue]",
					`Question ${requestId} closed by Jev (reject) - pausing the work`,
				);
				(sharedState.todoContinuationController as any)?.explicitPause?.();
				if (waitBelongsToRequest(requestId)) {
					// The work pauses for a human: the wait and the
					// countdown of the wait are over with it.
					clearWait();
					updateAutoContinueStatus("IDLE");
				}
				return;
			}

			logToFile(
				"[auto-continue]",
				`Question ${requestId} closed by Jev (${outcome})`,
			);
			logQuestionTransition(requestId, "applied", outcome);

			// Update status to continuing
			updateAutoContinueStatus("CONTINUING", questionHash());

			// The steer names the selected option, the scope and the
			// reasoning of the decision. A bare "continue with the
			// remaining tasks" does not answer the question the
			// agent asked, and it would pretend that the user
			// answered.
			const instruction = autonomy.buildAutonomyInstruction({
				outcome,
				questionText,
				selectedOption: evaluation.selectedOption,
				scope: evaluation.scope,
				reasoning,
				riskLevel: evaluation.riskLevel,
				waitedMinutes: Math.round(waitMinutes),
				deadlineMinutes: MIN_WAIT_MINUTES,
			});
			pi.sendUserMessage(instruction, { deliverAs: "steer" });
			// The question is closed: the wait and the countdown of
			// the wait are over with it.
			clearWait();

			// The status stays "RUN" until the turn that the steer
			// started has settled. A timer would clear it while the
			// agent is still working, and the status would claim
			// that nothing runs any more.
			_continuation.begin();
		};

		/**
		 * The decision of the pending question.
		 *
		 * The controller owns the lifecycle: it knows whether the wait is
		 * due, it runs the evaluation exactly once and it discards a
		 * result that belongs to a question that is gone.
		 */
		const checkAndAutoContinue = async (source: "countdown" | "poll" = "poll") => {
			// Prevent overlap if inference is already in progress
			if (_inferenceInProgress) {
				// A deadline that was blocked is armed again by the caller of
				// the countdown, so the decision is not lost.
				return;
			}

			// The countdown owns the wait while it counts down: the fallback
			// poll only takes over after the countdown fired, so the decision
			// is never started twice and a blocked deadline is not lost.
			if (source === "poll" && pendingCountdown.active && !pendingCountdown.fired) return;

			const result = await waitLifecycle.evaluateDue();
			if (!result.applied || !result.evaluation) {
				// Nothing was decided: the wait is not due yet, the
				// evaluation was stale, or the wait is already in a state
				// that does not decide.
				//
				// The attempt is over either way: the guard against a
				// second, overlapping evaluation is released, so a later
				// question can still be decided.
				_inferenceInProgress = false;
				if (result.discardReason === "other-session") {
					// The session changed: the question of the old session
					// is closed with it.
					sharedState.pqController?.cancel("Session switched");
					waitLifecycle.cancel();
					updateAutoContinueStatus("IDLE");
				}
				if (result.discardReason === "not-eligible") {
					// The question became obsolete while it waited: it is
					// closed without an answer and the work is idle.
					sharedState.pqController?.cancel("the question is obsolete");
					updateAutoContinueStatus("IDLE");
				}
				return;
			}

			if (result.state === "evaluation_error") {
				// The provider failed. Nothing was decided: the question
				// stays open for the human and the work is not continued.
				const message = result.evaluation.error?.message ?? "the evaluation failed";
				logToFile("[auto-continue]", "The evaluation of the question failed:", message);
				_inferenceInProgress = false;
				updateAutoContinueStatus("ERROR");
				// The question is still open: the work must not continue
				// behind it. The pause ends when the question is answered
				// (a channel answer resumes it) or cancelled (a reply of
				// the user in Pi cancels it).
				(sharedState.todoContinuationController as any)?.explicitPause?.();
				addHarnessMessage("Jev", "auto-continue evaluation failed", "err", [
					"How to fix: Check logs at /tmp/pi-harness.log for API errors",
					"Ensure TYPESAFE_API_KEY is valid, then restart.",
				]);
				return;
			}

			await applyWaitDecision(result.evaluation);
			// The decision was applied or discarded. The guard against a
			// second, overlapping evaluation is released here, so a
			// decision that was discarded does not block the next question.
			_inferenceInProgress = false;
		};

		// --- todo continuation: Retain one controller per session ----------
		let todoContinuationController: import("./packages/jev-judge/dist/continuation-controller.js").TodoContinuationController | null = null;
		// Ledger of the validation runs: it is the only mechanical source for
		// "did the final tier pass?" and therefore guards the completion report.
		let validationLedger: import("./packages/jev-judge/dist/validation-ledger.js").ValidationLedger | null = null;

		// Create controller on session_start with proper dispatch callback
		pi.on("session_start", async (_event, ctx) => {
			try {
				const { TodoContinuationController } = await import("./packages/jev-judge/dist/continuation-controller.js");
				const { ValidationLedger } = await import("./packages/jev-judge/dist/validation-ledger.js");
				// The ledger records which validation tier ran. The controller
				// uses it to tell the agent what already passed and whether the
				// final tier is still pending.
				validationLedger = new ValidationLedger({
					onRecord: (record) => {
						centralInfo(
							"validation",
							"tier.run",
							`${record.tier} tier ${record.status}`,
							{
								itemId: record.itemId,
								tier: record.tier,
								status: record.status,
								durationMs: record.durationMs,
								datasetSize: record.datasetSize,
								command: record.command,
							},
						);
					},
				});
				// The two-phase workflow reads the same ledger: the phase gate
				// and the completion report must never disagree about a tier.
				sharedState.validationLedger = validationLedger;
				// SAFETY: ctx is ExtensionContext with sessionManager, isIdle, hasPendingMessages
				// dispatch uses pi.sendUserMessage for actual message delivery
				todoContinuationController = new TodoContinuationController(
					ctx as unknown as import("./packages/jev-judge/dist/todo-provider.js").TodoContext,
					{
						dispatch: async (content: string) => {
							await pi.sendUserMessage(content, { deliverAs: "steer" });
						},
						validationLedger,
					}
				);
				// The runtime of the provider recovery reads the pause state
				// of the user through this handle.
				todoContinuationHandle = todoContinuationController;
				// The scope of the previous session says nothing about this
				// one: the todos of that session are its history.
				requestScopeTracker.reset();
				// The callbacks that answer a question in a channel, and the
				// replies of the user, reach the controller through the
				// shared state. Without it every pause and every resume of
				// the work was a call on nothing, so a decline of the user
				// never stopped the work.
				sharedState.todoContinuationController = todoContinuationController;
				logToFile("[auto-continue]", "Todo continuation controller initialized");
			} catch (err) {
				logToFile("[auto-continue]", "Failed to create todo continuation controller:", String(err));
			}
		});

		// Clean up controller on session shutdown
		pi.on("session_shutdown", () => {
			// Release the guard timer and the queue: a stopped session must not
			// keep a timer alive nor block a later continuation.
			todoContinuationController?.dispose?.();
			todoContinuationController = null;
			todoContinuationHandle = null;
			sharedState.todoContinuationController = null;
			sharedState.validationLedger = null;
			// The scope belongs to the session that is ending.
			requestScopeTracker.reset();
		});

		// --- task-intake: Automatic todo capture from user requests -----------
		let taskIntakeController: import("./packages/jev-judge/dist/task-intake.js").TaskIntakeController | null = null;

		// Create task intake controller if a Jev provider is available
		if (jevProviders.length > 0) {
			try {
				const { TaskIntakeController } = await import("./packages/jev-judge/dist/task-intake.js");
				taskIntakeController = new TaskIntakeController({
					providers: jevProviders,
					dispatch: async (content: string) => {
						// Queue for next turn so agent processes after current work completes
						await pi.sendUserMessage(content, { deliverAs: "followUp" });
					},
				});
				logToFile("[auto-continue]", "Task intake controller initialized");
			} catch (err) {
				logToFile("[auto-continue]", "Failed to create task intake controller:", String(err));
			}
		}

		// Clean up task intake on session shutdown
		pi.on("session_shutdown", () => {
			taskIntakeController = null;
		});

		// Wire user messages to task intake
		pi.on("message_start", (event) => {
			const msgEvent = event as { message?: { role?: string; content?: string | Array<{ type?: string; text?: string }>; customType?: string } };
			const msg = msgEvent.message;
			if (!msg) return;

			// Skip harness-generated messages (internal use)
			if (msg.customType?.startsWith("harness:")) {
				return;
			}

			if (msg.role === "user" && taskIntakeController) {
				// Extract user message content FIRST (needed for both pause and intake)
				const content = msg.content;
				let userMessage = "";
				if (typeof content === "string") {
					userMessage = content;
				} else if (Array.isArray(content)) {
					const textBlocks = (content as Array<{ type?: string; text?: string }>)
						.filter((c): c is { type: "text"; text: string } =>
							c.type === "text" && typeof c.text === "string"
						);
					userMessage = textBlocks.map((c) => c.text).join("\n");
				}

				// Check for explicit resume request
				if (detectResume(userMessage)) {
					if (todoContinuationController) {
						todoContinuationController.resume();
						logToFile("[auto-continue]", "Resume detected, continuing work");
					}
					// Resume task intake to re-enable processing
					if (taskIntakeController) {
						taskIntakeController.resumeIntake();
					}
					// Allow normal processing after resume
				}

				// Check for explicit stop/pause request
				if (detectExplicitPause(userMessage)) {
					if (todoContinuationController) {
						todoContinuationController.explicitPause();
						logToFile("[auto-continue]", "Explicit pause/stop detected");
					}
					// The user took over: a pending resume would inject
					// itself against the decision of the user.
					providerRecoveryRuntime?.cancel();
					// Invalidate any pending Jev evaluations to prevent late dispatch
					if (taskIntakeController) {
						taskIntakeController.invalidatePending();
					}
					// Don't process intake for explicit stop
					return;
				}

				// Check for large refactor keywords and trigger delegation assessment
				if (sharedState.delegationHarness) {
					const lowerMsg = userMessage.toLowerCase();
					const largeRefactorPatterns = [
						/mass refactor|big refactor|large refactor|extensive refactor/i,
						/refactor.*across|across.*refactor/i,
						/migrate.*to|to.*migrate/i,
						/restructure|reorganize.*codebase/i,
						/update.*all|update.*many|change.*all|change.*many/i,
					];
					const isLargeRefactor = largeRefactorPatterns.some((p) => p.test(lowerMsg));
					if (isLargeRefactor) {
						// The scope is measured in the workspace: the request
						// names the files, or the session changed them. A
						// number that nobody counted is not a scope, so the
						// assessment waits for the measurement.
						logToFile("[Delegation]", "Large refactor request detected, measuring the scope");
						measureDelegationScope(userMessage)
							.then((facts) => {
								if (!facts) {
									logToFile("[Delegation]", "No measurable scope in the request - no delegation assessment");
									return null;
								}
								return sharedState.delegationHarness
									.assess(facts, `user-request-${facts.fingerprint}`)
									.then(async (decision: DelegationDecisionLike | null) => {
										if (decision) {
											logToFile(
												"[Delegation]",
												`Assessment: ${decision.strategy} - ${decision.reason} (${decision.workGroups?.length ?? 0} measured group(s), dispatched=${decision.dispatched === true})`,
											);
										}
										await handDelegationPlanToAgent(decision, facts.fingerprint);
										return decision;
									})
									.catch((e: unknown) => logToFile("[Delegation]", "Assessment error:", String(e)));
							})
							.catch((e: unknown) => logToFile("[Delegation]", "Scope measurement failed:", String(e)));
					}
				}

				// Temporary pause for user input processing (auto-clears on next decision)
				if (todoContinuationController) {
					todoContinuationController.tempPause();
					logToFile("[auto-continue]", "User input received, temp pausing");
				}

					// Task intake is now handled by debounce timer in message_start handler
					// This ensures single trigger path for multi-prompt detection
			}
		});

		// Detect explicit stop/pause requests (must be a directive TO the harness, not mentions)
		function detectExplicitPause(text: string): boolean {
			const lower = text.toLowerCase().trim().replace(/[.!?,;]+$/, '');  // Strip trailing punctuation
			// Must be an explicit directive to STOP/PAUSE the harness
			const explicitPatterns = [
				/^(stop|pause|wait|hold|wait a moment)$/i,
				/^(please\s+)?(stop|pause)$/i,
				/^(please\s+)?(stop|pause)\s+(the\s+)?agent/i,
				/^(please\s+)?(stop|pause)\s+(and|for|until|with)/i,
				/^(please\s+)?stop\s+working/i,
				/^(please\s+)?pause\s+(the\s+)?work/i,
				/^(please\s+)?do\s+not\s+(continue|proceed|go|start)/i,
				/^wait\s+(for\s+me|one|two|three|minute|moment|second)/i,
				/^hold\s+(on|up|there)/i,
				/^not\s+(yet|now|ready)/i,
			];
			for (const pattern of explicitPatterns) {
				if (pattern.test(lower)) {
					return true;
				}
			}
			// A decline of the proposal is a decision about the work: it
			// pauses the work like a stop directive does - but only when
			// there is a proposal to decline. An ordinary negative
			// statement ("I don't see any errors") declines nothing and
			// must not pause the session.
			if (!hasOpenQuestion() && !isWaitingForUser()) return false;
			return isRejection(text);
		}

		// Detect resume requests - ONLY explicit resume directives, not acknowledgments
		// Acknowledgments like "okay" or "yes" should NOT clear an explicit pause
		function detectResume(text: string): boolean {
			const lower = text.toLowerCase().trim().replace(/[.!?,;]+$/, '');  // Strip trailing punctuation
			// Only explicit resume/continue directives clear the pause
			const resumePatterns = [
				/^(resume|continue|go\s+ahead|carry\s+on|proceed)$/i,
				/^(please\s+)?(resume|continue)$/i,
				/^(please\s+)?(resume|continue)\s+(the\s+)?(work|agent|task)/i,
				/^(please\s+)?go\s+ahead/i,
				/^(please\s+)?carry\s+on/i,
			];
			for (const pattern of resumePatterns) {
				if (pattern.test(lower)) {
					return true;
				}
			}
			return false;
		}

		// --- agent_settled: Check todos and continue work ---------------
		pi.on("agent_settled", async (_event, ctx) => {
			// The turn that a previous continuation triggered has now settled:
			// release the dispatch guard so the next decision can dispatch again.
			// Keeping it set would block every later dispatch while still
			// consuming the retry budget.
			todoContinuationController?.releaseContinuationGuard?.("agent_settled");

			// The turn that a continuation started has settled: the status
			// returns to idle, unless the handler below dispatches the next
			// continuation.
			if (_continuation.settle()) {
				updateAutoContinueStatus("IDLE");
			}

			// A question whose work is done is obsolete. It must not block
			// the completion of the request, and the code that discovers it
			// is stale must run before the open question stops the handler.
			await reconcileObsoleteQuestion();

			// Don't continue if user is waiting for response, and do not
			// continue behind a question that is still open: the work waits
			// for the answer, also when the wait itself is over.
			if (!mayContinue({ waiting: isWaitingForUser(), questionOpen: hasOpenQuestion() })) {
				todoContinuationController?.clearQueue();
				return;
			}

			// Don't continue if inference is already in progress
			if (_inferenceInProgress) {
				return;
			}

			// Don't continue if session is not idle or has pending messages
			if (!ctx.isIdle?.() || ctx.hasPendingMessages?.()) {
				return;
			}

			// Use the retained controller (not a new one per event)
			try {
				if (!todoContinuationController) {
					logToFile("[auto-continue]", "No todo continuation controller available");
					return;
				}

				const result = await todoContinuationController.decide();

				if (result.action === "continue" && result.nextItemId) {
					updateAutoContinueStatus("CONTINUING");
					const steer = await todoContinuationController.steerToContinue(result.nextItemId);
					if (!steer?.dispatched) {
						// Surface an explicit stall reason instead of silently doing nothing
						logToFile(
							"[auto-continue]",
							"Continuation not dispatched:",
							steer?.reason ?? "unknown reason",
							`(attempts=${steer?.attempts ?? 0}, blocked=${steer?.blockedDispatches ?? 0})`,
						);
						updateAutoContinueStatus("IDLE");
					}
					// Guard stays set while the agent processes the continuation and is
					// released by releaseContinuationGuard() on the next agent_settled.
				} else {
					// Not continuing - clear queue to allow future decisions
					todoContinuationController.clearQueue();
					updateAutoContinueStatus("IDLE");

					if (result.action === "blocked") {
						updateAutoContinueStatus("ERROR", "blocked");
						logToFile("[auto-continue]", "Tasks blocked:", result.question ?? "unknown");
					} else if (result.action === "stop") {
						const reason = result.reason ?? "unknown";
						logToFile("[auto-continue]", "decide returned stop:", reason);

						// Only send completion notification for "No pending tasks"
						// Other stop reasons (paused, unavailable, max attempts) are not completion
						const isNoPendingTasks = reason === "No pending tasks";

						if (isNoPendingTasks) {
							// A todo whose final tier is still pending must not be
							// reported as complete. The item may already be marked
							// completed by the agent - the ledger is the check that
							// catches it.
							const snapshot = await todoContinuationController.getSnapshot();
							const pendingFinalTier = validationLedger
								? snapshot.items.filter((item) => validationLedger?.isFinalTierPending(item))
								: [];
							if (pendingFinalTier.length > 0) {
								const details = pendingFinalTier
									.map((item) => `${item.id}:${item.subject}`)
									.join(", ");
								logToFile(
									"[auto-continue]",
									"Completion suppressed - final tier still pending for:",
									details,
								);
								updateAutoContinueStatus("ERROR", "final tier pending");
								return;
							}
							// Check if there's a pending question - suppress completion if so
							if (pqController.hasPendingQuestion()) {
								logToFile("[auto-continue]", "Suppressing completion - pending question exists");
								updateAutoContinueStatus("WAITING", "pending");
								return;
							}

							// Deduplication: only notify once per work generation
							// Use a static flag for this session's settled cycle
							const completionKey = `done-${reason}`;
							if (_completedNotifiedFor === completionKey) {
								logToFile("[auto-continue]", "Completion already notified for:", reason);
								return;
							}
							_completedNotifiedFor = completionKey;

							// Get full todo list for notification
							const todoList = snapshot.items
								.map((item) => {
									const status = item.status === "completed" ? "[DONE]" : "[PENDING]";
									const subject = item.subject.length > 50 ? item.subject.slice(0, 47) + "..." : item.subject;
									return `${status} ${subject}`;
								})
								.join("\n");
							const message = todoList || "All tasks completed";
							// Notify user that all work is complete with todo list
							_nc?.notify("ReadyForClient", {
								jobId: `done-${reason.replace(/\s+/g, "-")}`,
								requirement: message,
							}).catch((e) => logToFile("[Notification]", "ReadyForClient failed:", String(e)));
						}
					}
					}
				} catch (err) {
				logToFile("[auto-continue]", "agent_settled handler error:", String(err));
				todoContinuationController?.clearQueue();
			}
		});

		// Start periodic check
		autoContinueTimer = setInterval(
			() => checkAndAutoContinue("poll"),
			AUTO_CONTINUE_INTERVAL_MS,
		);
		if (jevKeyMissing) {
			// Without a provider the health check cannot run. The missing-key
			// message (with its fix commands) stays the visible one.
			logStartup("[pi-harness] Jev: no API key - auto-continue stays off until a key is configured");
		} else {
			addHarnessMessage("Jev", "auto-continue configured (verifying API...)", "ok");

			// Verify the API works with a health check that exercises every
			// question type the auto-continue judge uses. A noul only check would
			// pass while the choice and score questions of the real decision were
			// rejected by the API.
			try {
				const { JevJudge } = await import("./packages/jev-judge/dist/index.js");
				const judge = new JevJudge({ providers: jevProviders });
				const health = await judge.evaluate("health check", {
					noul: { type: "noul" as const, instructions: "Is this a test?" },
					choice: {
						type: "choice" as const,
						instructions: "Pick one",
						options: ["yes", "no"],
					},
					score: {
						type: "score" as const,
						instructions: "How confident is the test?",
						min: 1,
						max: 5,
						criteria: ["1 - no", "2 - low", "3 - medium", "4 - high", "5 - certain"],
					},
				});
				addHarnessMessage(
					"Jev",
					`auto-continue ready (API verified, model ${health.model} via ${health.provider})`,
					"ok"
				);
			} catch (verifyErr) {
				addHarnessMessage("Jev", "auto-continue not ready (API verification failed)", "warn", [
					`Error: ${oneLineError(verifyErr)}`,
					"Check API key and network access, then reload Pi.",
					"If the key is wrong or expired, replace it:",
					...keyFileFixesOrFallback("Jev", ["API key"]),
				]);
			}
		}
	} catch (_err) {
		addHarnessMessage("Jev", "auto-continue initialization failed", "err", [
			"Check Jev package installation and key-file permissions, then reload Pi.",
			"If the API key file is missing or unreadable, create it:",
			...keyFileFixesOrFallback("Jev", ["API key"]),
		]);
	}
}

// --- todo-bd-sync: Two-way sync between rpiv-todo and bd --------------------
// Lazy import - only loads when packages/todo-bd-sync exists
async function initTodoBdSync(pi: ExtensionAPI): Promise<void> {
	try {
		const mod = await import("./packages/todo-bd-sync/dist/extension.js");
		mod.registerTodoBdSync(pi);
	} catch {
		// todo-bd-sync not available
	}
}

// --- config-capture: Auto-detect and document API configuration -------------
// Lazy import - only loads when packages/config-capture exists
async function initConfigCapture(pi: ExtensionAPI): Promise<void> {
	try {
		const mod = await import("./packages/config-capture/dist/index.js");
		mod.registerConfigCapture(pi, { debug: false });
	} catch {
		// config-capture not available
	}
}

// --- qdrant-vector-search: Semantic skill search via Qdrant -------------------
// Check config and report status — right after Jev for discoverability
async function initQdrant(): Promise<void> {
	addHarnessMessage("Qdrant", "checking configuration", "wait");
	try {
		const { getQdrantConfig } = await import("./packages/skills/dist/loader.js");
		const cfg = getQdrantConfig();
		if (cfg) {
			// Check if OpenAI embedding key is available
			const { getOpenAIApiKey } = await import("./packages/qdrant-skills/dist/embedder.js");
			const embeddingKey = getOpenAIApiKey();
			if (embeddingKey) {
				logStartup("[pi-harness] Qdrant vector search ready");
				addHarnessMessage("Qdrant", "verifying connection...", "ok");

				// Verify Qdrant connection with health check
				try {
					// Use /healthz endpoint (not /health) for Qdrant
					const healthUrl = `${cfg.url}/healthz`;
					const healthResponse = await fetch(healthUrl, {
						headers: cfg.apiKey ? { "api-key": cfg.apiKey } : {},
					});
					if (healthResponse.ok) {
						addHarnessMessage("Qdrant", "ready (connection verified)", "ok");
					} else {
						addHarnessMessage("Qdrant", "not ready (connection failed)", "warn", [
							`Health check returned: ${healthResponse.status} ${healthResponse.statusText}`,
							"Check cluster URL and network access, then reload Pi.",
							"If the cluster URL or the key is wrong, replace it:",
							...keyFileFixesOrFallback("Qdrant", ["cluster endpoint", "API key"]),
						]);
					}
				} catch (healthErr) {
					addHarnessMessage("Qdrant", "not ready (connection failed)", "warn", [
							`Error: ${healthErr instanceof Error ? healthErr.message : String(healthErr)}`,
							"Check cluster URL and network access, then reload Pi.",
							"If the cluster URL or the key is wrong, replace it:",
							...keyFileFixesOrFallback("Qdrant", ["cluster endpoint", "API key"]),
						]);
				}
			} else {
				logStartup("[pi-harness] Qdrant ready (no embedding key — skills won't be vector-indexed)");
				addHarnessMessage("Qdrant", "embedding key missing; vector indexing unavailable", "warn", [
					...keyFileFixesOrFallback("Qdrant", ["embedding key"]),
					"Or set OPENAI_API_KEY in the environment, then reload Pi.",
				]);
				logStartup('[pi-harness] For vector search: echo "{openai-api-key}" > ~/.pi-harness-runtime/keys/openai-api-key.txt');
			}
		} else {
			logStartup("[pi-harness] Qdrant not configured. Set keys to enable vector skill search:");
			addHarnessMessage("Qdrant", "not configured", "warn", [
				...keyFileFixesOrFallback("Qdrant", ["cluster endpoint", "API key"]),
				"Or set QDRANT_CLUSTER_ENDPOINT and QDRANT_API_KEY in the environment, then reload Pi.",
			]);
			logStartup(`  echo "{cluster-url}" > ~/.pi-harness-runtime/keys/qdrant-cluster-url.txt`);
			logStartup(`  echo "{api-key}" > ~/.pi-harness-runtime/keys/qdrant-api-key.txt`);
		}
	} catch {
			addHarnessMessage("Qdrant", "initialization failed", "err", [
				"How to fix: Check Qdrant cluster is running and credentials are correct",
				"Verify QDRANT_CLUSTER_ENDPOINT and QDRANT_API_KEY are set.",
				"If the cluster URL or the key is wrong, replace it:",
				...keyFileFixesOrFallback("Qdrant", ["cluster endpoint", "API key"]),
			]);
	}
}

// --- telegram-notifications: Telegram bot for harness event notifications ------------
// Sends Telegram messages when jobs complete, tasks finish, or human input is needed.

// Shared Codex session state - accessible by both initTelegram() and the watcher
let _piSessionCwd = "";
const _SETTLE_DELAY_MS = 5000; // Wait 5 seconds after plan ready

interface PlanEvent {
	codexSessionId: string;
	planPath: string;
	planHash: string;
	status: "observed" | "settling" | "ready" | "triggered" | "failed" | "manual_wait" | "done";
	ordinal: number;
	lastActivity: number;
	settleTimer: ReturnType<typeof setTimeout> | null;
	fileStableSince: number;
}

interface PendingPINGPONGAction {
	token: string;
	sessionId: string;
	action: "code" | "review" | "code_again" | "done";
	projectRoot: string;
	allowedStage: string;
	expiresAt: number;
	used: boolean;
}

const codexSessionState = {
	deliveredEvents: new Map<string, PlanEvent>(),
	currentCodexSessionId: null as string | null,
	currentProjectRoot: null as string | null,
	currentPlanCandidate: null as { ordinal: number; text: string; timestamp: number } | null,
	pendingActions: new Map<string, PendingPINGPONGAction>(),
	// --- greeting state ---
	greetingBaselineSessionId: null as string | null,  // set on watcher startup
	greetedSessions: new Set<string>(),                 // "piSessionId:codexSessionId"
	pendingGreeting: null as { sessionId: string; projectRoot: string; timestamp: number } | null,
};

// PING_PONG callback action type (different from generic APPROVE/REJECT)
const PING_PONG_ACTIONS = {
	CODE: "ping_code",
	REVIEW: "ping_review",
	CODE_AGAIN: "ping_code_again",
	DONE: "ping_done",
} as const;

// Generate opaque token for PING_PONG action
function createPINGPONGToken(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return Array.from(array, b => b.toString(16).padStart(2, "0")).join("");
}

// Create a pending PING_PONG action and return its token (used when sending button notifications)
function _createPendingAction(
	sessionId: string,
	action: "code" | "review" | "code_again" | "done",
	projectRoot: string,
	allowedStage: string
): string {
	const token = createPINGPONGToken();
	codexSessionState.pendingActions.set(token, {
		token,
		sessionId,
		action,
		projectRoot,
		allowedStage,
		expiresAt: Date.now() + 30 * 60 * 1000, // 30 min expiry
		used: false,
	});
	return token;
}

// Find pending action by session ID (for /task fallback)
function findPendingActionBySession(sessionId: string): PendingPINGPONGAction | undefined {
	for (const action of codexSessionState.pendingActions.values()) {
		if (action.sessionId === sessionId && !action.used && Date.now() < action.expiresAt) {
			return action;
		}
	}
	return undefined;
}

// Advance Codex task - shared by both button callbacks and /task commands
async function advanceCodexTask(
	token: string,
	action: "code" | "review" | "code_again" | "done",
	pi: ExtensionAPI
): Promise<{ success: boolean; error?: string }> {
	const pending = codexSessionState.pendingActions.get(token);
	
	// Validate pending action
	if (!pending) {
		return { success: false, error: "Action expired or not found" };
	}
	if (pending.used) {
		return { success: false, error: "Action already used" };
	}
	if (Date.now() > pending.expiresAt) {
		codexSessionState.pendingActions.delete(token);
		return { success: false, error: "Action expired" };
	}
	if (pending.sessionId !== codexSessionState.currentCodexSessionId) {
		return { success: false, error: "Session no longer active" };
	}
	if (pending.projectRoot !== codexSessionState.currentProjectRoot) {
		return { success: false, error: "Project root mismatch" };
	}
	
	// Mark as used
	pending.used = true;
	
	// Find the event
	const event = Array.from(codexSessionState.deliveredEvents.values()).find(
		e => e.codexSessionId === pending.sessionId
	);
	if (!event) {
		return { success: false, error: "Session event not found" };
	}
	
	// Check status for code action
	if (action === "code" && event.status !== "manual_wait" && event.status !== "ready") {
		return { success: false, error: `Plan not ready (status=${event.status})` };
	}
	
	// Execute action
	if (action === "code" || action === "code_again") {
		// The decision of the human starts new work: it begins a request.
		// The message reaches Pi as a message of the harness, so the input
		// event cannot begin the scope of the request.
		beginHumanRequest();
		await pi.sendUserMessage(
			`Human approved. Proceed to implement: ${event.planPath}`,
			{ deliverAs: "steer" }
		);
		event.status = "triggered";
		logToFile("[codex-trigger]", `Advanced to code: ${event.planPath}`);
	} else if (action === "review") {
		// The decision of the human starts new work: it begins a request.
		beginHumanRequest();
		await pi.sendUserMessage(
			"Human requests a review of the implementation.",
			{ deliverAs: "steer" }
		);
		logToFile("[codex-trigger]", "Advanced to review");
	} else if (action === "done") {
		event.status = "done";
		logToFile("[codex-trigger]", "Human marked done");
	}
	
	return { success: true };
}

async function initTelegram(pi: ExtensionAPI): Promise<void> {
	addHarnessMessage("Telegram", "initializing", "wait");
	try {
		const notifModule = await import("./packages/notification/dist/index.js");
		const NotificationCenter = notifModule.NotificationCenter;
		const createConversationBridge = notifModule.createConversationBridge;
		const { readFileSync, existsSync } = await import("node:fs");
		const home = process.env.HOME || process.env.USERPROFILE || homedir();
		const keysDir = `${home}/.pi-harness-runtime/keys`;

		const botTokenPath = `${keysDir}/telegram-bot-token.txt`;
		const chatIdPath = `${keysDir}/telegram-chat-id.txt`;
		const lineTokenPath = `${keysDir}/line-access-token.txt`;
		const lineUserIdPath = `${keysDir}/line-user-id.txt`;

		if (!existsSync(botTokenPath) || !existsSync(chatIdPath)) {
			logStartup("[pi-harness] Telegram (@PiHarnessRuntimeBot) not configured:");
			logStartup("[pi-harness]   1. DM @BotFather → /newbot → name it → get token");
			logStartup("[pi-harness]   2. DM @userinfobot → reply shows your chat ID");
			logStartup("[pi-harness]   3. echo \"{token}\" > ~/.pi-harness-runtime/keys/telegram-bot-token.txt");
			logStartup("[pi-harness]   4. echo \"{chat-id}\" > ~/.pi-harness-runtime/keys/telegram-chat-id.txt");
			logStartup("[pi-harness]   5. Reload pi — then DM @PiHarnessRuntimeBot to verify");
			const telegramFixes = keyFileFixesOrFallback("Telegram", ["bot token", "chat id", "allowed user ids"]);
			addHarnessMessage("Telegram", "credentials missing; notifications unavailable", "warn", [
				...telegramFixes,
				"Then reload Pi.",
			]);
			return;
		}

		const botToken = readFileSync(botTokenPath, "utf8").trim();
		const chatId = readFileSync(chatIdPath, "utf8").trim();

		// Load LINE credentials
		const hasLineCredentials = existsSync(lineTokenPath) && existsSync(lineUserIdPath);
		const lineAccessToken = hasLineCredentials ? readFileSync(lineTokenPath, "utf8").trim() : null;
		const lineUserId = hasLineCredentials ? readFileSync(lineUserIdPath, "utf8").trim() : null;

		// The identity of the person the notifications reach. It is hashed
		// before it is stored and never reaches a log file.
		_toolingIdentity = chatId || lineUserId || "";

		if (!botToken || !chatId) {
			logStartup("[pi-harness] Telegram: bot token or chat ID is empty — skipping");
			const emptyFixes = keyFileFixesOrFallback("Telegram", ["bot token", "chat id"]);
			addHarnessMessage("Telegram", "bot token or chat ID is empty; notifications unavailable", "warn", [
				...emptyFixes,
				"Fill the file(s) above, then reload Pi.",
			]);
			return;
		}

		const allowedUserIds = [...getAllowedUserIds()];
		const channels: Array<{
			id: string;
			type: string;
			enabled: boolean;
			config: Record<string, unknown>;
		}> = [
			{
				id: "telegram",
				type: "telegram",
				enabled: true,
				config: { botToken, chatId, allowedUserIds },
			},
		];

		// Who may write into Pi? A group chat id is not a user id: when the
		// allow-list holds only a group id, the inbound path is closed - and
		// that must be visible, not silent.
		const inboundAccess = describeInboundAccess(allowedUserIds, chatId);
		logStartup(`[pi-harness] Telegram inbound: ${inboundAccess}`);
		if (inboundAccess.startsWith("nobody")) {
			addHarnessMessage(
				"Telegram",
				"nobody may write in: the allow-list holds no user id",
				"warn",
				[
					"Write your Telegram user id into ~/.pi-harness-runtime/keys/telegram-allowed-users.txt (a chat id of a group is not a user id).",
					"Then reload Pi.",
				],
			);
		}

		// Add LINE channel if credentials exist
		const lineChannelConfigured = Boolean(hasLineCredentials && lineAccessToken && lineUserId);
		if (lineChannelConfigured) {
			channels.push({
				id: "line",
				type: "line" as const,
				enabled: true,
				config: { channelAccessToken: lineAccessToken, userId: lineUserId },
			});
		}
		// The "LINE: not configured" line (with the fix commands) is reported by
		// reportLineConfiguration() from the top-level init - it must show up
		// even when Telegram itself is not configured.

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const center = new NotificationCenter({
			enabled: true,
			channels: channels as any,
		});

		await center.initialize();
		// The channel states are only green when the channel really
		// initialized - the credentials alone are not proof that it works.
		telegramChannelState = center.isChannelHealthy("telegram") ? "started" : "failed";
		// The LINE line is only green when the channel really initialized -
		// the credentials alone are not proof that it works.
		if (lineChannelConfigured) {
			if (center.isChannelHealthy("line")) {
				lineChannelState = "started";
				lineChannelDiagnostic = null;
				// The LINE line belongs directly after the Telegram line: the
				// two notification channels are one topic.
				addHarnessMessageAfter(
					"Telegram",
					"LINE",
					"configured and enabled (tap Toggle LINE to disable)",
					"ok",
				);
			} else {
				lineChannelState = "failed";
				// Keep the reason: "the token is wrong" and "LINE is down"
				// need different actions.
				lineChannelDiagnostic = center.getChannelDiagnostic("line");
			}
		}
		if (telegramChannelState !== "started") {
			logStartup("[pi-harness] Telegram: initialization failed — skipping");
			addHarnessMessage("Telegram", "bot verification failed; notifications unavailable", "err", [
				"How to fix: Verify bot token in ~/.pi-harness-runtime/keys/telegram-bot-token.txt",
				"Check the bot exists and token is valid at @BotFather.",
				"Check the bot token and network access, then reload Pi.",
				"If the bot token or the chat id is wrong, replace it:",
				...keyFileFixesOrFallback("Telegram", ["bot token", "chat id"]),
			]);
			return;
		}

		// Register callback handler for inline keyboard button clicks
		const { parseCallbackData, CallbackActions } = await import(
			"./packages/notification/dist/telegram-webhook-handler.js"
		);
		center.setCallbackHandler(async (data: string, _query: { id: string; from: { id: number } }, acknowledge) => {
			const parsed = parseCallbackData(data);
			logToFile("[TelegramCallback]", `action=${parsed.action} target=${parsed.targetId}`);

			// Handle PING_PONG button callbacks
			if (parsed.action === PING_PONG_ACTIONS.CODE || 
				parsed.action === PING_PONG_ACTIONS.REVIEW ||
				parsed.action === PING_PONG_ACTIONS.CODE_AGAIN ||
				parsed.action === PING_PONG_ACTIONS.DONE) {
				// Map action string to internal action type
				const actionMap: Record<string, "code" | "review" | "code_again" | "done"> = {
					[PING_PONG_ACTIONS.CODE]: "code",
					[PING_PONG_ACTIONS.REVIEW]: "review",
					[PING_PONG_ACTIONS.CODE_AGAIN]: "code_again",
					[PING_PONG_ACTIONS.DONE]: "done",
				};
				const internalAction = actionMap[parsed.action];
				
				const result = await advanceCodexTask(parsed.targetId, internalAction, pi);
				if (result.success) {
					logToFile("[TelegramCallback]", `PING_PONG ${internalAction} succeeded`);
					await acknowledge(`Action ${internalAction} applied`);
				} else {
					logToFile("[TelegramCallback]", `PING_PONG ${internalAction} failed: ${result.error}`);
					await acknowledge(`Action failed: ${result.error}`);
				}
				return; // Don't fall through to generic handlers
			}

			switch (parsed.action) {
				case CallbackActions.TOOLING_PREFERENCE: {
					// The proposal is a decision of its own: it never resolves a
					// pending question and it never pauses the work.
					const result = await resolveToolingPreference(
						parsed.targetId,
						"telegram",
						pi,
					);
					await acknowledge(
						result.applied
							? `Saved - ${result.reason}`
							: `Stale button - ${result.reason}`,
					);
					break;
				}
				case CallbackActions.APPROVE: {
					// The user clicked Continue. The request ID in the
					// callback data is the canonical one, so the click
					// resolves exactly this question.
					logToFile("[TelegramCallback] Approved - user clicked Continue, resuming work");
					if (!applyChannelApproval(parsed.action, parsed.targetId, "telegram")) {
						await acknowledge("Stale button - no pending question to approve");
					}
					break;
				}
				case CallbackActions.REJECT: {
					// The user clicked Not yet - dismiss and pause.
					logToFile("[TelegramCallback] Rejected - user clicked Not yet, pausing");
					if (!applyChannelApproval(parsed.action, parsed.targetId, "telegram")) {
						await acknowledge("Stale button - no pending question to reject");
					}
					break;
				}
				default:
					// Check for channel toggle actions
					if (parsed.action === "toggle_telegram") {
						const telegramEnabled = (center as any).isChannelEnabled?.("telegram") ?? true;
						(center as any).setChannelEnabled?.("telegram", !telegramEnabled);
						logToFile("[TelegramCallback]", `Telegram ${!telegramEnabled ? "enabled" : "disabled"}`);
						await acknowledge(`Telegram notifications ${!telegramEnabled ? "enabled" : "disabled"}`);
					} else if (parsed.action === "toggle_line") {
						const lineEnabled = (center as any).isChannelEnabled?.("line") ?? true;
						(center as any).setChannelEnabled?.("line", !lineEnabled);
						// The decision must survive a restart: the startup
						// summary has to know that the channel was turned off
						// on purpose.
						persistChannelDecision("line", !lineEnabled);
						logToFile("[TelegramCallback]", `LINE ${!lineEnabled ? "enabled" : "disabled"}`);
						await acknowledge(`LINE notifications ${!lineEnabled ? "enabled" : "disabled"}`);
						// The startup line must tell the truth.
						reportLineConfiguration();
					} else {
						logToFile("[TelegramCallback]", `Unknown action: ${parsed.action}`);
					}
				}
			});

		// Register message handler to forward Telegram messages to Pi
		center.setMessageHandler(async (text: string, _chatId: string) => {
			// Parse /notify-settings command for channel management
			// Usage: /notify-settings - show current status
			//        /notify-settings telegram on - enable Telegram
			//        /notify-settings line off - disable LINE
			//        /notify-settings all on - enable all channels
			const settingsMatch = text.match(/^\/notify-settings(?:\s+(\w+)\s+(on|off))?/i);
			if (settingsMatch || text === "/notify-settings") {
				const [, channel, action] = settingsMatch || [];

				if (action && channel) {
					const isEnabled = action === "on";
					const targetChannels = channel === "all" ? ["telegram", "line"] : [channel];
					for (const ch of targetChannels) {
						(center as any).setChannelEnabled?.(ch, isEnabled);
						// The decision must survive a restart.
						persistChannelDecision(ch, isEnabled);
						logToFile("[NotifySettings]", `Set ${ch} to ${isEnabled ? "enabled" : "disabled"}`);
					}
					if (targetChannels.includes("line")) {
						// The startup line must tell the truth.
						reportLineConfiguration();
					}
				}

				// Show current status
				const telegramStatus = (center as any).isChannelEnabled?.("telegram") ? "ON" : "OFF";
				const lineStatus = (center as any).isChannelEnabled?.("line") ? "ON" : "OFF";
				logToFile("[NotifySettings]", `Current: Telegram=${telegramStatus}, LINE=${lineStatus}`);
				logToFile("[NotifySettings]", `Commands: /notify-settings telegram on|off, /notify-settings line on|off, /notify-settings all on|off`);
				return;
			}

			// Parse /task <session-id> <action> commands
			const taskCommandMatch = text.match(/^\/task\s+(\S+)\s+(code|review|done)\s*$/i);
			if (taskCommandMatch) {
				const [, sessionId, action] = taskCommandMatch;
				
				// Map action string to internal type
				const actionMap: Record<string, "code" | "review" | "code_again" | "done"> = {
					code: "code",
					review: "review",
					done: "done",
				};
				const internalAction = actionMap[action.toLowerCase()];
				if (!internalAction) {
					logToFile("[codex-trigger]", `Unknown /task action: ${action}`);
					return;
				}
				
				// For /task, find pending action by session ID (buttons use token directly)
				const pendingAction = findPendingActionBySession(sessionId);
				if (!pendingAction) {
					logToFile("[codex-trigger]", `No pending action found for session: ${sessionId}`);
					return;
				}
				
				// Validate cwd for code/review
				if (internalAction === "code" || internalAction === "review") {
					if (_piSessionCwd && codexSessionState.currentProjectRoot && 
					    _piSessionCwd !== codexSessionState.currentProjectRoot) {
						logToFile("[codex-trigger]", `Cwd mismatch: Pi cwd=${_piSessionCwd} vs project=${codexSessionState.currentProjectRoot}`);
						return;
					}
				}
				
				logToFile("[codex-trigger]", `Human command: /task ${sessionId} ${action}`);
				const result = await advanceCodexTask(pendingAction.token, internalAction, pi);
				if (!result.success) {
					logToFile("[codex-trigger]", `/task failed: ${result.error}`);
				}
				return;
			}
			
			// The user's own words stay out of the log files: only the length
			// is recorded.
			logToFile("[TelegramInbound]", `Forwarding message to Pi (${text.length} chars)`);
			// A message of the human begins a new request: the work of the
			// request that ran before it is history now. The message reaches
			// Pi as a message of the harness, so the input event cannot
			// tell that it is a request.
			beginHumanRequest();
			// Forward the message to Pi as a user message
			await pi.sendUserMessage(text, { deliverAs: "steer" });
		});

		// Wire to singleton nc() helper so all event emitters can reach Telegram
		_nc = {
			center,
			notify: (event: string, ctx: Record<string, unknown>) =>
				center.notify(event as never, ctx as never),
			notifyWithApproval: (
				event: string,
				ctx: Record<string, unknown>,
				options?: { approveLabel?: string; rejectLabel?: string },
			) => center.notifyWithApproval(event as never, ctx as never, options as never),
		};

		// Wire to GLMQuotaCountdown so it sends Telegram alerts
		try {
			const { getGLMQuotaCountdown } = await import("./harness/index.js");
			getGLMQuotaCountdown().setNotificationCenter(center);
		} catch { /* not critical */ }

		// Register conversation bridge to send assistant responses to Telegram
		createConversationBridge(pi, center);

		// Log the actual bot username (fetched from Telegram API via getMe)
		const botUsername = center.getTelegramBotUsername();
		const telegram = center.getTelegramAdapter();
		telegram?.setGreetingVerifiedHandler(() => {
			addHarnessMessage("Telegram", "ready (tap Toggle Telegram to disable)", "ok");
		});

		// Set adapter for relay streaming (receives callbacks via WebSocket)
		setRelayTelegramAdapter(telegram);

		pi.on("session_shutdown", () => {
			telegram?.stopPolling();
			_relayClient?.disconnect();
		});

		// Initialize relay streaming (receives callbacks via WebSocket)
		// In webhook mode, streaming delivers callbacks in real-time
		await initRelayStream();

		const greeting = await telegram?.sendStartupGreeting();
		logStartup(`[pi-harness] Telegram greeting result: ${JSON.stringify(greeting)}`);
		if (!greeting?.success) {
			logStartup("[pi-harness] Telegram: startup greeting delivery failed - see logs");
			addHarnessMessage("Telegram", "bot verified; Hi delivery failed", "err", [
				"Open your bot in Telegram and press Start; unblock it if necessary.",
				"Verify telegram-chat-id.txt in ~/.pi-harness-runtime/keys/ and network access, then reload Pi.",
				"If the chat id is wrong, replace it:",
				...keyFileFixesOrFallback("Telegram", ["chat id"]),
			]);
			return;
		}
		// Polling and the remote webhook are mutually exclusive. Telegram
		// rejects getUpdates while a webhook is active, and the rejected poll
		// also terminates the getUpdates stream of every other poller of this
		// bot, which delayed the inbound text messages by seconds.
		if (telegram) {
			// A 409 (a webhook or another poller owns this bot) stops the
			// inbound path. The user must see it - a silent 409 looks like a
			// working inbound path.
			telegram.onPollStopped = (reason) => {
				addHarnessMessage("Telegram", `inbound polling stopped: ${reason}`, "warn", [
					"Telegram rejects getUpdates (409) while a webhook or another poller owns this bot.",
					"Stop the other poller of this bot (or remove the remote webhook), then reload Pi.",
				]);
			};
			if (!telegram.isWebhookConfigured()) {
				telegram.startPolling();
				// The poll may already have been rejected (a 409 fires the
				// callback above); make the reason visible either way.
				const stopReason = telegram.getPollStopReason();
				if (stopReason) {
					addHarnessMessage("Telegram", `inbound polling stopped: ${stopReason}`, "warn", [
						"Stop the other poller of this bot (or remove the remote webhook), then reload Pi.",
					]);
				}
			}
		}
		if (!telegram?.isGreetingVerified()) {
			addHarnessMessage("Telegram", "Hi sent; tap Say Hi to verify inbound (tap Toggle Telegram to disable)", "wait");
		}
		if (botUsername) {
			logStartup(`[pi-harness] Telegram (@${botUsername}) ready — DM the bot to receive alerts`);
		} else {
			logStartup(`[pi-harness] Telegram notifications ready`);
		}
	} catch (err) {
		// The channel did not come up: the state must say so - otherwise the
		// LINE line blames Telegram for not being configured (it was).
		telegramChannelState = "failed";
		logStartup(`[pi-harness] Telegram: init failed - ${err instanceof Error ? err.message : String(err)}`);
		addHarnessMessage("Telegram", "initialization failed; notifications unavailable", "err", [
			"How to fix: Check logs at /tmp/pi-harness.log for Telegram errors",
			"Ensure TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set correctly.",
			"If the bot token or the chat id is missing or wrong, replace it:",
			...keyFileFixesOrFallback("Telegram", ["bot token", "chat id"]),
		]);
	}
}

// ============================================================================
// --- relay-stream: WebSocket streaming for real-time Telegram callbacks -------
// ============================================================================
// Wires RelayClient to the Telegram adapter for two-way streaming communication.
// When callbacks arrive via WebSocket, they are forwarded to the adapter's
// handleWebhookUpdate() for proper greeting verification and callback handling.

let _relayTelegramAdapter: any = null;
let _relayClient: RelayClient | null = null;

/**
 * Set the Telegram adapter for relay streaming (called from initTelegram)
 */
function setRelayTelegramAdapter(adapter: any) {
	_relayTelegramAdapter = adapter;
}

/**
 * Resolve the relay endpoint from the SAME sources the relay server uses
 * (env -> dedicated key file -> the telegram webhook url/secret), so the
 * client and the server always agree on the URL and the token.
 * The token value is never logged - only the source it came from.
 */
function resolveRelayEndpointForHarness() {
	return resolveRelayEndpoint({ keysDir: join(homedir(), ".pi-harness-runtime", "keys") });
}

/**
 * The fix commands for the parts of the relay endpoint that are missing.
 * Only the missing part is listed - a relay that has a URL but no token must
 * not tell the user to create the URL file.
 */
function relayEndpointFixes(endpoint: {
	url?: string | null;
	token?: string | null;
	missing?: string[] | null;
}): string[] {
	const fixes: string[] = [];
	if (!endpoint.token) {
		fixes.push(...keyFileFixesOrFallback("Relay", ["auth token"]));
	}
	if (!endpoint.url) {
		// A rejected environment variable has the priority over the key file:
		// creating relay-ws-url.txt would not help while RELAY_WS_URL is
		// still set to the rejected value.
		const rejectedEnv = Array.isArray(endpoint.missing)
			? endpoint.missing.some(
					(reason) =>
						reason.startsWith("rejected source:") && reason.includes("env RELAY_WS_URL"),
				)
			: false;
		if (rejectedEnv) {
			fixes.push("Unset RELAY_WS_URL or set it to a ws:// or wss:// URL, then reload Pi.");
		} else {
			fixes.push(...keyFileFixesOrFallback("Relay", ["WebSocket URL"]));
		}
	}
	return fixes;
}

/**
 * The startup message of a label, if there is one.
 */
function harnessMessage(label: string): { label: string; text: string; status: string } | undefined {
	return harnessMessages.find((m) => m.label === label);
}

/**
 * Report the relay configuration in the startup summary.
 *
 * Called from the top-level init (not from initTelegram) so the line also
 * shows up when Telegram itself is not configured - that is exactly the
 * fresh-install case where the user needs the instructions.
 */
function reportRelayConfiguration(): void {
	let endpoint: ReturnType<typeof resolveRelayEndpointForHarness>;
	try {
		endpoint = resolveRelayEndpointForHarness();
	} catch {
		return;
	}
	if (endpoint.url && endpoint.token) {
		// The endpoint is configured. On the first report the connection path
		// owns the line (it reports "connected"); a later report (a new
		// session) refreshes a stale warning line.
		const existing = harnessMessage("Relay");
		if (existing && (existing.status === "warn" || existing.status === "ok")) {
			if (relayStreamConnected) {
				addHarnessMessage("Relay", "connected; live callbacks enabled", "ok");
			} else {
				addHarnessMessage("Relay", "endpoint configured; live stream not connected", "warn", [
					"Check the relay server and the network, then reload Pi.",
				]);
			}
		}
		return;
	}
	// The relay is optional: a user who never set it up (and whose Telegram
	// channel does not work either) must not see a permanent warning with
	// fix commands. The Telegram line carries the instructions in that case.
	if (!relayShouldBeReported({
		hasRelayKeyFile: hasAnyRelayKeyFile(),
		telegramConfigured: telegramIsConfigured(),
	})) {
		return;
	}
	// `missing` names the real cause - e.g. "rejected source: env RELAY_WS_URL
	// (not a ws:// or wss:// URL)" - so the user does not create a key file
	// for a problem that lives in the environment. It never holds a secret.
	// The "not resolved (looked at ...)" entries are left out - the fix
	// commands below already name the sources.
	const reasons = Array.isArray(endpoint.missing)
		? endpoint.missing.filter((reason) => reason.startsWith("rejected source:"))
		: [];
	const report = relayEndpointReport({
		missingUrl: !endpoint.url,
		missingToken: !endpoint.token,
		reasons,
		fixes: relayEndpointFixes(endpoint),
	});
	addHarnessMessage(report.label, report.text, report.status, report.details);
}

/**
 * Put a startup line directly after another one.
 *
 * The notification channels belong together: the Telegram line and the LINE
 * line must not be separated by a line that another feature added in
 * between.
 */
function addHarnessMessageAfter(
	anchorLabel: string,
	label: string,
	text: string,
	status: HarnessStatus = "wait",
	details?: string[],
): void {
	startupStatus.updateAfter(anchorLabel, label, text, status, details);
}

/**
 * Remember an explicit channel decision.
 *
 * The notification center keeps the state in memory (and in its own
 * database). The startup summary needs the decision BEFORE any channel is
 * initialized, and it must survive a restart - so it is written to the
 * notification settings.
 */
function persistChannelDecision(channel: string, enabled: boolean): void {
	if (!setChannelDisabled(channel, !enabled)) {
		logToFile("[NotifySettings]", `Could not persist the ${channel} decision`);
	}
}

/**
 * Did the user explicitly turn the LINE channel off?
 *
 * Only an explicit decision counts. A missing key file means the channel
 * was never configured - that is a different state with a different
 * meaning, and it must not be shown as "disabled".
 */
function lineIsExplicitlyDisabled(): boolean {
	return isChannelDisabled("line");
}

/**
 * Report the LINE configuration in the startup summary.
 *
 * Like the relay line this is reported from the top-level init (not from
 * initTelegram) so the line also shows up when Telegram itself is not
 * configured - that is exactly the fresh-install case where the user needs
 * the instructions. The "configured" line stays with initTelegram, which owns
 * the channel.
 *
 * The line is always reported: a fresh install must show that LINE is one
 * of the two notification channels, together with the steps that make it
 * work.
 */
function reportLineConfiguration(): void {
	const report = lineConfigurationReport({
		audit: getKeyFileAudit(),
		// An explicit opt-out is the only thing that makes the channel
		// "disabled".
		disabled: lineIsExplicitlyDisabled(),
		channelState: lineChannelState,
		telegramConfigured: telegramIsConfigured(),
		// Both credentials are named: a LINE channel needs the access token
		// AND the user id. The fallback makes sure that a warning always
		// carries a command, even when the audit could not answer.
		fixes: keyFileFixesOrFallback("LINE", ["channel access token", "user id"]),
		// The startup check validates the access token - the user id is only
		// the recipient, so it must not be named as the cause.
		accessTokenFixes: keyFileFixesOrFallback("LINE", ["channel access token"]),
		// The reason the channel did not start (invalid token, LINE down, ...).
		channelDiagnostic: lineChannelDiagnostic,
		// Without Telegram the LINE channel cannot start - the user needs
		// the Telegram commands, not only an explanation.
		telegramFixes: keyFileFixesOrFallback("Telegram", ["bot token", "chat id"]),
	});
	if (!report) return;
	addHarnessMessageAfter("Telegram", report.label, report.text, report.status, report.details);
}

/**
 * Is Telegram configured and working?
 *
 * The LINE channel starts together with the Telegram channel - the startup
 * summary names the real cause when the LINE channel did not start. The
 * answer comes from the runtime (the channel really initialized), not from
 * the presence of the key files: a token the API rejects is not a working
 * Telegram.
 */
function telegramIsConfigured(): boolean {
	return telegramChannelState === "started";
}

/**
 * Does the key directory hold a relay credential (or the webhook url the
 * relay url is derived from)?
 *
 * The relay is an optional feature: a user who never set it up must not see
 * a permanent warning with fix commands. The line appears as soon as one of
 * the relay key files exists or as soon as the Telegram channel works (the
 * relay serves the Telegram callbacks).
 */
function hasAnyRelayKeyFile(): boolean {
	try {
		return readdirSync(harnessKeysDir()).some(
			(entry) =>
				entry === "relay-ws-url.txt" ||
				entry === "relay-auth-token.txt" ||
				entry === "telegram-webhook-url.txt",
		);
	} catch {
		return false;
	}
}

/**
 * Initialize relay streaming for real-time callback delivery.
 * Connects to the relay WebSocket server and forwards Telegram callbacks
 * to the adapter for proper greeting verification and handling.
 */
async function initRelayStream(): Promise<void> {
	const endpoint = resolveRelayEndpointForHarness();

	if (!endpoint.url || !endpoint.token) {
		logToFile(
			"[RelayStream]",
			`Relay endpoint not configured - skipping streaming (${endpoint.missing.join("; ")})`,
		);
		// The startup summary already carries the fix commands (see
		// reportRelayConfiguration) - do not repeat the message here.
		return;
	}

	logToFile(
		"[RelayStream]",
		`Connecting to relay at ${endpoint.url} (${describeRelayEndpoint(endpoint)})`,
	);

	_relayClient = new RelayClient(
		{
			serverUrl: endpoint.url,
			token: endpoint.token,
			// Keep retrying in the background: the relay server may not be up
			// yet when the harness starts.
			retryOnConnectFailure: true,
		},
		{
			onConnected: (sessionId) => {
				logToFile("[RelayStream]", `Connected to relay, session: ${sessionId}`);
				relayStreamConnected = true;
				addHarnessMessage("Relay", "connected; live callbacks enabled", "ok");
			},
			onDisconnected: () => {
				logToFile("[RelayStream]", "Disconnected from relay");
				// A dropped connection must not leave a green "connected"
				// claim in the summary.
				relayStreamConnected = false;
				addHarnessMessage("Relay", "live stream disconnected; reconnecting", "warn", [
					"Check the relay server and the network, then reload Pi.",
				]);
			},
			onSnapshot: (snapshot) => {
				logToFile("[RelayStream]", `Snapshot: ${snapshot.recentCallbacks.length} recent callbacks`);
			},
			onSynchronized: () => {
				logToFile("[RelayStream]", "Synchronized - receiving live events");
			},
			onCallback: async (callback: CallbackPayload) => {
				logToFile(
					"[RelayStream]",
					callback.type === "telegram_message"
						? `Message from ${callback.username || callback.userId} (${(callback.text || "").length} chars)`
						: `Callback: ${callback.action} ${callback.targetId}`,
				);

				// A LINE postback is the same decision as a Telegram button
				// click: one resolver, the same canonical request ID.
				if (callback.type === "line_callback") {
					if (
						callback.action === "biome" ||
						callback.action.startsWith("biome_")
					) {
						// The tooling proposal is a decision of its own: it never
						// resolves a pending question and it never pauses the
						// work. The postback data may arrive split or as one
						// string - both carry the choice and the request ID.
						const raw = callback.action.startsWith("biome_")
							? callback.action.slice("biome_".length)
							: callback.targetId;
						await resolveToolingPreference(raw, "line", _extensionApi);
					} else {
						applyChannelApproval(callback.action, callback.targetId, "line");
					}
				}

				// Forward Telegram callbacks to the adapter
				if (callback.type === "telegram_callback" && _relayTelegramAdapter) {
					// The mapping is a pure function (harness/telegram-update.ts) so
					// that it can be tested without the harness.
					const update = buildTelegramCallbackUpdate({
						id: callback.id,
						action: callback.action,
						targetId: callback.targetId,
						callbackQueryId: callback.callbackQueryId,
						userId: callback.userId,
						username: callback.username,
						messageId: callback.messageId,
						chatId: callback.chatId,
						isBot: callback.isBot,
					});
					if (update) {
						try {
							await _relayTelegramAdapter.handleWebhookUpdate(update);
							logToFile("[RelayStream]", "Callback processed by Telegram adapter");
						} catch (err) {
							logToFile("[RelayStream]", `Adapter error: ${oneLineError(err)}`);
						}
					}
				}

				// Forward a Telegram TEXT message (the user typed it) to the adapter
				if (callback.type === "telegram_message" && _relayTelegramAdapter) {
					// The mapping is a pure function (harness/telegram-update.ts) so
					// that it can be tested without the harness.
					const update = buildTelegramMessageUpdate({
						userId: callback.userId,
						username: callback.username,
						messageId: callback.messageId,
						chatId: callback.chatId,
						text: callback.text,
						isBot: callback.isBot,
					});
					if (update) {
						try {
							await _relayTelegramAdapter.handleWebhookUpdate(update);
							logToFile("[RelayStream]", "Message processed by Telegram adapter");
						} catch (err) {
							logToFile("[RelayStream]", `Adapter error: ${oneLineError(err)}`);
						}
					}
				}
			},
			onError: (error) => {
				logToFile("[RelayStream]", `Error: ${oneLineError(error)}`);
				// The client keeps retrying in the background, so the stream
				// may still come up - but the user must see that the live
				// callbacks are not running yet.
				if (!relayStreamConnected) {
					addHarnessMessage("Relay", "endpoint configured; live stream not connected", "warn", [
						`Error: ${oneLineError(error)}`,
						"Check the relay server and the network, then reload Pi.",
					]);
				}
			},
		},
		{
			// A TUI owns the terminal: the relay diagnostics belong in the log
			// file. A console write would land in the prompt input field
			// ("[RelayClient] Connected ...").
			log: (message) => logToFile("[RelayStream]", `log: ${message}`),
			warn: (message) => logToFile("[RelayStream]", `warn: ${message}`),
			error: (message) => logToFile("[RelayStream]", `error: ${message}`),
		}
	);

	try {
		await _relayClient.connect();
		logToFile("[RelayStream]", "Relay stream initialized successfully");
	} catch (err) {
		logToFile("[RelayStream]", `Failed to connect: ${err}`);
	}
}

/**
 * Console guard - the TUI owns the terminal.
 *
 * A library that writes to the console puts its text into the prompt input
 * field ("[RelayClient] Connected ..."). In TUI mode every console call goes
 * to the harness log instead. An error is also surfaced as a harness message,
 * so a crash is never invisible.
 */
function initConsoleGuard(pi: ExtensionAPI): void {
	let restore: (() => void) | null = null;
	// A reload emits session_start BEFORE the previous session_shutdown:
	// the guard must stay installed for the new session. The console is only
	// given back when every started session has been shut down.
	let starts = 0;
	let shutdowns = 0;
	const recentErrors = new Map<string, number>();

	pi.on("session_start", (_event, ctx) => {
		starts++;
		if (ctx.mode !== "tui" || restore) return;
		restore = installConsoleGuard({
			sink: (level, message) => {
				logToFile("[Console]", `${level}: ${message}`);
				if (level !== "error") return;
				// One message per 30s: a crash must be visible, a loop must not flood.
				const now = Date.now();
				if (now - (recentErrors.get(message) ?? 0) < 30_000) return;
				recentErrors.set(message, now);
				const text = message.length > 200 ? `${message.slice(0, 200)}...` : message;
				addHarnessMessage("Console", text, "err");
			},
		});
		logToFile("[Console]", "Console redirected to the log file (TUI mode)");
	});

	pi.on("session_shutdown", () => {
		shutdowns++;
		// Only the last session may take the console back.
		if (!restore || shutdowns < starts) return;
		restore();
		restore = null;
	});
}

/**
 * The fallback connector for the MCP servers that extensions register.
 *
 * Pi expects the extension that handles `mcp_servers_change` to be the one
 * that connects the registered servers. The built-in MCP extension of Pi
 * does that job while it is active; this connector takes over only the
 * servers that nobody else connected, and the tools of the session are the
 * evidence of who did what.
 *
 * The connector works in the background: the session does not wait for it,
 * because a server that nobody connected is a rare case and the tools of a
 * server that is still connecting arrive late anyway.
 */
function initMcpConnector(pi: ExtensionAPI): void {
	// The typings of the installed runtime may be older than the event
	// itself, so the registration uses the structural type of the API.
	const registrar = pi as unknown as {
		on: (
			event: string,
			handler: (...args: unknown[]) => void | Promise<void>,
		) => void;
	};
	const connector = createMcpConnector(pi as unknown as McpConnectorApi, {
		loadLibrary: async (): Promise<McpClientLibrary> => {
			const mod = await import("@earendil-works/pi-mcp");
			// SAFETY: the package exports the client and the two transports
			// with these names; the interface describes how the connector
			// uses them.
			return mod as unknown as McpClientLibrary;
		},
		log: (message: string): void => {
			logStartup(`[pi-harness] ${message}`);
		},
	});
	mcpConnector = connector;

	// The registration of a server while the extensions load is read with
	// getMcpServers() on session_start; a later registration fires the
	// change event. Both paths lead to the same place.
	pi.on("session_start", () => {
		void connector.connectPending().catch((error: unknown) => {
			logStartup(
				`[pi-harness] the MCP fallback connector failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	});

	registrar.on("mcp_servers_change", () => {
		void connector.connectPending().catch((error: unknown) => {
			logStartup(
				`[pi-harness] the MCP fallback connector failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	});

	pi.on("session_shutdown", () => {
		// The session is over. The connector stops: nothing that is still
		// pending may touch the runtime, because the runtime refuses those
		// calls and the refusal would be read as a broken server.
		void connector.stop().catch(() => {
			// A broken connection needs no closing.
		});
	});
}

// --- honcho-memory: Honcho MCP for peer/user memory via https://mcp.honcho.dev ------
// Registers the Honcho MCP server with Pi's NATIVE MCP support and implements
// the automatic memory lifecycle:
// - Ingest sanitized messages on completed turns
// - Retrieve relevant context before agent execution
// - Deduplication by message ID
// - Bounded context injection with provenance

/**
 * The contract of the Honcho integration module.
 *
 * The module is loaded at runtime, so the shape of its exports is declared
 * here: this is the only part TypeScript cannot check for us.
 */
interface HonchoModule {
	initHoncho: (options: {
		apiKey?: string;
		pi?: HonchoMcpRegistrar;
		/** Whether the session is over. The probe of the credential stops with it. */
		isSessionEnded?: () => boolean;
	}) => Promise<HonchoInitResult>;
	registerHonchoLifecycle: (pi: unknown) => void;
	/** The credential: the environment wins over the key file. */
	loadHonchoApiKey: () => string | undefined;
	/** Removes the credential from a text. */
	redactHonchoKey: (text: string, apiKey: string) => string;
	/**
	 * The state of the MCP server in the session.
	 *
	 * The state is read from the tools of the session, not from the
	 * registration: a registration that Pi accepted says that Pi knows the
	 * server, and nothing about a connection.
	 */
	honchoMcpState: (
		pi: HonchoMcpRegistrar | undefined | null,
		registered: boolean,
	) => HonchoMcpState;
	/** The report of the state, for the startup. */
	honchoMcpReport: (state: HonchoMcpState, reason?: string) => HonchoMcpReport;
}

/**
 * How long the startup waits for the tools of the Honcho server.
 *
 * A connector connects the registered servers asynchronously, so the tools
 * are not there when the registration returns. The wait is bounded: a
 * connector that never connects must not hold the session, and the report
 * says what it knows when the wait is over.
 */
const HONCHO_MCP_WAIT_MS = 15_000;

/** The interval between two checks of the tools of the session. */
const HONCHO_MCP_WAIT_INTERVAL_MS = 500;

/**
 * The interval between two checks after the deadline of the wait.
 *
 * The report of the deadline is true at the deadline, but a connector that
 * is slow is not a connector that failed. The watcher keeps looking with a
 * slower rhythm and corrects the row when the tools finally appear.
 */
const HONCHO_MCP_LATE_INTERVAL_MS = 5_000;
/**
 * The connector of the session.
 *
 * The startup report of Honcho names the reason a connection failed, so the
 * report can tell the user what went wrong.
 */
let mcpConnector: McpConnector | null = null;

/**
 * The name of the Honcho MCP server in Pi.
 *
 * The integration keeps the name in its own module, which is loaded lazily:
 * a value import here would load the whole integration at the startup.
 */
const HONCHO_MCP_SERVER_NAME = "honcho";

/**
 * Whether the session is over.
 *
 * The work of a session stops with it. A work that is cut off by the end of
 * the session says nothing about the thing it was about: a closed
 * connection is not a refusal of a server that was never asked.
 */
let sessionEnded = false;

/**
 * The stop of the watcher of the Honcho tools.
 *
 * The watcher corrects the report of the startup while the session lives.
 * When the session ends, the watcher stops: a report that is corrected
 * after the end belongs to no session.
 */
let stopHonchoMcpWatcher: (() => void) | null = null;

/**
 * Correct the report when the tools of the Honcho server appear.
 *
 * The connector of Pi connects the registered servers in the background, so
 * the report of the startup is written before the connection happens. The
 * wait is bounded and the report is only corrected when the tools are
 * really there.
 *
 * The watcher stops when the session ends. A watcher that outlives the
 * session reads the tools of a session that is gone, and the runtime
 * refuses that read: the report would be corrected by a failure that
 * belongs to no session.
 *
 * @param pi The extension API
 * @param honcho The Honcho module
 * @returns The stop of the watcher
 */
function watchHonchoMcpTools(pi: ExtensionAPI, honcho: HonchoModule): () => void {
	const registrar = pi as unknown as HonchoMcpRegistrar;
	return watchHonchoMcpToolsModule({
		readState: () => honcho.honchoMcpState(registrar, true),
		readFailureReason: () => {
			const status = mcpConnector?.statuses.get(HONCHO_MCP_SERVER_NAME);
			return status?.state === "failed" ? status.reason : undefined;
		},
		report: (state, reason) => honcho.honchoMcpReport(state, reason),
		log: logStartup,
		setRow: (label, text, status, details) =>
			addHarnessMessage(label, text, status, details),
		now: () => Date.now(),
		setTimeout: (callback, ms) => {
			const handle = setTimeout(callback, ms);
			// The watcher must not hold the process of the session.
			if (typeof handle.unref === "function") handle.unref();
			return handle;
		},
		clearTimeout: (handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>),
		waitMs: HONCHO_MCP_WAIT_MS,
		intervalMs: HONCHO_MCP_WAIT_INTERVAL_MS,
		lateIntervalMs: HONCHO_MCP_LATE_INTERVAL_MS,
	});
}

async function initHoncho(pi: ExtensionAPI): Promise<void> {
	addHarnessMessage("Honcho", "initializing", "wait");
	let apiKey = "";
	let honcho: HonchoModule | null = null;
	try {
	// Import the Honcho integration module.
	honcho = (await import("./harness/honcho-init.js")) as unknown as HonchoModule;

	// The credential comes from the loader of the module: the environment
	// variable wins over the key file, and the file is the per-user default.
	apiKey = honcho.loadHonchoApiKey() ?? "";
	if (!apiKey) {
		// A key file that exists but is empty is a different advice than a
		// missing file.
		const { readFileSync, existsSync } = await import("node:fs");
		const home = process.env.HOME || process.env.USERPROFILE || homedir();
		const keyPath = `${home}/.pi-harness-runtime/keys/honcho-api-key.txt`;
		const emptyFile = existsSync(keyPath) && readFileSync(keyPath, "utf8").trim() === "";

		if (emptyFile) {
			logStartup("[pi-harness] Honcho: API key is empty — skipping");
			addHarnessMessage("Honcho", "API key empty", "warn", [
				...keyFileFixesOrFallback("Honcho", ["API key"]),
				"Then reload Pi.",
			]);
			return;
		}

		logStartup("[pi-harness] Honcho not configured:");
		logStartup("[pi-harness]   Get key: https://app.honcho.dev/api-keys");
		logStartup(`[pi-harness]   Then: echo "{api-key}" > ~/.pi-harness-runtime/keys/honcho-api-key.txt`);
		addHarnessMessage("Honcho", "API key missing", "warn", [
			...keyFileFixesOrFallback("Honcho", ["API key"]),
			"Get a key: https://app.honcho.dev/api-keys",
			"Then reload Pi.",
		]);
		return;
	}

		// Register lifecycle hooks using the new integration
		// SAFETY: pi.on accepts these event names at runtime
		honcho.registerHonchoLifecycle(pi as unknown as { on: (event: string, handler: (...args: unknown[]) => void | Promise<void>) => void });

		// Initialize Honcho with the API key. The integration uses Pi's own MCP
		// client, so no event adapter is passed any more. It also registers
		// the MCP server with the extension API of Pi, so the model and
		// `/mcp` see it - and a refused registration is not fatal: the
		// harness talks to the server through its own MCP client, so only
		// the native tools are missing and the rest of the startup continues.
		// SAFETY: the runtime that runs this extension exposes
		// registerMcpServer (verified with Pi 1.4.0); the local type
		// definitions are older, so the call is cast.
		const result = await honcho.initHoncho({
			apiKey,
			pi: pi as unknown as HonchoMcpRegistrar,
			// The probe of the credential runs while the session lives. A
			// session that ends cuts the probe off, and a cut-off probe says
			// nothing about the server.
			isSessionEnded: () => sessionEnded,
		});

		if (!result || !result.status) {
			logStartup("[pi-harness] Honcho: initialization produced no status");
			addHarnessMessage("Honcho", "init failed", "err", [
				"Check /tmp/pi-harness.log for the Honcho reason.",
				"The Honcho integration returned no status.",
				"Honcho memory stays disabled for this session.",
			]);
			return;
		}

		switch (result.status) {
			case "session_ended": {
				// The session ended while the Honcho MCP was checked. The
				// server was never asked, so nothing is claimed about it.
				logStartup(
					"[pi-harness] Honcho: the session ended before the Honcho MCP was checked",
				);
				return;
			}
			case "ready": {
				logStartup("[pi-harness] Honcho integration ready");
				if (result.mcpRegistered) {
					// The registration is a declaration: the tools of the
					// server reach the model only when an MCP connector
					// connected it. The tools of the session are the
					// evidence, so the report names what is true.
					const state = honcho.honchoMcpState(
						pi as unknown as HonchoMcpRegistrar,
						true,
					);
					if (state === "connected") {
						logStartup("[pi-harness] Honcho: native MCP server connected");
						const report = honcho.honchoMcpReport(state);
						addHarnessMessage("Honcho", report.text, report.status, report.details);
					} else {
						logStartup(
							"[pi-harness] Honcho: native MCP server registered (the tools reach the model only while an MCP connector is active)",
						);
						const report = honcho.honchoMcpReport(state);
						addHarnessMessage("Honcho", report.text, report.status, report.details);
						// A connector connects the server in the background:
						// the report is corrected when the tools appear.
						// A watcher of a session that is gone is stopped
						// first: only one watcher reads the tools.
						stopHonchoMcpWatcher?.();
						stopHonchoMcpWatcher = watchHonchoMcpTools(pi, honcho);
					}
				} else {
					// The memory works, but the model has no Honcho tools: the
					// user has to know that, not only the log. The reason of
					// the registration names the cause, so the advice is not
					// always "check the Pi version".
					const cause = honcho.redactHonchoKey(
						result.mcpRegistrationReason ?? "the reason was not reported",
						apiKey,
					);
					logStartup(`[pi-harness] Honcho: native MCP server not registered (the model sees no Honcho tools): ${cause}`);
					// The advice follows the cause: a runtime without
					// registerMcpServer is a different problem than a name
					// that another extension owns.
					const capability = cause.includes("registerMcpServer")
						? "This runtime does not provide registerMcpServer: the Honcho memory works, but the model sees no Honcho tools."
						: "The Honcho memory works, but the model sees no Honcho tools.";
					const report = honcho.honchoMcpReport("not_registered", cause);
					addHarnessMessage("Honcho", report.text, report.status, [
						...report.details,
						capability,
					]);
				}
				break;
			}
			case "missing_key": {
				// The only state that may point at the key file: the credential
				// is what is missing.
				logStartup("[pi-harness] Honcho not configured:");
				logStartup("[pi-harness]   Get key: https://app.honcho.dev/api-keys");
				logStartup(`[pi-harness]   Then: echo "{api-key}" > ~/.pi-harness-runtime/keys/honcho-api-key.txt`);
				addHarnessMessage("Honcho", "API key missing", "warn", [
					...keyFileFixesOrFallback("Honcho", ["API key"]),
					"Get a key: https://app.honcho.dev/api-keys",
					"Then reload Pi.",
				]);
				break;
			}
			case "mcp_unavailable": {
				// The key was read successfully - the problem is the MCP runtime.
				const reason = honcho.redactHonchoKey(result.reason ?? "no reason given", apiKey);
				const hint = honcho.redactHonchoKey(
					result.hint ?? "The native MCP client library @earendil-works/pi-mcp is required.",
					apiKey,
				);
				logStartup(`[pi-harness] Honcho: native MCP unavailable (${reason})`);
				addHarnessMessage("Honcho", "native MCP unavailable", "err", [
					"Check /tmp/pi-harness.log for the Honcho reason.",
					reason,
					hint,
				]);
				break;
			}
			case "registration_rejected": {
				const reason = honcho.redactHonchoKey(
					result.reason ?? "the server did not accept the request",
					apiKey,
				);
				const httpStatus = typeof result.httpStatus === "number" ? ` (HTTP ${result.httpStatus})` : "";
				const hint = honcho.redactHonchoKey(
					result.hint ?? "Check the Honcho account at https://honcho.dev.",
					apiKey,
				);
				logStartup(`[pi-harness] Honcho: the server refused the request${httpStatus} (the MCP server is not registered): ${reason}`);
				addHarnessMessage("Honcho", "server refused the request", "err", [
					"Check the Honcho account and the endpoint: https://app.honcho.dev/api-keys",
					reason,
					hint,
				]);
				break;
			}
			default: {
				const reason = honcho.redactHonchoKey(String(result.status), apiKey);
				logStartup("[pi-harness] Honcho: initialization failed:", reason);
				addHarnessMessage("Honcho", "init failed", "err", [
					"Check /tmp/pi-harness.log for the Honcho reason.",
					reason,
					"Honcho memory stays disabled for this session.",
				]);
				break;
			}
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const reason =
			honcho && typeof honcho.redactHonchoKey === "function"
				? honcho.redactHonchoKey(message, apiKey)
				: message;
		logStartup("[pi-harness] Honcho: init failed:", reason);
		addHarnessMessage("Honcho", "init failed", "err", [
			"Check /tmp/pi-harness.log for the Honcho reason.",
			reason,
			"Honcho memory stays disabled for this session.",
		]);
	}
	// The session is over: the watcher of the tools stops. It reads the
	// tools of the session, and the runtime refuses that read once the
	// session is gone.
	pi.on("session_shutdown", () => {
		stopHonchoMcpWatcher?.();
		stopHonchoMcpWatcher = null;
	});
}

// --- langchain-loop: Ping-pong write-review loop via harness/langchain/ -----------
// User picks model-role mapping once via /langchain-config.
// Stores selection in ~/.pi-harness-runtime/keys/langchain-role.json.
// /langchain reads from that file and spawns the loop.
function initLangChain(pi: {
	registerCommand(
		name: string,
		cmd: {
			description: string;
			handler: (args: string, ctx: unknown) => Promise<void>;
			prompt?: string;
		},
	): void;
}): void {
	const { readFileSync, writeFileSync, existsSync } = require("node:fs");
	const { spawn } = require("node:child_process");
	const { fileURLToPath } = require("url");
	const { dirname } = require("node:path");
	const readline = require("node:readline");

	const home = process.env.HOME || process.env.USERPROFILE || homedir();
	const keysDir = `${home}/.pi-harness-runtime/keys`;
	const modelsStorePath = `${home}/.pi/agent/models-store.json`;
	const roleConfigPath = `${keysDir}/langchain-role.json`;

	// ---------------------------------------------------------------------------
	// Load models from models-store.json
	// ---------------------------------------------------------------------------
	interface ModelEntry { id: string; baseUrl: string }
	interface RoleConfig { planner?: string; coder?: string; reviewer?: string }

	let store: Record<string, { models: Array<{ id: string; baseUrl?: string }> }> = {};
	try {
		if (existsSync(modelsStorePath)) {
			store = JSON.parse(readFileSync(modelsStorePath, "utf8"));
		}
	} catch { /* ignore */ }

	// Flat list of all models: "provider/model-id"
	function listAllModels(): Array<{ index: number; provider: string; id: string; baseUrl: string }> {
		const entries: Array<{ index: number; provider: string; id: string; baseUrl: string }> = [];
		let idx = 1;
		for (const [provider, info] of Object.entries(store)) {
			for (const model of info.models ?? []) {
				entries.push({ index: idx++, provider, id: model.id, baseUrl: model.baseUrl ?? "" });
			}
		}
		return entries;
	}

	function resolveModel(spec: string): ModelEntry | null {
		// spec format: "provider/model-id"
		const parts = spec.split("/");
		if (parts.length !== 2) return null;
		const [provider, id] = parts;
		const found = store[provider]?.models?.find((m) => m.id === id);
		if (found) return { id: found.id, baseUrl: found.baseUrl ?? "" };
		return null;
	}

	// ---------------------------------------------------------------------------
	// Load saved role config
	// ---------------------------------------------------------------------------
	function loadRoleConfig(): RoleConfig {
		try {
			if (existsSync(roleConfigPath)) {
				return JSON.parse(readFileSync(roleConfigPath, "utf8"));
			}
		} catch { /* ignore */ }
		return {};
	}

	// ---------------------------------------------------------------------------
	// /langchain-config: interactive model -> role picker
	// ---------------------------------------------------------------------------
	pi.registerCommand("langchain-config", {
		description: "Pick which model is planner / coder / reviewer for the LangChain loop",
		prompt: "Interactive: assign models to planner, coder, reviewer roles",
		handler: async (_args: string, _ctx: unknown) => {
			const allModels = listAllModels();
			if (allModels.length === 0) {
				logToFile("[pi-harness]", "/langchain-config: no models found in ~/.pi/agent/models-store.json");
				logToFile("[pi-harness]", "  Configure models first via /model in pi");
				return;
			}

			// Print available models
			logToFile("[pi-harness]", "Available models:");
			for (const m of allModels) {
				logToFile("[pi-harness]", `  [${m.index}] ${m.provider}/${m.id}`);
			}

			const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
			const question = (q: string): Promise<string> =>
				new Promise((res) => rl.question(`? ${q}: `, (a: string) => res(a.trim())));

			let plannerSpec = "";
			let coderSpec = "";
			let reviewerSpec = "";

			try {
				const plannerIdx = parseInt(await question("Planner model index"), 10);
				const plannerEntry = allModels.find((m) => m.index === plannerIdx);
				if (plannerEntry) plannerSpec = `${plannerEntry.provider}/${plannerEntry.id}`;

				const coderIdx = parseInt(await question("Coder model index"), 10);
				const coderEntry = allModels.find((m) => m.index === coderIdx);
				if (coderEntry) coderSpec = `${coderEntry.provider}/${coderEntry.id}`;

				const reviewerIdx = parseInt(await question("Reviewer model index"), 10);
				const reviewerEntry = allModels.find((m) => m.index === reviewerIdx);
				if (reviewerEntry) reviewerSpec = `${reviewerEntry.provider}/${reviewerEntry.id}`;
			} finally {
				rl.close();
			}

			if (!plannerSpec || !coderSpec || !reviewerSpec) {
				logToFile("[pi-harness]", "/langchain-config: all three roles must be selected");
				return;
			}

			// Save to langchain-role.json
			const config: RoleConfig = {
				planner: plannerSpec,
				coder: coderSpec,
				reviewer: reviewerSpec,
			};
			writeFileSync(roleConfigPath, JSON.stringify(config, null, 2), "utf8");

			logToFile("[pi-harness]", "LangChain role config saved:");
			logToFile("[pi-harness]", `  planner:   ${plannerSpec}`);
			logToFile("[pi-harness]", `  coder:     ${coderSpec}`);
			logToFile("[pi-harness]", `  reviewer:  ${reviewerSpec}`);

			// Also prompt for API keys if missing
			if (!existsSync(`${keysDir}/planner-api-key.txt`)) {
				logToFile("[pi-harness]", `  planner-api-key.txt missing. echo "{key}" > ${keysDir}/planner-api-key.txt`);
			}
			if (!existsSync(`${keysDir}/reviewer-api-key.txt`)) {
				logToFile("[pi-harness]", `  reviewer-api-key.txt missing. echo "{key}" > ${keysDir}/reviewer-api-key.txt`);
			}
			if (!existsSync(`${keysDir}/coder-api-key.txt`)) {
				logToFile("[pi-harness]", `  coder-api-key.txt missing. echo "{key}" > ${keysDir}/coder-api-key.txt`);
			}
		},
	});

	// ---------------------------------------------------------------------------
	// /langchain: spawn the ping-pong loop
	// ---------------------------------------------------------------------------

	function loadActiveConfig(): { planner: ModelEntry; coder: ModelEntry; reviewer: ModelEntry } | null {
		const cfg = loadRoleConfig();
		if (!cfg.planner || !cfg.coder || !cfg.reviewer) return null;
		const planner = resolveModel(cfg.planner);
		const coder = resolveModel(cfg.coder);
		const reviewer = resolveModel(cfg.reviewer);
		if (!planner || !coder || !reviewer) return null;
		return { planner, coder, reviewer };
	}

	const activeConfig = loadActiveConfig();

	// Check API keys exist
	const plannerKeyExists = existsSync(`${keysDir}/planner-api-key.txt`);
	const reviewerKeyExists = existsSync(`${keysDir}/reviewer-api-key.txt`);
	const coderKeyExists = existsSync(`${keysDir}/coder-api-key.txt`);

	if (!activeConfig) {
		logToFile("[pi-harness]", "/langchain not configured — run /langchain-config");
	} else if (!plannerKeyExists || !reviewerKeyExists || !coderKeyExists) {
		const missingKeys: string[] = [];
		if (!plannerKeyExists) missingKeys.push("planner-api-key.txt");
		if (!reviewerKeyExists) missingKeys.push("reviewer-api-key.txt");
		if (!coderKeyExists) missingKeys.push("coder-api-key.txt");
		logToFile("[pi-harness]", `/langchain missing API keys: ${missingKeys.join(", ")}`);
	} else {
		logStartup(`[pi-harness] /langchain ready (${activeConfig.planner.id} + ${activeConfig.coder.id} + ${activeConfig.reviewer.id})`);
	}

	pi.registerCommand("langchain", {
		description: "Run LangChain ping-pong loop: planner → coder → reviewer → fix → approve",
		prompt: "Describe the feature or task for the LangChain loop to implement.",
		handler: async (request: string) => {
			if (!request.trim()) {
				logToFile("[pi-harness]", "/langchain requires a request.");
				logToFile("[pi-harness]", "  Example: /langchain implement user auth module");
				return;
			}

			const cfg = loadActiveConfig();
			if (!cfg) {
				logToFile("[pi-harness]", "/langchain: not configured. Run /langchain-config first.");
				return;
			}

			const env: Record<string, string> = { ...(process.env as Record<string, string>) };
			env.PLANNER_API_KEY = readFileSync(`${keysDir}/planner-api-key.txt`, "utf8").trim();
			env.GLM_API_KEY = readFileSync(`${keysDir}/reviewer-api-key.txt`, "utf8").trim();
			env.MINIMAX_API_KEY = readFileSync(`${keysDir}/coder-api-key.txt`, "utf8").trim();
			env.PLANNER_MODEL = cfg.planner.id;
			env.PLANNER_BASE_URL = cfg.planner.baseUrl;
			env.GLM_MODEL = cfg.reviewer.id;
			env.GLM_BASE_URL = cfg.reviewer.baseUrl;
			env.MINIMAX_MODEL = cfg.coder.id;
			env.MINIMAX_BASE_URL = cfg.coder.baseUrl;

			if (existsSync(`${keysDir}/langsmith-api-key.txt`)) {
				env.LANGSMITH_API_KEY = readFileSync(`${keysDir}/langsmith-api-key.txt`, "utf8").trim();
			}

			const runtimeRoot = dirname(fileURLToPath(import.meta.url));
			const runScript = `${runtimeRoot}/harness/langchain/run.ts`;

			const proc = spawn("bun", ["run", runScript, "--mode", "graph", "--request", request], {
				env,
				stdio: "inherit",
			});
			proc.on("exit", (code: number | null) => {
				if (code !== 0) logToFile("[pi-harness]", `/langchain exited with code ${code}`);
			});
		},
	});
}

// --- skills-sync-hint: Suggest syncing skills if skills dir is empty --------
// Fires after Jev + Qdrant so all three appear together in startup
//
// The hint lives in the skills package: the source of the skills is
// installation data, and the package that owns the skills owns the
// message about them.
async function initSkillsSyncHint(): Promise<void> {
	try {
		const mod = await import("./packages/skills/dist/index.js");
		const hint = mod.skillsSyncHint();
		if (hint) logToFile("[pi-harness]", hint);
	} catch {
		// The skills package is optional — ignore errors
	}
}

// --- write-review: Two-agent write with review loop --------------------------
// Lazy import - only loads when packages/write-review exists
async function initWriteReview(pi: ExtensionAPI): Promise<void> {
	try {
		const mod = await import("./packages/write-review/dist/index.js");
		mod.injectWriterInstructions(pi);
	} catch {
		// write-review not available
	}
}

// --- file-copy-helper: Inject cp rule when mimicking files --------------------
// Lazy import - only loads when packages/file-copy-helper exists
async function initFileCopyHelper(_pi: ExtensionAPI): Promise<void> {
	// DISABLED: File copy helper appends large suffix to every prompt
	// but agent doesn't read it properly. Re-enable when fixed.
	// try {
	// 	const mod = await import("./packages/file-copy-helper/dist/extension.js");
	// 	mod.registerFileCopyHelper(_pi);
	// } catch {
		// file-copy-helper not available
	// }
}

// --- agent-policy: Mandatory rule delivery and mutation gating ------------------
// Lazy import - only loads when packages/agent-policy exists
// This replaces firstAgentStart-only injection with:
// - System prompt injection on EVERY agent start (not just first)
// - Policy receipt tracking per session
// - Mutation gating until policy revision is confirmed received
// - harness_rules tool for rule retrieval and acknowledgement
async function initAgentPolicy(pi: ExtensionAPI): Promise<void> {
	try {
		const { registerAgentPolicy } = await import("./packages/agent-policy/dist/extension.js");
		const { resetPolicyStore } = await import("./packages/agent-policy/dist/policy-store.js");
		resetPolicyStore(); // Auto-reset so new sessions don't need re-acknowledgment
		registerAgentPolicy(pi, {
			harnessRulesPath: new URL("./AGENTS.md", import.meta.url),
			requireReceiptBeforeMutation: false, // Git guard handles git operations; build/dev commands allowed
			lspMode: "pi-lens",
		});
		logStartup("[pi-harness] Agent policy initialized");

		// Notify via Telegram that policy is ready
		pi.on("session_start", () => {
			logStartup("[pi-harness] Policy ready - all operations allowed");

			// Send Telegram notification
			void nc("policy_acknowledged", {
				title: "Harness Policy",
				message: "Policy auto-acknowledged. All operations allowed.",
			});
		});
	} catch (err) {
		logStartup(`[pi-harness] Agent policy init failed: ${err}`);
	}
}

// --- memory: Inject MEMORY.md and USER.md into system prompt ---
// Loads curated notes at session start for Hermes-style memory
async function initMemory(pi: ExtensionAPI): Promise<void> {
	try {
		const { getGlobalMemoryStore } = await import("./packages/trajectory/dist/src/memory-store.js");
		const memoryStore = getGlobalMemoryStore();

		logToFile("[memory]", "Memory store initialized");

		// Track initialization for truthful status
		let memoryLoaded = false;
		let memoryTokenCount = 0;
		let lastUserMessage = "";

		// Helper to get ready Honcho memory instance
		const getHonchoReady = async () => {
			try {
				const { getHonchoMemory, isHonchoInitialized } = await import("./harness/honcho-init.js");
			if (!isHonchoInitialized()) return null;
			const mem = getHonchoMemory();
			return mem?.isReady() ? mem : null;
		} catch {
			return null;
		}
		};

		// Capture last user message for Honcho retrieval
		// Also ingest messages to Honcho for conversational memory
		pi.on("message_end", async (event) => {
			const msg = event.message as { role?: string; content?: string | Array<{type?: string; text?: string}> } | undefined;
			if (!msg?.role || !msg.content) return;

			// Store for retrieval
			if (msg.role === "user" && typeof msg.content === "string") {
				lastUserMessage = msg.content;
			}

			// Ingest to Honcho for conversational memory (user messages only - assistant handled by registerHonchoLifecycle)
			if (msg.role === "user") {
				const honchoMem = await getHonchoReady();
				if (!honchoMem) return;

				try {
					const content = typeof msg.content === "string" ? msg.content : "";
					if (content.includes("[harness:") || content.includes("Please add all tasks")) {
						return;
					}

					honchoMem.ingestMessage(
							"user",
								msg.content,
								new Date(),
								`turn-${Date.now()}`
						);
				} catch (err) {
					logToFile("[memory]", `Ingest failed:`, String(err));
				}
			}
		});

		// Inject memory on first agent start
		let firstAgentStart = true;
		pi.on("before_agent_start", async (event) => {
			const parts: string[] = [];

			// 1. Load local memory files
			const memorySection = memoryStore.getMemorySection();
			const userSection = memoryStore.getUserSection();

			if (memorySection) parts.push(memorySection);
			if (userSection) parts.push(userSection);

			if (parts.length > 0) {
				memoryLoaded = true;
				memoryTokenCount = Math.round(parts.join("\n").length / 4);
				logToFile("[memory]", `Local notes: ${memoryStore.getMemory().length} entries, ~${memoryTokenCount} tokens`);
			}

			// 2. Retrieve Honcho context if available and we have a query
				let honchoContext = "";
				const honchoMem = await getHonchoReady();
				if (honchoMem && lastUserMessage.trim().length > 0) {
				try {
					const result = await honchoMem.retrieveContext(lastUserMessage);
					if (result.success && !result.empty && result.context) {
						honchoContext = `\n## Relevant Context\n${result.context}\n`;
						logToFile("[memory]", `Honcho: retrieved ~${result.context.length} chars`);
					} else if (result.error) {
						logToFile("[memory]", `Honcho retrieval: ${result.error}`);
					}
				} catch (err) {
					logToFile("[memory]", `Honcho retrieval failed:`, String(err));
				}
			}

			// Combine all memory
			let allMemory = parts.join("\n") + honchoContext;

			// Add wiki instruction if feature is enabled
			const wikiInstruction = getWikiInstruction();
			if (wikiInstruction) {
				allMemory += wikiInstruction;
			}

			if (!allMemory.trim()) {
				logToFile("[memory]", "No memory to inject");
				return undefined;
			}

			// Status on first injection
			if (firstAgentStart) {
				firstAgentStart = false;
				const status: string[] = [];
				if (memoryLoaded) status.push(`local notes`);
				if (honchoContext) status.push(`honcho context`);
				logToFile("[memory]", `Injected: ${status.join(" + ")}`);
			}

			// Return augmented system prompt
			return { systemPrompt: event.systemPrompt + "\n\n" + allMemory };
		});
	} catch (err) {
		logToFile("[memory]", "Init failed:", String(err));
	}
}

// --- SSH detach interceptor: Auto-transform bare ssh ... & to detached pattern ---
// Prevents 2000+ second hangs when SSH background commands aren't detached.
// Intercepts every bash tool call before execution and rewrites risky SSH commands.
//
// Also guards foreground `ssh ... "<daemon>"` commands (pollers, servers) by
// prefixing `timeout Ns` so the local call always returns (PI_HARNESS_SSH_TIMEOUT_S).
async function initSshDetachInterceptor(pi: ExtensionAPI): Promise<void> {
	try {
		const interceptor = await import("./harness/ssh-detach-interceptor.js");
		// Register on tool_call with default priority (100)
		// NOTE: module functions are captured in closure scope — do NOT use require()
		// here; this package is ESM ("type": "module") and require is undefined.
		pi.on("tool_call", (event, _api) => {
			if (event.toolName !== "bash") return {};
			const input = event.input as { command?: string; timeout?: number };
			const command = input.command ?? "";
			if (!interceptor.isSshCommand(command)) return {};

			// 1) Detach transform: bare `ssh ... &` or `ssh "a && b &"` chains
			if (
				!interceptor.isDetachedPattern(command) &&
				(interceptor.hasBareAmpersand(command) ||
					interceptor.hasCommandChainWithAmpersand(command))
			) {
				const transformed = interceptor.transformToDetached(command);
				if (transformed !== command) {
					input.command = transformed;
					return {};
				}
			}

			// 2) Timeout guard: foreground SSH running a daemon-ish remote command
			//    (e.g. `ssh -tt host "python -m amos_worker --video | head -10"`)
			if (interceptor.isForegroundDaemonSsh(command)) {
				const seconds = interceptor.getDefaultSshTimeoutSeconds();
				input.command = interceptor.addSshTimeoutGuard(command, seconds);
				// Also cap the bash tool's own timeout as belt-and-suspenders
				if (input.timeout === undefined || input.timeout > seconds) {
					input.timeout = seconds;
				}
			}
			return {};
		});
	} catch {
		// ssh-detach-interceptor not available
	}
}

// --- loop-completions: Watch daemon loop completions → update TUI todos ---------
// When the daemon loop finishes, it writes a completion event to
// ~/.pi-harness-runtime/loop-completions/. The harness extension watches this
// dir and sends a steer message to the agent so the TUI todo count updates.
async function initLoopCompletions(pi: ExtensionAPI): Promise<void> {
	const { existsSync, mkdirSync, watch } = await import("node:fs");
	const { join: joinPath } = await import("node:path");
	const { homedir: getHomeDir } = await import("node:os");

	const COMPLETION_DIR = joinPath(
		getHomeDir(),
		".pi-harness-runtime",
		"loop-completions",
	);

	try {
		if (!existsSync(COMPLETION_DIR)) {
			mkdirSync(COMPLETION_DIR, { recursive: true });
		}
	} catch {
		return; // can't create dir — skip
	}

	// Process any pre-existing files (e.g. from a previous session)
	try {
		const { readdirSync } = await import("node:fs");
		const files = readdirSync(COMPLETION_DIR).filter((f) => f.endsWith(".json"));
		for (const file of files) {
			processCompletionFile(joinPath(COMPLETION_DIR, file), pi);
		}
	} catch {
		// ignore — best-effort
	}

	// Watch for new completion files
	try {
		const watcher = watch(
			COMPLETION_DIR,
			{ persistent: false },
			(event, filename) => {
				if (event !== "rename") return;
				if (!filename || !filename.endsWith(".json")) return;
				const filePath = joinPath(COMPLETION_DIR, filename);
				// Delay so the write finishes before we read
				setTimeout(() => processCompletionFile(filePath, pi), 500);
			},
		);
		watcher.on("error", () => {});
	} catch {
		// fs.watch not available — skip
	}
}

/**
 * Initialize Hermes-style skill system
 * - Register skill commands with pi
 * - Scan skills from ~/.pi-harness-runtime/skills/
 */
async function initHermesSkills(pi: ExtensionAPI): Promise<void> {
	addHarnessMessage("Skills", "initializing", "wait");
	try {
		// Dynamically import to avoid circular deps
		const { initSkills, sanitizationStatus, sanitizationFilePath } =
			await import("./packages/skills/dist/index.js");
		let sanitizationFileCreated = false;
		let sanitizationFileCreateError: string | undefined;
		try {
			const path = sanitizationFilePath();
			const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
			const { dirname } = await import("node:path");
			if (!existsSync(path)) {
				mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
				try {
					writeFileSync(
						path,
						`${JSON.stringify({ rules: [], nameMap: {} }, null, 2)}\n`,
						{ encoding: "utf8", flag: "wx", mode: 0o600 },
					);
					sanitizationFileCreated = true;
				} catch (error) {
					// Another Pi process may have created the file after existsSync.
					if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
				}
			}
		} catch (error) {
			sanitizationFileCreateError = error instanceof Error ? error.message : String(error);
		}

		// Scan skills from default locations
		const result = initSkills();
		const localCount = result.skills.length;
		logStartup(`[pi-harness] Scanned ${localCount} local skills`);
		// The line carries the local count AND the count of the vector
		// store: a machine without local skill files can still reach a
		// shared skill, and a single "N discovered" hides that difference.
		const local = localSkillsReport(localCount);
		addHarnessMessage("Skills", local.text, local.status, local.details);
		// The rules that keep a client name out of the shared collection
		// live in a local file. Create a private empty template on first
		// use; client-specific rules can be added locally.
		try {
			const rules = sanitizationStatus();
			if (sanitizationFileCreated && rules.configured) {
				addHarnessMessage(
					"Skill privacy",
					"created a private sanitization rules file",
					"info",
					[
						`File: ${rules.path}`,
						"The file starts with no client-specific rules. Add private rules before publishing skills that contain client names.",
					],
				);
			} else if (!rules.configured) {
				addHarnessMessage(
					"Skill privacy",
					"sanitization rules file could not be created",
					"warn",
					[
						`Create ${rules.path} with { "rules": [], "nameMap": {} } and add private client-specific rules if needed.`,
						"Check the path in PI_SKILL_SANITIZATION_FILE.",
						"PI_SKILL_SANITIZATION_FILE must name a file path, not a JSON array.",
						...(sanitizationFileCreateError ? [sanitizationFileCreateError] : []),
						...(rules.error ? [rules.error] : []),
					],
				);
			}
		} catch (err) {
			addHarnessMessage(
				"Skill privacy",
				"the sanitization rules could not be read",
				"warn",
				[
					"How to fix: check that ~/.pi-harness-runtime/skill-sanitization.json exists and holds valid JSON.",
					err instanceof Error ? err.message : String(err),
				],
			);
		}
		// The server-held skills. The service holds the authoritative
		// files, so a machine without a local copy can still use a skill.
		// It is only used when it is configured - a client without a
		// service never calls out.
		let remoteConfigured = false;
		try {
			const { isSkillSyncConfigured } = await import(
				"./harness/skill-sync.js"
			);
			remoteConfigured = isSkillSyncConfigured();
			if (remoteConfigured) {
				const { SkillServiceSource } = await import(
					"./harness/skill-remote-source.js"
				);
				result.registry.setRemoteSource(new SkillServiceSource());
			}
		} catch (err) {
			logStartup(
				`[pi-harness] Could not prepare the skill service: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		// The count of the vector store needs the cluster, so it is fetched
		// in the background - the startup must not wait for the network.
		void (async () => {
			const stats = await result.registry.getQdrantStats();
			// The service is asked for its own state, so a refused
			// service and an unreachable one stay apart.
			const remote = remoteConfigured
				? await result.registry.getRemoteStats().catch(() => ({
						state: "unavailable" as const,
						count: 0,
					}))
				: undefined;
			const report = skillsReport(localCount, stats, remote);
			addHarnessMessage("Skills", report.text, report.status, report.details);
		})().catch((err) => {
			logStartup(
				`[pi-harness] Could not read the skill vector store: ${err instanceof Error ? err.message : String(err)}`,
			);
		});

		// Register /skill commands
		try {
			const { initSkillCommands } = await import("./packages/skills/dist/skill-commands.js");
			initSkillCommands(pi);
			logStartup("[pi-harness] Registered skill commands");

			// Register harness services diagnostic commands
			try {
			const { initServiceCommands } = await import("./harness/service-commands.js");
			initServiceCommands(pi);
			logStartup("[pi-harness] Registered service diagnostic commands");

			// Register Infisical setup command
			try {
			const { registerInfisicalSetup } = await import("./harness/infisical-setup.js");
			registerInfisicalSetup(pi);
			logStartup("[pi-harness] Registered /setup-infisical command");
		} catch (err) {
			logStartup("[pi-harness] Infisical setup not available:", err instanceof Error ? err.message : String(err));
		}

		// Register E2E testing commands
		try {
			const { registerE2ECommands } = await import("./harness/e2e-commands.js");
			registerE2ECommands(pi);
			logStartup("[pi-harness] Registered /e2e commands");
		} catch (err) {
			logStartup("[pi-harness] Infisical setup not available:", err instanceof Error ? err.message : String(err));
		}
			} catch (err) {
				logStartup(`[pi-harness] Failed to register service commands:`, err instanceof Error ? err.message : String(err));
			}
		} catch (err) {
			logStartup(`[pi-harness] Failed to register skill commands:`, err instanceof Error ? err.message : String(err));
		}

	} catch (err) {
		logStartup(`[pi-harness] Failed to initialize skills:`, err instanceof Error ? err.message : String(err));
			addHarnessMessage("Skills", "initialization failed", "err", [
				"How to fix: Check skills directory exists at ~/.pi-harness-runtime/skills/",
				"Run: mkdir -p ~/.pi-harness-runtime/skills && pi restart",
			]);
	}
}

interface LoopCompletion {
	taskId: string;
	request: string;
	verdict: string;
	iterations: number;
	finishedAt: string;
}

function processCompletionFile(filePath: string, pi: ExtensionAPI): void {
	const { existsSync, readFileSync, unlinkSync } = require("node:fs");
	try {
		if (!existsSync(filePath)) return;
		const raw = readFileSync(filePath, "utf8");
		const completion = JSON.parse(raw) as LoopCompletion;

		const tag =
			completion.verdict === "approved"
				? "[ok]"
				: completion.verdict === "blocked"
					? "[blocked]"
					: "[done]";

		const message =
			`Loop completed ${tag}: ${completion.taskId}\n` +
			`  verdict: ${completion.verdict}\n` +
			`  iterations: ${completion.iterations}\n` +
			`  task: ${completion.request.slice(0, 80)}${completion.request.length > 80 ? "..." : ""}\n\n` +
			`Run \`bd close ${completion.taskId} --reason "${completion.verdict}"\` if not already closed.`;

		try {
			pi.sendUserMessage(message, { deliverAs: "steer" });
		} catch {
			// ignore — best-effort
		}
		unlinkSync(filePath);
	} catch {
		// ignore — best-effort
	}
}
// --- Debug logging (file only, no console override) ---------------
// Logs written to file only. Real console output preserved for pi's TUI.
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, appendFileSync, realpathSync, statSync, chmodSync, openSync, closeSync, renameSync } from "node:fs";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// --- Harness Runtime State --------------------------------------------
const HARNESS_ROOT_DIR = join(homedir(), ".pi-harness-runtime");

/** Startup messages collected during init — shown on session_start via ctx.ui.notify */
const startupMessages: string[] = [];
const HARNESS_LOG_FILE = "/tmp/pi-harness.log";
// The log can contain urls and session ids: owner only, no rotation while it
// is small, and a bounded size so a chatty dependency cannot fill the disk.
const HARNESS_LOG_MAX_BYTES = 5 * 1024 * 1024;
let harnessLogFileSecured = false;
let harnessLogWrites = 0;

/**
 * The reasoning of a decision, bounded and redacted for the log.
 *
 * The reasoning is the text of the model, and it can quote the question it
 * answered. The log keeps a readable excerpt without a credential.
 */
function logReasoning(reasoning: unknown, maxLength = 300): string {
	const text = redactText(String(reasoning ?? ""))
		.replace(/\s+/g, " ")
		.trim();
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}...[truncated:${text.length - maxLength}]`;
}

/** Log a harness message to file (not stderr - bypasses Pi's cursor tracking) */
function logToFile(...parts: string[]): void {
	const msg = parts.join(" ");
	// A timestamp makes the log usable for latency measurements.
	const stamp = new Date().toISOString();
	try {
		if (!harnessLogFileSecured) {
			try {
				// Create the file with the owner-only mode BEFORE the first
				// write: there must be no world-readable window.
				const fd = openSync(HARNESS_LOG_FILE, "a", 0o600);
				closeSync(fd);
				chmodSync(HARNESS_LOG_FILE, 0o600);
				// Only a successful attempt stops the retries.
				harnessLogFileSecured = true;
			} catch {
				// Ignore permission errors (e.g. a mounted /tmp) and retry
				// on the next write.
			}
		}

		// Keep the log bounded: rotate it when it grew too large.
		harnessLogWrites++;
		if (harnessLogWrites % 200 === 0) {
			try {
				if (statSync(HARNESS_LOG_FILE).size > HARNESS_LOG_MAX_BYTES) {
					renameSync(HARNESS_LOG_FILE, `${HARNESS_LOG_FILE}.1`);
					chmodSync(`${HARNESS_LOG_FILE}.1`, 0o600);
					// Secure the fresh file right away: the write that
					// follows must not land in a 0644 file.
					try {
						const fd = openSync(HARNESS_LOG_FILE, "a", 0o600);
						closeSync(fd);
						chmodSync(HARNESS_LOG_FILE, 0o600);
						harnessLogFileSecured = true;
					} catch {
						harnessLogFileSecured = false;
					}
				}
			} catch {
				// Ignore rotation errors
			}
		}

		appendFileSync(HARNESS_LOG_FILE, `[${stamp}] ${msg}\n`);
	} catch {
		// Ignore file write errors
	}

	// Mirror the line into the centralized pipeline. The sampler keeps the
	// volume bounded; the local file above stays the source of truth.
	try {
		centralInfo("harness", "log", msg);
	} catch {
		// Logging must never break the caller.
	}
}

/** Log a harness startup message to file and track for UI */
function logStartup(...parts: string[]): void {
	const msg = parts.join(" ");
	startupMessages.push(msg);
	logToFile("[pi-harness]", ...parts);
}

interface HarnessSession {
	jobId: string;
	requirement: string;
	machine: JobStateMachine;
	graph: TaskGraphManager;
	blackboard: SharedBlackboard;
	repairEngine: RepairEngine;
	createdAt: string;
}

let currentSession: HarnessSession | null = null;

/** Singleton notification center — set by initTelegram(), used by all emit helpers */
let _nc: {
	center: unknown;
	notify: (event: string, ctx: Record<string, unknown>) => Promise<unknown>;
	notifyWithApproval: (
		event: string,
		ctx: Record<string, unknown>,
		options?: { approveLabel?: string; rejectLabel?: string },
	) => Promise<unknown>;
	notifyWithButtons?: (
		event: string,
		ctx: Record<string, unknown>,
		buttons: Array<{ text: string; action: string; targetId: string; url?: string }>,
	) => Promise<unknown>;
} | null = null;

// Type for _nc.center
type NcCenter = {
	notifyWithApproval: Function;
	notify: Function;
	notifyWithButtons?: Function;
};

/**
 * Fire a Telegram notification event. Logs delivery outcomes.
 * Silently skips if Telegram is not configured.
 */
async function nc(event: string, ctx: Record<string, unknown>): Promise<void> {
	if (!_nc) return;
	try {
		const center = _nc!.center as NcCenter;

		// Import policy engine dynamically to check if approval buttons needed
		// This is a simple sync check - can be replaced with Jev-powered evaluation
		const { requiresApproval } = await import("./packages/notification/dist/notification-policy.js");

		// Capture results for logging
		let results: unknown;
		if (requiresApproval(event)) {
			results = await center.notifyWithApproval(event as never, ctx as never);
		} else {
			results = await center.notify(event as never, ctx as never);
		}

		// Log delivery outcomes to file
		if (Array.isArray(results)) {
			for (const result of results) {
				if (result && typeof result === "object" && "success" in result) {
					const r = result as { success: boolean; channel: string; error?: string };
					if (r.success) {
						logToFile("[TelegramNotification]", `${event} sent to ${r.channel}`);
					} else {
						logToFile("[TelegramNotification]", `${event} failed: ${r.error ?? "unknown"}`);
					}
				}
			}
		}
	} catch (err) {
		// Never crash runtime on notification failure - log to file
		logToFile("[TelegramNotification]", `${event} threw: ${err instanceof Error ? err.message : String(err)}`);
	}
}



/**
 * Safely extract a text view from an LLM message. Used to feed the TUI
 * quota-signal extractor. Handles string content, array-of-parts content
 * (with `text` fields), and falls back to a stringified JSON for unknown
 * shapes. Never throws.
 */
function readMessageText(message: unknown): string {
	try {
		if (!message || typeof message !== "object") return "";
		const m = message as { role?: unknown; content?: unknown };
		if (typeof m.content === "string") return m.content;
		if (Array.isArray(m.content)) {
			const parts: string[] = [];
			for (const p of m.content) {
				if (!p) continue;
				if (typeof p === "string") {
					parts.push(p);
				} else if (typeof p === "object") {
					const obj = p as { text?: unknown; content?: unknown };
					if (typeof obj.text === "string") parts.push(obj.text);
					else if (typeof obj.content === "string") parts.push(obj.content);
				}
			}
			return parts.join("\n");
		}
		// Fallback: best-effort stringification. Never include cookie-shaped
		// data; we only stringify LLM message shapes which are JSON-safe.
		return JSON.stringify(message).slice(0, 8000);
	} catch {
		return "";
	}
}

/**
 * Skill directories for Hermes-style skill system
 */
const SKILLS_DIR = join(homedir(), ".pi-harness-runtime", "skills");
const MEMORY_DIR = join(homedir(), ".pi-harness-runtime", "memory");
const TRAJECTORY_DIR = join(homedir(), ".pi-harness-runtime", "trajectory");
const PI_SKILLS_DIR = join(homedir(), ".pi", "skills");

// --- Print minimal ASCII banner (shows every startup, matching pi.dev style) -------
// --- Harness version (read once at load time) --------------------------------
const HARNESS_VERSION = (() => {
	const pkgPath = join(__dirname, "package.json");
	try {
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			return pkg.version ?? "?.?.?";
		}
	} catch { /* ignore */ }
	return "?.?.?";
})();

// Harness logo - three-row Unicode block wordmark
const HARNESS_LOGO = [
	"▄ ▄  ▄  ▄▄  ▄  ▄ ▄▄ ▄▄▄ ▄▄▄",
	"█▀█ █■█ █■▄ █▀■█ █■ ▀■▄ ▀■▄",
	"▀ ▀ ▀ ▀ ▀ ▀ ▀  ▀ ▀▀ ▀▀▀ ▀▀▀",
] as const;

// Logo colors: bright cyan, cyan, dark gray (bright black)
const HARNESS_LOGO_COLORS = [96, 36, 90] as const;

function printBanner(): void {
	logToFile(`[Harness] v${HARNESS_VERSION}`);
}

function ensureHarnessDir() {
	printBanner();
	if (!existsSync(HARNESS_ROOT_DIR)) {
		mkdirSync(HARNESS_ROOT_DIR, { recursive: true });
	}
	// Hermes-style directory structure
	for (const dir of [SKILLS_DIR, MEMORY_DIR, TRAJECTORY_DIR, COOKIE_DROP_DIR]) {
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true });
		}
	}
	// Create symlink so pi.dev discovers our skills
	ensurePiSkillsSymlink();
	logStartup(
		`[pi-harness] Initialized ~/.pi-harness-runtime/ with skills/, memory/, trajectory/, cookies/`,
	);
}

/**
 * Create symlink from ~/.pi/skills to ~/.pi-harness-runtime/skills
 * This allows pi.dev to discover our Hermes-style skills
 */
function ensurePiSkillsSymlink(): void {
	// SAFETY: Only create symlink if ~/.pi/skills doesn't exist
	if (existsSync(PI_SKILLS_DIR)) {
		return; // User has their own skills dir, don't override
	}
	
	try {
		// SAFETY: Ensure parent dir exists
		const parentDir = dirname(PI_SKILLS_DIR);
		if (!existsSync(parentDir)) {
			mkdirSync(parentDir, { recursive: true });
		}
		
		// Create symlink: ~/.pi/skills -> ~/.pi-harness-runtime/skills
		symlinkSync(SKILLS_DIR, PI_SKILLS_DIR, "junction");
		logStartup(`[pi-harness] Created skills symlink: ~/.pi/skills -> ~/.pi-harness-runtime/skills`);
	} catch {
		// Ignore errors (may fail due to permissions or existing file)
		// User can create the symlink manually if needed
	}
}

/**
 * Get skill directory path (for pi-harness/skills package)
 */
export function getSkillsDir(): string {
	return SKILLS_DIR;
}

/**
 * Get memory directory path (for trajectory/memory package)
 */
export function getMemoryDir(): string {
	return MEMORY_DIR;
}

/**
 * Get trajectory directory path (for trajectory package)
 */
export function getTrajectoryDir(): string {
	return TRAJECTORY_DIR;
}

async function getCheckpointManager(): Promise<CheckpointManager> {
	const { JsonCheckpointManager } = await import(
		"./packages/checkpoint/src/checkpoint-manager.ts"
	);
	// SAFETY: JsonCheckpointManager implements CheckpointManager via structural typing
	return new JsonCheckpointManager(
		HARNESS_ROOT_DIR,
	) as unknown as CheckpointManager;
}

function isOutputLimitResumePromptMessage(message: {
	role?: string;
	content?: unknown;
}): boolean {
	if (message.role !== "user") {
		return false;
	}
	if (typeof message.content === "string") {
		return message.content === OUTPUT_LIMIT_RESUME_PROMPT;
	}
	if (!Array.isArray(message.content)) {
		return false;
	}
	return (
		message.content
			.filter(
				(part): part is { type: "text"; text: string } =>
					part &&
					typeof part === "object" &&
					(part as { type?: unknown }).type === "text" &&
					typeof (part as { text?: unknown }).text === "string",
			)
			.map((part) => part.text)
			.join("\n") === OUTPUT_LIMIT_RESUME_PROMPT
	);
}

// --- Job Pipe Watcher: Listen for Telegram callback commands -------------
// This polls the Telegram webhook server for resume/cancel commands
//
// ARCHITECTURE NOTE (per-user setup):
// Each user runs their own webhook server. The webhook server URL is configured
// in ~/.pi-harness-runtime/keys/telegram-webhook-url.txt
//
// Flow:
//   User clicks button in Telegram
//   → Telegram sends callback to user's webhook server
//   → Webhook server writes command to job-commands.jsonl
//   → pi-harness polls GET /api/pending-commands
//   → pi-harness injects "resume" via steer
function initJobPipeWatcher(pi: ExtensionAPI): void {
	const home = process.env.HOME || process.env.USERPROFILE || homedir();
	const keysDir = join(home, ".pi-harness-runtime", "keys");

	// Get webhook server URL and API key from config
	const getWebhookConfig = () => {
		const webhookUrlPath = join(keysDir, "telegram-webhook-url.txt");
		const apiUrlPath = join(keysDir, "relay-api-url.txt"); // Separate API base URL
		const secretPath = join(keysDir, "telegram-webhook-secret.txt");

		if (!existsSync(webhookUrlPath) || !existsSync(secretPath)) {
			return null;
		}

		const webhookUrl = readFileSync(webhookUrlPath, "utf-8").trim();
		const secret = readFileSync(secretPath, "utf-8").trim();

		// Use separate API URL if configured, otherwise extract origin from webhook URL
		let apiBaseUrl: string;
		if (existsSync(apiUrlPath)) {
			apiBaseUrl = readFileSync(apiUrlPath, "utf-8").trim().replace(/\/$/, "");
		} else {
			// Extract origin from webhook URL (e.g., https://example.com from https://example.com/telegram)
			try {
				const url = new URL(webhookUrl);
				apiBaseUrl = `${url.protocol}//${url.host}`;
			} catch {
				apiBaseUrl = webhookUrl;
			}
		}

		if (!webhookUrl || !secret) {
			return null;
		}

		return { webhookUrl: webhookUrl.replace(/\/$/, ""), apiBaseUrl, secret };
	};

	const processCommand = (cmd: { command: string; jobId: string; userId: number }) => {
		logToFile("[JobPipe]", `Received: ${cmd.command} ${cmd.jobId} from user ${cmd.userId}`);

		switch (cmd.command) {
			case "resume": {
				// Inject "resume" into agent conversation (same as auto-resume)
				pi.sendUserMessage("resume", { deliverAs: "steer" });
				logToFile("[JobPipe]", "Injected resume via steer");
				break;
			}
			case "cancel": {
				// Cancel the current job
				pi.sendUserMessage("/harness-cancel", { deliverAs: "steer" });
				logToFile("[JobPipe]", "Injected /harness-cancel via steer");
				break;
			}
			default:
				logToFile("[JobPipe]", `Unknown command: ${cmd.command}`);
		}
	};

	// Acknowledge processed commands
	const acknowledgeCommands = async (jobIds: string[], config: { webhookUrl: string; apiBaseUrl: string; secret: string }) => {
		try {
			await fetch(`${config.apiBaseUrl}/api/acknowledge-commands`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Authorization": `Bearer ${config.secret}`,
				},
				body: JSON.stringify({ jobIds }),
			});
		} catch {
			// Non-critical, ignore
		}
	};

	const startWatcher = async () => {
		const config = getWebhookConfig();
		if (!config) {
			return; // Not configured
		}

		try {
			const response = await fetch(`${config.apiBaseUrl}/api/pending-commands`, {
				headers: {
					"Authorization": `Bearer ${config.secret}`,
				},
			});

			if (!response.ok) {
				return;
			}

			const data = (await response.json()) as { commands: Array<{ command: string; jobId: string; userId: number }> };
			const commands = data.commands || [];

			if (commands.length > 0) {
				logToFile("[JobPipe]", `Found ${commands.length} pending command(s)`);

				for (const cmd of commands) {
					processCommand(cmd);
				}

				// Acknowledge processed commands
				await acknowledgeCommands(
					commands.map((c) => c.jobId),
					config,
				);
			}
		} catch {
			// Network error or server unavailable, ignore
		}
	};

	// Poll every 60 seconds for new commands (user approval doesn't need sub-second latency)
	setInterval(startWatcher, 60_000);
	logToFile("[JobPipe]", "Watching for Telegram approval commands via API (polling every 60s)");
}

// --- LINE Voice Queue Watcher: Listen for LINE voice commands ---------
// Watches the LINE voice queue file and injects transcribed prompts into pi.
//
// Flow:
//   User sends voice message in LINE
//   → LINE sends webhook to our VPS
//   → VPS transcribes via Whisper API
//   → VPS writes command to line-voice-queue.jsonl
//   → pi-harness polls this file
//   → pi-harness injects prompt via steer
function initLineVoiceQueue(pi: ExtensionAPI): void {
	const home = process.env.HOME || process.env.USERPROFILE || homedir();
	const queueFile = join(home, ".pi-harness-runtime", "line-voice-queue.jsonl");

	const processLineVoiceQueue = async () => {
		try {
			const { existsSync, readFileSync, writeFileSync } = await import("node:fs");

			if (!existsSync(queueFile)) {
				return;
			}

			const content = readFileSync(queueFile, "utf-8");
			const lines = content.split("\n").filter((l) => l.trim());

			if (lines.length === 0) {
				return;
			}

			// Clear queue
			writeFileSync(queueFile, "", "utf-8");

			for (const line of lines) {
				try {
					const cmd = JSON.parse(line) as { type: string; text: string; userId: string; timestamp: string };

					if (cmd.type === "voice-prompt" && cmd.text) {
						logToFile("[LineVoice]", `Injecting voice prompt: "${cmd.text}"`);
						// The voice of the human is a request: it reaches Pi as a
						// message of the harness, so the input event cannot begin
						// the scope of the request.
						beginHumanRequest();
						pi.sendUserMessage(cmd.text, { deliverAs: "steer" });
						logToFile("[LineVoice]", "Voice prompt injected via steer");
					}
				} catch {
					// Skip malformed lines
				}
			}
		} catch {
			// Ignore errors
		}
	};

	// Poll every 5 seconds for new voice commands (voice is more time-sensitive than approvals)
	setInterval(processLineVoiceQueue, 5_000);
	logToFile("[LineVoice]", `Watching LINE voice queue: ${queueFile} (polling every 5s)`);
}

export default async function (pi: ExtensionAPI) {
	const tracker = new UsageTracker();
	const mirrorStore = new MirrorStore();
	ensureHarnessDir();
	// The relay path has no `pi` of its own - the extension API is kept
	// here so every path can reach the agent.
	_extensionApi = pi;

	// --- central-logging: ship structured logs to R2 / the webhook server ---
	// The pipeline is opt-in by configuration, never by code: without R2
	// credentials and without a webhook URL nothing leaves the machine.
	try {
		const logConfig = initCentralLogging();
		if (logConfig?.enabled) {
			logToFile(
				"[CentralLogging]",
				"enabled -",
				logConfig.notes.length > 0 ? logConfig.notes.join("; ") : "no transport configured",
			);
		}
	} catch (e) {
		logToFile("[CentralLogging]", "init failed:", String(e));
	}

	// Collect async init promises so we can wait for them before showing startup notification
	const asyncInitPromises: Promise<unknown>[] = [];

	// Note: Session state moved to module-level codexSessionState object

	// --- todo-bd-sync: Initialize two-way sync with bd ---------------
	// Start async init but don't await - runs in background
	void initTodoBdSync(pi);

	// --- config-capture: Auto-detect API config and document it -----------
	void initConfigCapture(pi);

	// --- write-review: Two-agent write with review loop ----------------------
	void initWriteReview(pi);

	// --- file-copy-helper: Inject cp rule when mimicking files -------------
	void initFileCopyHelper(pi);

	// --- agent-policy: Mandatory rule delivery and mutation gating -------------
	void initAgentPolicy(pi);

	// --- memory: Inject MEMORY.md and USER.md into system prompt -------------
	void initMemory(pi);

	// --- wiki: Knowledge wiki with search/ingest/lint commands ------------
	void initWiki(pi);

	// --- ssh-detach-interceptor: Auto-fix bare ssh & → nohup pattern ---------
	void initSshDetachInterceptor(pi);

	// --- jev-auto-continue: Agent autonomous decision when user unavailable -----
	asyncInitPromises.push(initAutoContinue(pi));

	// --- qdrant-vector-search: Qdrant integration for semantic skill search ----
	// Collect promise so we can wait for initialization before showing startup notification
	asyncInitPromises.push(initQdrant());

	// --- tooling-preference: offer Biome.js instead of ESLint/Prettier ------
	// The proposal is a decision of its own: it never pauses the work.
	void initToolingPreference(pi);

	// --- two-phase-review: implementation first, review as a second phase ----
	// A review signal during the implementation is queued, never executed.
	// The handlers are registered before the extension is ready, so a session
	// that starts right away is already covered.
	await initTwoPhaseReview(pi);

	// --- telegram-notifications: Telegram bot for harness event notifications ----
	// Collect promise so we can wait for initialization before showing startup notification
	asyncInitPromises.push(
		initTelegram(pi).then(() => {
			// --- line-notifications: report the LINE configuration --------------
			// The LINE channel is started by initTelegram() (it needs the LINE
			// adapter), so the line can only be judged after it ran: the
			// credentials may be in place while the channel was never started.
			// The report must also run when Telegram itself is not configured -
			// that is the fresh-install case where the instructions are needed.
			reportLineConfiguration();
			// The relay line needs the Telegram channel state (a user who only
			// uses Telegram wants the relay - the relay serves the Telegram
			// callbacks), so it is reported after the channel init too.
			reportRelayConfiguration();
		}),
	);

	// --- relay-stream: report the relay configuration ------------------------
	// The relay client itself is started by initTelegram() (it needs the
	// Telegram adapter), but the CONFIGURATION must be reported even when
	// Telegram is not configured at all - that is the fresh-install case.
	reportRelayConfiguration();

	// The key files that other users can read. The audit is read by
	// every other line, so this is the only place where a published
	// secret can surface.
	reportExposedKeyFiles();

	// The issue tracker of the session. The harness leans on bd (beads),
	// so the user is told that it is there - or how to install it.
	void reportBeadsTracker();

	// --- console-guard: keep the TUI prompt input field clean ----
	// A library that writes to the console would put its text into the
	// prompt input field. The guard sends it to the harness log instead.
	initConsoleGuard(pi);

	// --- mcp-connector: the fallback for the MCP servers of the extensions ----
	// The built-in MCP extension of Pi connects the servers that extensions
	// register. The connector takes over only the servers that nobody else
	// connected, so the tools of Honcho reach the model even when the
	// built-in support is disabled or replaced.
	initMcpConnector(pi);

	// --- line-voice-queue: Watch for LINE voice commands ----
	void initLineVoiceQueue(pi);

		// --- codex-watcher: Auto-trigger Pi when Codex finishes a plan ---
		// Flow: detect plan -> settle timer -> file stability check -> cwd match -> trigger
		try {
			// Event tracking for deduplication
			interface PlanEvent {
				codexSessionId: string;
				planPath: string;
				planHash: string;
				status: "observed" | "settling" | "ready" | "triggered" | "failed" | "manual_wait" | "done";
				ordinal: number;
				lastActivity: number;
				settleTimer: ReturnType<typeof setTimeout> | null;
				fileStableSince: number;
			}
			// Use codexSessionState object for all session tracking
			let lastActivityTime = 0;

			// Check if plan file exists and is stable (mtime unchanged)
			function checkPlanFileStable(planPath: string, sinceMs: number): boolean {
				try {
					const stat = statSync(planPath);
					const ageMs = Date.now() - stat.mtimeMs;
					return ageMs >= sinceMs;
				} catch {
					return false;
			}
			}

			// Try to find wiki/plan.md in project root
			function findPlanFile(projectRoot: string): string | null {
				const candidates = [
					join(projectRoot, "wiki", "plan.md"),
					join(projectRoot, "wiki", "PLAN.md"),
					join(projectRoot, "docs", "plan.md"),
				];
				for (const path of candidates) {
					if (existsSync(path)) return path;
				}
				return null;
			}

			// Check if manual mode is enabled (human-in-the-loop)
			const isManualMode = process.env.CODEX_MANUAL_MODE === "true";

			// Trigger Pi to read the plan
			async function triggerPiForPlan(event: PlanEvent): Promise<void> {
				// Check cwd match
				if (_piSessionCwd && codexSessionState.currentProjectRoot && _piSessionCwd !== codexSessionState.currentProjectRoot) {
					logToFile("[codex-trigger]", "Cwd mismatch, skipping:", _piSessionCwd, "!=", codexSessionState.currentProjectRoot);
					return;
				}

				// In manual mode, do NOT auto-trigger Pi - wait for human command
				if (isManualMode) {
					logToFile("[codex-trigger]", "Manual mode: plan ready but NOT auto-triggering Pi. Awaiting human command.");
					event.status = "manual_wait";
					// Full plan already sent via onMessages notification - no duplicate notification here
					return;
				}

				const triggerMsg = `Codex finished a plan for this workspace. Read and follow the plan at:\n${event.planPath}\n\nTreat that file as the task requirements. Start by summarizing the plan and then carry it out. Do not edit the plan unless the user asks.`;

				try {
					await pi.sendUserMessage(triggerMsg, { deliverAs: "steer" });
					event.status = "triggered";
					logToFile("[codex-trigger]", "Triggered Pi for plan:", event.planPath);
				} catch (err) {
					event.status = "failed";
					logToFile("[codex-trigger]", "Trigger failed:", String(err));
				}
			}

			// Start settle timer for plan
			function startSettleTimer(planPath: string, ordinal: number) {
				const eventKey = `${codexSessionState.currentCodexSessionId}:${planPath}`;
				const existing = codexSessionState.deliveredEvents.get(eventKey);
				if (existing && (existing.status === "triggered" || existing.status === "ready" || existing.status === "manual_wait")) {
					logToFile("[codex-trigger]", "Event already handled:", eventKey);
					return;
				}

				const event: PlanEvent = {
					codexSessionId: codexSessionState.currentCodexSessionId ?? "",
					planPath,
					planHash: "",
					status: "settling",
					ordinal,
					lastActivity: Date.now(),
					settleTimer: null,
					fileStableSince: 0,
				};
				codexSessionState.deliveredEvents.set(eventKey, event);

				logToFile("[codex-trigger]", "Plan observed, starting settle timer:", planPath);

				// Cancel existing timer if any
				if (event.settleTimer) {
					clearTimeout(event.settleTimer);
				}

				event.settleTimer = setTimeout(async () => {
					// Check file stability (5 seconds without changes)
					if (!checkPlanFileStable(planPath, _SETTLE_DELAY_MS)) {
						logToFile("[codex-trigger]", "Plan file still changing, restarting timer:", planPath);
						// Restart timer
						event.lastActivity = Date.now();
						startSettleTimer(planPath, ordinal);
						return;
					}

					// Check no new activity during settle
					if (Date.now() - lastActivityTime > _SETTLE_DELAY_MS) {
						event.status = "ready";
						logToFile("[codex-trigger]", "Plan settled, triggering Pi:", planPath);
						await triggerPiForPlan(event);
					} else {
						logToFile("[codex-trigger]", "New activity during settle, restarting:", planPath);
						startSettleTimer(planPath, ordinal);
					}
				}, _SETTLE_DELAY_MS);
			}

			// --- greeting: Track baseline session on watcher startup ---
			// Capture ANY session present at startup as baseline - skip it to avoid
			// greeting stale sessions from history. If no session exists at startup,
			// the first session to appear afterward is treated as new and greeted.
			let firstPollDone = false;
			try {
				const { getLatestSession } = await import("./packages/codex-watcher/dist/src/index.js");
				const baseline = getLatestSession();
				if (baseline) {
					codexSessionState.greetingBaselineSessionId = baseline.id;
					// Log freshness for debugging, but always use as baseline
					if (baseline.updatedAt) {
						const ageMs = Date.now() - Date.parse(baseline.updatedAt);
						const ageStr = ageMs < 10 * 60 * 1000 ? "recent" : "stale";
						logToFile("[codex-greeting]", `Baseline session set (${ageStr}):`, baseline.id, `age=${Math.round(ageMs/1000)}s`);
					} else {
						logToFile("[codex-greeting]", "Baseline session set:", baseline.id);
					}
				} else {
					logToFile("[codex-greeting]", "No baseline session at startup");
				}
			} catch {
				logToFile("[codex-greeting]", "Could not get baseline session");
			}

			// Deliver any pending greeting if Pi session is now active
			// This runs on watcher startup; pending greetings are also drained in session_start
			if (codexSessionState.pendingGreeting && _piSessionCwd) {
				const pg = codexSessionState.pendingGreeting;
				// Check expiry (5 minutes)
				if (Date.now() - pg.timestamp > 5 * 60 * 1000) {
					logToFile("[codex-greeting]", "Pending greeting expired");
					codexSessionState.pendingGreeting = null;
				} else if (_piSessionCwd === pg.projectRoot) {
					// Roots match - send greeting with followUp mode
					const greetKey = `${_piSessionCwd}:${pg.sessionId}`;
					if (!codexSessionState.greetedSessions.has(greetKey)) {
						logToFile("[codex-greeting]", "Delivering pending greeting for:", pg.sessionId);
						try {
							await pi.sendUserMessage(
								`Codex opened in this workspace (session ${pg.sessionId.slice(0, 8)}...). Say hello briefly, then wait for the user's next instruction.`,
								{ deliverAs: "followUp" }
							);
							codexSessionState.greetedSessions.add(greetKey);
						} catch (err) {
							logToFile("[codex-greeting]", "Failed to deliver greeting:", String(err));
							// Keep pendingGreeting for retry - don't clear on failure
							return;
						}
					}
					codexSessionState.pendingGreeting = null;
				}
			}

			/**
			 * The settle timer of a plan message.
			 *
			 * A review has no file to watch, so only a plan starts the
			 * timer. The candidate of the plan is remembered, so the settle
			 * timer can find the message again.
			 */
			const startPlanSettleTimer = (msg: {
				ordinal: number;
				text: string;
			}): void => {
				if (!codexSessionState.currentProjectRoot) return;
				const planPath = findPlanFile(codexSessionState.currentProjectRoot);
				if (!planPath) {
					// No wiki/plan.md found yet - wait for file to appear
					logToFile(
						"[codex-trigger]",
						"Plan message but no wiki/plan.md yet, waiting...",
					);
					return;
				}
				// Track plan candidate
				codexSessionState.currentPlanCandidate = {
					ordinal: msg.ordinal,
					text: msg.text,
					timestamp: Date.now(),
				};
				logToFile("[codex-trigger]", "Plan message + wiki file detected:", planPath);
				startSettleTimer(planPath, msg.ordinal);
			};

			/**
			 * The alert of a plan or a review message.
			 *
			 * The buttons are the actions of the stage: a plan can be
			 * coded, a review can be coded again. Both stages can be
			 * closed.
			 */
			const notifyCodexStage = (
				msg: { ordinal: number; text: string },
				hasReviewMarker: boolean,
				sessionId: string,
				projectRoot: string,
				planPath: string | undefined,
			): void => {
				// Create tokens for each action
				const codeToken = _createPendingAction(sessionId, "code", projectRoot, "plan");
				const doneToken = _createPendingAction(sessionId, "done", projectRoot, "plan");

				// Use event type based on stage
				if (hasReviewMarker) {
					// Review stage: buttons are Code again and Done
					const codeAgainToken = _createPendingAction(sessionId, "code_again", projectRoot, "review");
					// SAFETY: _nc.center is always an object with notifyWithButtons in our usage
					void (_nc as unknown as { center: { notifyWithButtons: Function } }).center.notifyWithButtons("CodexReviewDetected", {
						requirement: msg.text,
						taskTitle: sessionId,
						details: {
							ordinal: msg.ordinal,
							stage: "review",
							projectRoot,
							messageLength: msg.text.length,
						},
					}, [
						{ text: "Code again", action: PING_PONG_ACTIONS.CODE_AGAIN, targetId: codeAgainToken },
						{ text: "Done", action: PING_PONG_ACTIONS.DONE, targetId: doneToken },
					]);
					return;
				}
				// Plan stage: buttons are Code and Done
				// SAFETY: _nc.center is always an object with notifyWithButtons in our usage
				void (_nc as unknown as { center: { notifyWithButtons: Function } }).center.notifyWithButtons("CodexPlanDetected", {
					requirement: msg.text, // Full text, no truncation
					taskTitle: sessionId,
					details: {
						ordinal: msg.ordinal,
						stage: "plan",
						projectRoot,
						planPath: planPath || undefined,
						messageLength: msg.text.length,
					},
				}, [
					{ text: "Code", action: PING_PONG_ACTIONS.CODE, targetId: codeToken },
					{ text: "Done", action: PING_PONG_ACTIONS.DONE, targetId: doneToken },
				]);
			};

			const codexHandle = startWatcher({
				pollIntervalMs: 5000,
				maxIdlePolls: Infinity,
			onSessionChange: async (session) => {
			if (session) {
				logToFile("[codex]", `Session started: ${session.threadName}, root: ${session.projectRoot}`);

				// Update session state FIRST - needed for message handler
				codexSessionState.currentCodexSessionId = session.id;
				codexSessionState.currentProjectRoot = session.projectRoot;
				nc("CodexSessionStarted", {
					requirement: `${session.threadName || "Codex session"} [${session.projectRoot || "unknown"}]`,
					taskTitle: session.id,
				});

				// --- Same-workspace greeting ---
				const codexSessionId = session.id;
				const codexProjectRoot = session.projectRoot;

				// Skip the first callback only if it matches the baseline
				if (!firstPollDone) {
					firstPollDone = true;
					if (codexSessionId === codexSessionState.greetingBaselineSessionId) {
						logToFile("[codex-greeting]", "Skipping baseline session (first poll):", codexSessionId);
						return;
					}
					// First poll was a new session - continue to greeting logic
					logToFile("[codex-greeting]", "First poll is new session:", codexSessionId);
				}

				// Check for duplicate greeting
				const piCwd = _piSessionCwd || "";
				const greetKey = `${piCwd}:${codexSessionId}`;
				if (codexSessionState.greetedSessions.has(greetKey)) {
					logToFile("[codex-greeting]", "Already greeted:", greetKey);
					return;
				}

				// Check root match
				if (!piCwd || !codexProjectRoot || piCwd !== codexProjectRoot) {
					logToFile("[codex-greeting]", "Different workspace or Pi cwd unknown, skipping greeting");
					return;
				}

				logToFile("[codex-greeting]", "Same workspace detected:", codexSessionId);

				// Use _piSessionCwd (Pi state) to check if Pi is active
				if (piCwd) {
					// Pi session active - send greeting now with await for safe delivery
					logToFile("[codex-greeting]", "Sending greeting for:", codexSessionId);
					try {
						await pi.sendUserMessage(
							`Codex opened in this workspace (session ${codexSessionId.slice(0, 8)}...). Say hello briefly, then wait for the user's next instruction.`,
							{ deliverAs: "followUp" }
						);
						codexSessionState.greetedSessions.add(greetKey);
					} catch (err) {
						logToFile("[codex-greeting]", "Failed to deliver greeting:", String(err));
						// Keep greetKey out of greetedSessions so retry is possible
					}
				} else {
					// Pi session not active yet - queue for delivery on session_start
					logToFile("[codex-greeting]", "Pi not active, queueing greeting for:", codexSessionId);
					codexSessionState.pendingGreeting = {
						sessionId: codexSessionId,
						projectRoot: codexProjectRoot,
						timestamp: Date.now(),
					};
				}
			} else {
				codexSessionState.currentCodexSessionId = null;
				codexSessionState.currentProjectRoot = null;
				codexSessionState.currentPlanCandidate = null;
			}
		},
			onMessages: (msgs) => {
				if (!codexSessionState.currentCodexSessionId) return;

				for (const msg of msgs) {
					lastActivityTime = Date.now();

					if (msg.role !== "assistant") continue;

					const classification = classifyMessage(msg.text);
			
					// Check for review markers in unknown messages
					const hasReviewMarker = classification === "unknown" && detectReviewMarker(msg.text);
					if (classification !== "plan" && classification !== "mixed" && !hasReviewMarker) continue;
			
				// Determine stage (for future use in event metadata)
				void classification; // used for classification only

				// Only start settle timer for plans (not reviews)
				// Reviews don't have a file to watch
						if (!hasReviewMarker) {
							startPlanSettleTimer(msg);
						}

					// Emit Telegram alert with full content (async, non-blocking)
					const planPath = codexSessionState.currentProjectRoot ? findPlanFile(codexSessionState.currentProjectRoot) : undefined;

					// Create pending actions for PING_PONG buttons
					const sessionId = codexSessionState.currentCodexSessionId || "unknown";
					const projectRoot = codexSessionState.currentProjectRoot || "";
				
					notifyCodexStage(msg, hasReviewMarker, sessionId, projectRoot, planPath);
					}
				},
			});

		// Clean up when pi session ends
		pi.on("session_shutdown", () => codexHandle.stop());
	} catch {
		// Codex watcher unavailable
	}

	// --- honcho-memory: Honcho MCP for peer/user memory (honcho_profile, etc.) ----
	// Collect promise so we can wait for initialization before showing startup notification
	// Note: initHoncho registers the MCP server but workspace creation is deferred to session_start
	// because MCP tool calls require an active Pi session.
	asyncInitPromises.push(initHoncho(pi));

	// The session decides how long the work of the session may live.
	pi.on("session_start", () => {
		sessionEnded = false;
	});
	pi.on("session_shutdown", () => {
		sessionEnded = true;
	});

	// Defer Honcho workspace/identity creation until we have an active session
	// Use a ref object so we can check and update atomically
	const honchoIdentityState = { done: false, success: false };
	pi.on("session_start", async () => {
		if (honchoIdentityState.done) return;
		honchoIdentityState.done = true; // Prevent concurrent calls

		const { ensureHonchoIdentity } = await import("./harness/honcho-init.js");
		honchoIdentityState.success = await ensureHonchoIdentity();
	});

	// --- skills-sync-hint: Suggest skill sync if skills dir is empty --------
	void initSkillsSyncHint();

	// --- langchain-loop: Ping-pong write-review loop (planner + reviewer + coder) ----
	void initLangChain(pi);

	// --- paperclip: Watch Paperclip inbox, route tasks to pi.dev + Telegram ------------
	// Only starts if PAPERCLIP_API_KEY is set or keys file exists.
	if (hasPaperclipConfig()) {
		const paperclipConfig = getPaperclipConfig();
		if (paperclipConfig) {
			const watcher = new PaperclipWatcher(paperclipConfig, {
				nc,
				sendUserMessage: (content, opts) => {
					try {
						pi.sendUserMessage(content, opts as { deliverAs: "steer" });
					} catch {
						// pi.dev may not be ready
					}
				},
				pollIntervalMs: 30_000,
				onRouted: async (issue) => {
					// Mark task as in_progress in Paperclip
					try {
						const config = getPaperclipConfig();
						if (config) {
							const { PaperclipClient } = await import(
								"./packages/paperclip-integration/dist/index.js"
							);
							const client = new PaperclipClient(config);
							await client.updateIssueStatus(issue.id, "in_progress");
						}
					} catch {
						// Non-critical
					}
				},
			});
			void watcher.start();
			// pi.on("session_end", () => watcher.stop()); // Removed - type error
		}
	} else {
		logToFile("[paperclip]", "Not configured. Set PAPERCLIP_API_KEY or write API key to ~/.pi-harness-runtime/keys/paperclip-api-key.txt");
	}

	// --- loop-completions: Watch daemon completions → agent TUI todos --------
	void initLoopCompletions(pi);

	// --- Hermes-style skills: Initialize skill system ----------------------
	// Scan skills from ~/.pi-harness-runtime/skills/ and register with pi.dev
	// Collect promise so we can wait for initialization before showing startup notification
	asyncInitPromises.push(initHermesSkills(pi));

	// --- Job pipe watcher: Listen for Telegram callback commands -----------
	// Watch for resume/cancel commands from telegram-callback-processor
	void initJobPipeWatcher(pi);

	// --- TASK TRACKING TERMINOLOGY CLARIFICATION ------------------------
	// CRITICAL: This project has TWO separate task trackers. Agents often confuse them.
	const TASK_TERMINOLOGY_CLARIFICATION = `
## TASK TRACKING TERMINOLOGY (CRITICAL)

This project uses TWO different task tracking systems. **Always clarify which one the user means:**

| What you say | Tool | Purpose |
|-------------|------|---------|
| **bd** / **beads** / **issues** | \`bd create\`, \`bd list\`, \`bd close\` | Issue tracker (GitHub-synced) |
| **todo** / **todos** | \`todo\` tool (JSON-RPC) | Local task list (session-only) |

**When in doubt, ASK:** "Did you mean **bd** (issue tracker) or **todo** (local task list)?"

### When to use each:
- **bd (beads)**: Long-lived issues, bugs, features, GitHub issues
- **todo**: Short-lived session tasks, immediate action items
`;

	// --- Auto-Invoke rpiv-todo via System Prompt ------------------------
	// This makes the todo overlay ALWAYS activate at session start
	const AUTO_TODO_INVOKE_HINT = `

You have access to a **todo tool** that shows a persistent task overlay.
ALWAYS use it at the START of every session to capture user requirements as tasks.
When the user gives you a multi-step task:
1. Immediately create todo items for each step using the **todo tool** (not bd!)
2. Keep tasks updated - mark in_progress when working, completed when done
3. When a task is completed, continue to the next or ask the user

The todo overlay persists and helps track progress across your conversation.
`;

	// --- CONTINUE UNTIL DONE: Auto-pick next todo, don't stop early -----------
	// Fixes the habit: agent completes one task then waits instead of continuing
	const CONTINUE_UNTIL_DONE_HINT = `

## CONTINUE-UNTIL-DONE RULE

**CRITICAL — NEVER STOP after completing ONE task when more are pending.**

After completing ANY task or unit of work:
1. IMMEDIATELY run \`todo list\` to check for pending/in_progress items
2. If pending tasks exist, pick the next one and start working on it WITHOUT asking
3. Only stop and report progress when ALL tasks are completed (or genuinely blocked)
4. If blocked (waiting on user input, CI, external dependency), THEN ask

**Anti-pattern (WRONG):**
> [Task 1 done] → stops → "Done! What would you like me to do next?"

**Correct pattern:**
> [Task 1 done] → picks Task 2 → works → Task 3 → ... → all done → report

This applies to EVERY turn. Every time you finish something, check todos first.
`;

	const COMMIT_BUILD_CHECKLIST = `

BEFORE committing code or triggering builds, ALWAYS check:
1. Run \`bd ready\` to see pending **bd issues**
2. Mark completed issues with \`bd close <id> --reason "Done"\`
3. Acknowledge pending issues before proceeding
4. Never commit/build without acknowledging pending bd issues

NOTE: Use \`todo\` tool for session task tracking, \`bd\` for issue tracker.
`;

	const WRITE_REVIEW_HINT = `

WRITER-REVIEWER WORKFLOW:
When working on a feature from {project}/wiki/* or {project}/.write-review/:
1. Read the prompt/task file to understand requirements
2. Write clean, complete code
3. Mark task "in_progress" using **todo tool**
4. When code is ready, trigger review with \`bd create "Review: <task>" -t review -p 1\`
5. After review, close the issue: \`bd close <id> --reason "Approved"\`
6. If reviewer requests changes, update code and re-review
7. Never skip review on non-trivial features
`;

	const DOCKER_CLEANUP_HINT = `

DOCKER CLEANUP WORKFLOW:
AFTER running any Docker build command (docker build, docker compose build, docker compose up --build):
1. ALWAYS run \`docker builder prune -f\` to clean up build cache
2. This saves disk space - Docker build cache grows fast
3. Example: After \`docker compose up --build\`, run \`docker builder prune -f\`
4. For aggressive cleanup: \`docker builder prune -a -f\` (removes ALL unused cache)
`;
	// --- SSH Guard Rules: Never run servers over SSH in the foreground --------
	// This runs in EVERY repo the agent enters — not just pi-harness-runtime.
	// Pattern: embed as constant (no file dependency) so it works everywhere.
	const SSH_GUARD_RULES = `
## SSH / Remote Server Commands

**CRITICAL — SSH BACKGROUNDING RULE:**
Never run a server or long-running process over SSH in the foreground. This causes the SSH session to hang indefinitely, blocking the agent for hours.

- BAD: \`ssh host "python -m uvicorn ..."\`  (no &, SSH will hang)
- GOOD: \`ssh host "nohup python -m uvicorn ... > /tmp/log 2>&1 & echo DONE"\`
- GOOD: \`ssh host "cd /path && python -m uvicorn ... > log 2>&1 & echo DONE"\`

Every SSH command that starts a server, daemon, or background process MUST use the detached SSH pattern: nohup + redirect + & + echo DONE.
If you are unsure whether a command will hang, ALWAYS use nohup + backgrounding. It is always safe to detach; it is never safe to run a server in the foreground over SSH.

Server process examples that must be detached: uvicorn, fastapi dev server, gunicorn, node server, flask run, django runserver, python http.server, any listening daemon.
`;

	let firstAgentStart = true;
	pi.on("before_agent_start", async (event) => {
		if (firstAgentStart) {
			// Return additional system prompt content to append
			const additionalPrompt = [
				TASK_TERMINOLOGY_CLARIFICATION,
				AUTO_TODO_INVOKE_HINT,
				CONTINUE_UNTIL_DONE_HINT,
				COMMIT_BUILD_CHECKLIST,
				WRITE_REVIEW_HINT,
				DOCKER_CLEANUP_HINT,
				SSH_GUARD_RULES,
			].join("\n");

			firstAgentStart = false;

			// Return the additional prompt to append to systemPrompt
			return { systemPrompt: event.systemPrompt + "\n" + additionalPrompt };
		}

		// Only the first turn carries the additional prompt.
		return undefined;
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

IMPORTANT - TASK UPDATE REMINDER:
Before running a build, ensure you update the current task status:
1. If tracking in **todo tool**: mark task in_progress
2. If tracking in **bd issues**: use \`bd update <id> --status in_progress\`
3. After build succeeds: mark completed in the appropriate tracker

Run \`bd ready\` to see current bd issues.
`;

	// Detect build commands and log reminder (don't modify result.content)
	// Modifying result.content is fragile - pi-coding-agent expects specific structures
	pi.on("tool_execution_end", async (event) => {
		const toolName = (event as { toolName?: string }).toolName;
		if (toolName !== "bash") return;

		const result = (event as { result?: { content?: unknown } }).result;
		if (!result) return;

		// Get content for detection only - don't modify result.content
		const rawContent = result.content;
		let content: string;
		if (typeof rawContent === "string") {
			content = rawContent;
		} else if (Array.isArray(rawContent)) {
			content = rawContent
				.map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
				.join("\n");
		} else if (rawContent) {
			content = JSON.stringify(rawContent);
		} else {
			return; // No content to analyze
		}

		// Check if this is a build command
		const isBuildCommand = BUILD_COMMANDS.some((cmd) =>
			content.toLowerCase().includes(cmd.toLowerCase()),
		);

		// Log reminder to console (agent will see it)
		if (
			isBuildCommand &&
			!content.includes("bd ready") &&
			!content.includes("TODO UPDATE")
		) {
			logToFile(TODO_BUILD_REMINDER.trim());
		}
	});

	// --- Auto-track every assistant message ------------------------------
	// The runtime of the automatic resumes after a provider failure.
	//
	// The runtime owns the sequence of a failure: the failure waits for the
	// settled boundary, because Pi retries a failed turn internally first,
	// and a scheduled resume checks that it still owns the session before it
	// dispatches. The resume itself goes through the executor below, so
	// there is no second resume loop.
	providerRecoveryRuntime = new ProviderRecoveryRuntime({
		controller: providerRecovery,
		actions: pendingActions,
		recoveryActionId: PROVIDER_RECOVERY_ACTION_ID,
		blockedActionId: PROVIDER_BLOCKED_ACTION_ID,
		overloadActionId: PROVIDER_OVERLOAD_ACTION_ID,
		maxAttempts: MAX_RECOVERY_ATTEMPTS,
		context: () => ({
			sessionId: activeSessionId,
			explicitlyPaused: todoContinuationHandle?.isExplicitlyPaused() ?? false,
			questionPending:
				sharedState.pqController?.hasPendingQuestion?.() ?? false,
			// A request of the user that is running right now. A resume that
			// queues itself on top of it continues the work twice.
			sessionBusy: activeExtensionContext?.isIdle?.() === false,
		}),
		resetEvidence: (failure) => applicableResetEvidence(failure),
		overloadDelayMs: () => getProviderOverloadResumeDelayMs(),
		overloadMaxAttempts: PROVIDER_OVERLOAD_AUTO_RESUME_LIMIT,
		dispatch: async (reason) => {
			// The user is typing: a resume that injects itself now competes
			// with the user.
			if (activeExtensionContext?.hasPendingMessages()) {
				logToFile("[pi-harness]", "Resume skipped: hasPendingMessages=true");
				return;
			}
			// The session is busy: a request of the user is running. The
			// queued messages do not show it, because a message that Pi
			// picked up is not queued anymore.
			if (activeExtensionContext?.isIdle?.() === false) {
				logToFile("[pi-harness]", "Resume skipped: the session is busy");
				return;
			}
			await queueAutoResume(reason, PROVIDER_OVERLOAD_RESUME_PROMPT, "followUp");
		},
		log: (message) => logToFile("[pi-harness]", message),
	});

	// A request of the user takes the work back from the automatic recovery.
	//
	// A countdown that runs while the user works queues a second
	// continuation on top of the request of the user, and the work happens
	// twice. The manual request therefore cancels the pending attempt.
	//
	// The message of the harness itself carries the source `extension` and
	// is left alone: a recovery must not cancel its own attempt.
	pi.on("input", (event) => {
		if (event.source === "extension") return;
		providerRecoveryRuntime?.cancelPending();
		// A request of the human begins a new scope: the todos of the
		// previous request are history, and the completion of that request
		// is not the completion of this one. The message of the harness
		// itself carries the source `extension` and begins nothing.
		beginHumanRequest();
	});

	// The run settled: the internal retries of Pi are over, so a failure
	// that waited for the boundary is final and the recovery starts now.
	pi.on("agent_settled", (event) => {
		// An aborted run is a decision of the user, not a failure of the
		// provider: an automatic resume would fight the user.
		//
		// The installed core of Pi does not carry an abort flag on this
		// event. The signal of the run is the way the harness learns about
		// it: the signal belongs to the run that is going, and Escape
		// aborts it. The optional flag of a newer core is read when it is
		// there, and it is never assumed.
		const abortedRun =
			("aborted" in event && event.aborted === true) ||
			activeRunAbortSignal?.aborted === true;
		activeRunAbortSignal = undefined;
		if (abortedRun) {
			providerRecoveryRuntime?.cancel();
			providerFailureAttemptsInRun = 0;
			return;
		}
		providerRecoveryRuntime?.noteSettled();
		// The run is over: the streak of its failures ends with it, so the
		// next run starts its own count.
		providerFailureAttemptsInRun = 0;
	});

	pi.on("message_end", async (event, ctx) => {
		// The context of the running extension: the resume checks it before
		// it dispatches, so it does not compete with the user.
		activeExtensionContext = ctx;
		// The signal of the run that is going: the user aborts a run with
		// Escape, and the signal is the way the harness learns about it.
		activeRunAbortSignal = ctx.signal ?? activeRunAbortSignal;
		if (isOutputLimitResumePromptMessage(event.message)) {
			pendingOutputLimitResumeAfterSettled = false;
			return;
		}
		if (event.message.role !== "assistant") return;

		// A turn ran: a continuation that was queued is no longer queued.
		// The row leaves with it, so it never stays behind as a promise.
		pendingActions.removeWhere(
			(action) => action.owner === "continuation" && action.state === "queued",
		);

		// DEBUG: Log model ID

		const m = event.message as {
			role?: string;
			stopReason?: unknown;
			errorMessage?: unknown;
			responseId?: string;
			provider?: string;
			content?: unknown;
			usage?: {
				input?: number;
				output?: number;
				cacheRead?: number;
				cacheWrite?: number;
				cost?: { total?: number };
			};
		};

		// An aborted turn is a decision of the user, not a failure of the
		// provider. The candidate of an earlier failure dies with it: an
		// automatic resume would fight the decision of the user.
		if (m.stopReason === "aborted" || ctx.signal?.aborted === true) {
			providerRecoveryRuntime?.cancel();
			providerFailureAttemptsInRun = 0;
			return;
		}

		// A provider failure is classified before anything else happens. The
		// classification reads the error of the turn; the text of an answer
		// is only read when it names a known provider failure, so a sentence
		// about an error is not a failure.
		const providerErrorText =
			typeof m.errorMessage === "string" ? m.errorMessage : "";
		const providerFailure = providerErrorText
			? classifyProviderFailure(providerErrorText)
			: (() => {
					const fromText = classifyProviderFailure(readMessageText(event.message));
					return fromText && fromText.kind !== "unknown" ? fromText : null;
				})();

		// Every failed attempt of Pi is one attempt of the run. The count
		// is what tells a cancelled retry from a spent budget: Pi stops
		// early only when the user cancels the delay of the retry.
		const failedAttempt = m.stopReason === "error";
		if (failedAttempt) {
			providerFailureAttemptsInRun += 1;
		} else {
			// A turn that did not fail ends the streak of the failures of
			// the run: the next failure is the first attempt of its own
			// retry.
			providerFailureAttemptsInRun = 0;
		}

		if (providerFailure) {
			// The failure is a candidate: the recovery starts when the run
			// settles, because Pi retries a failed turn internally first.
			// A recovery that starts at the message of the failed attempt is
			// a competing continuation.
			let failureKey =
				typeof m.responseId === "string" && m.responseId.length > 0
					? m.responseId
					: "";
			if (!failureKey) {
				providerFailureCounter += 1;
				failureKey = `${activeSessionId}:${providerFailureCounter}`;
			}
			if (providerFailure.retryable) {
				// The identity of the failure keeps a repeated copy of the
				// same error from starting a second cycle.
				const overloadEligible =
					providerFailure.kind === "overload" &&
					!isProviderRetryFailedReport(readMessageText(event.message)) &&
					shouldQueueProviderOverloadResume(
						m,
						providerRecoveryRuntime?.overloadAttemptCount ?? 0,
						ctx.hasPendingMessages(),
						{ detected: true },
					);
				providerRecoveryRuntime?.noteFailure(providerFailure, failureKey, {
					...(typeof m.provider === "string" ? { provider: m.provider } : {}),
					overloadEligible,
					// The classification owns the policy: a rate limit and an
					// exhausted plan join the cycle, an overload keeps its own
					// executor. One failure has one executor.
					boundedEligible: usesBoundedRecovery(providerFailure),
					// What the attempts of the run say about the retry of
					// Pi: a run with fewer attempts than the budget of Pi
					// ends in a cancelled delay, and the user decided that.
					//
					// The predicate of Pi decides whether a retry delay
					// exists at all, so the error text is the fact. The
					// category of the harness is a policy decision and can
					// disagree: a MiniMax 2067 carries the type
					// `rate_limit_error`, so Pi retries it.
					piRetryOutcome: piRetryOutcome(
						readPiRetrySettings({ cwd: ctx.cwd }),
						providerFailureAttemptsInRun,
						typeof m.errorMessage === "string" ? m.errorMessage : undefined,
					),
				});
			} else {
				// No automatic retry can fix this failure: the row says that
				// nothing is scheduled.
				//
				// A permanent failure also supersedes the retry of an
				// earlier failure of the same run: a rate limit that was
				// followed by a credential error must not schedule a resume
				// when the run settles.
				providerRecoveryRuntime?.cancelPending();
				providerFailureAttemptsInRun = 0;
				pendingActions.register({
					id: PROVIDER_BLOCKED_ACTION_ID,
					sessionId: activeSessionId,
					owner: "provider",
					kind: "retry",
					state: "blocked",
					...(providerFailure.provider ? { provider: providerFailure.provider } : {}),
					...(providerFailure.code ? { code: providerFailure.code } : {}),
					reason: providerFailure.reason,
				});
			}
		} else {
			// A turn that is not a provider failure has no candidate: the
			// streak of the failures of the run was already ended above.
		}

		if (
			shouldQueueOutputLimitResume(
				m,
				outputLimitResumeAttempts,
				ctx.hasPendingMessages(),
			)
		) {
			outputLimitResumeAttempts += 1;
			pendingOutputLimitResumeAfterCompact = true;
			pendingOutputLimitResumeAfterSettled = true;
			registerQueuedContinuation(
				OUTPUT_LIMIT_CONTINUATION_ID,
				"the output limit continues the turn",
			);
			await queueAutoResume("output-limit", OUTPUT_LIMIT_RESUME_PROMPT, "steer");
			// Emit OutputLimitContinued to Telegram
			await nc("OutputLimitContinued", {
				requirement: "Session output",
				error: `Attempt ${outputLimitResumeAttempts}`,
			});
		} else if (m.stopReason === "stop") {
			outputLimitResumeAttempts = 0;
			pendingOutputLimitResumeAfterSettled = false;
			// The turn completed: the provider works again. The recovery
			// cycle ends with it, so the next failure starts at the first
			// attempt, and a pending attempt of the cycle is cancelled. A
			// provider that was blocked is not blocked any more, and its row
			// leaves with it.
			providerRecoveryRuntime?.noteSuccess(
				typeof m.provider === "string" ? m.provider : undefined,
			);

			// --- Auto-Continue: Check todos and keep going -------------------------------
			// If the agent stopped naturally AND the response mentions pending todos,
			// auto-steering forces it to continue without waiting for user input.
			const text = readMessageText(event.message);
			if (
				text &&
				/Todos?\s*\(\d+\/\d+\)|\([○◐●]\s+\w+.*pending|Tasks?\s*\(\d+.*pending\)/i.test(text)
			) {
				try {
					pi.sendUserMessage(
						"You have pending tasks. Run `todo list` to see them, then continue with the next pending one without asking.",
						{ deliverAs: "steer" },
					);
				} catch {
					// best-effort
				}
			}
		}

		if (!m.usage) return;
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
			// message_end: no-op on parse error (already logged upstream)
		} catch {
			// ignore — the message was already logged by the TUI layer
		}
	});

	// --- Smart quota fetch for MiniMax status ------------------------
	const MINIMAX_REFRESH_MIN_INTERVAL_MS = 15 * 60 * 1000;
	const MINIMAX_REFRESH_TOKEN_THRESHOLD = 200_000;
	const MINIMAX_REFRESH_REQUEST_THRESHOLD = 12;
	const quotaScraper = process.env.QUOTA_COOKIE_FILE
		? new MiniMaxQuotaScraper({
				cookieFile: process.env.QUOTA_COOKIE_FILE,
				quiet: true,
			})
		: new MiniMaxQuotaScraper({ quiet: true });

	// --- Smart quota fetch for OpenAI status -------------------------
	const OPENAI_REFRESH_MIN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
	const _openaiQuotaScraper = new OpenAIQuotaScraper({ quiet: true });
	const _glmQuotaScraper = new GLMQuotaScraper({ quiet: true });
	let lastOpenAIQuotaFetchAt = 0;
	let lastGLMQuotaFetchAt = 0;

	// --- Cookie sanitizer integration ------------------------------------
	// The drop folder is the user-facing, forgiving input. The canonical
	// cache (`~/.config/minimax-cookies.txt`) is the runtime-owned,
	// normalized output that `MiniMaxQuotaScraper` reads. Either being
	// present enables scraping.
	const cookieDropDir = COOKIE_DROP_DIR;
	const cookieCachePath = join(homedir(), ".config", "minimax-cookies.txt");

	const hasCookieSource = (): boolean => {
		try {
			if (existsSync(cookieCachePath)) return true;
		} catch {
			// ignore
		}
		try {
			return sanitizerHasAnyCookieSource(cookieDropDir);
		} catch {
			return false;
		}
	};

	// --- TUI quota signal plumbing (OpenAI / GLM / Anthropic / OpenRouter) --
	// The TUIUsageMonitor parses provider quota-exhaustion messages from pi's
	// TUI / message stream and emits signals we write to per-provider mirror
	// entries. For providers that don't expose a continuous usage API this is
	// the only path to surface data in the footer.
	const quotaManager = new QuotaManager();
	const tuiMonitor = new TUIUsageMonitor({ quotaManager });

	tuiMonitor.on("signal", (signal: TUIUsageSignal) => {
		// 	"[DEBUG tuiMonitor signal] Received signal:",
		// 	JSON.stringify(signal),
		// );
		try {
			writeMirrorRecord(signal.provider as ProviderId, {
				synced_at: signal.timestamp,
				source: "tui-signal",
				exhausted: signal.exhausted,
				limitType: signal.limitType,
				remainingPct: signal.remainingPct,
				resets_at: signal.resetsAt,
			});
		} catch (e) {
			logToFile("[pi-harness] tui-signal write failed:",
				e instanceof Error ? e.message : String(e),
			);
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
					logToFile(
						"[pi-harness] cookie-sanitizer: ENOSPC — inotify watchers exhausted.\n" +
							"  Fix (run once as sudo):\n" +
							"    echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-watch.conf\n" +
							"    sudo sysctl --system",
					);
					} else {
						logToFile("[pi-harness] cookie-sanitizer:", msg);
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
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		if (msg.includes("ENOSPC")) {
			logToFile(
				"[pi-harness] cookie-sanitizer watcher: ENOSPC — " +
					"inotify watcher limit reached.\n" +
					"Fix (once, as root):\n" +
					"  echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/99-watch.conf\n" +
					"  sudo sysctl --system\n" +
					"Drop folder sync still works — polling will resume automatically.",
			);
		} else {
			logToFile("[pi-harness] cookie-sanitizer watcher failed to start:", msg);
		}
	}

	// Store only the setStatus function, NOT the ctx itself.
	// Storing ctx causes stale-context errors after pi reload/restart.
	let footerSetStatus: ((key: string, value: string) => void) | null = null;
	// The custom footer needs live session data (cwd, model, usage, context).
	// The ctx is stored here as well, but the footer guards every access and
	// keeps the last known values when the ctx has gone stale, so a replaced
	// session can never break the rendering.
	let latestFooterCtx: ExtensionContext | null = null;
	let harnessFooterEnabled = true;

	/**
	 * Install the harness footer.
	 *
	 * Pi's built-in footer renders ALL `setStatus()` values on ONE shared line,
	 * so the quota and the workspace environment summary used to be appended to
	 * each other (and the workspace summary was truncated away on narrow
	 * terminals). The harness footer gives the workspace summary its own row
	 * while keeping Pi's footer information (cwd/branch, token stats, cost,
	 * context usage, model/thinking state, other extensions' statuses).
	 *
	 * This function never rejects: every access to the (possibly stale) ctx is
	 * guarded and failures are logged.
	 */
	async function installHarnessFooter(ctx: ExtensionContext): Promise<void> {
		try {
			if (!harnessFooterEnabled) return;
			// A stale ctx throws on property access - read it defensively.
			let mode: string | undefined;
			try {
				mode = ctx.mode;
			} catch {
				mode = undefined;
			}
			if (mode !== "tui") return;
			const { createHarnessFooter } = await import(
				"./packages/tui/dist/harness-footer.js"
			);
			ctx.ui.setFooter((tui, theme, footerData) =>
				createHarnessFooter(tui, theme, footerData, {
					getContext: () => latestFooterCtx,
				}),
			);
		} catch (e) {
			logToFile("[pi-harness] harness footer install failed:", String(e));
		}
	}
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
	let lastNotifiedTier: "none" | "warning" | "error" = "none";

	function maybeNotifyContextUsage(ctx: ExtensionContext): void {
		const usage = ctx.getContextUsage();
		const pct = usage?.percent;
		if (pct === null || pct === undefined) return;
		if (pct >= 0.9) return; // proactive compact handles 90%+

		const tier: "none" | "warning" | "error" =
			pct >= TIER_ERROR ? "error" : pct >= TIER_WARNING ? "warning" : "none";

		// Only notify when crossing into a strictly higher tier
		if (tier === "none") {
			lastNotifiedTier = "none";
			return;
		}
		if (
			tier === "warning" &&
			lastNotifiedTier !== "warning" &&
			lastNotifiedTier !== "error"
		) {
			lastNotifiedTier = "warning";
			ctx.ui.notify(
				`Context at ${Math.round(pct * 100)}% — consider condensing`,
				"info",
			);
			return;
		}
		if (tier === "error" && lastNotifiedTier !== "error") {
			lastNotifiedTier = "error";
			ctx.ui.notify(
				`Context at ${Math.round(pct * 100)}% — approaching limit`,
				"warning",
			);
			return;
		}
	}

	function writeMirrorRecord(
		provider: ProviderId,
		record: Omit<import("./mirror.js").ProviderMirrorRecord, "provider">,
	): void {
		// 	"[DEBUG writeMirrorRecord] Writing record for provider:",
		// 	provider,
		// 	"record:",
		// 	JSON.stringify(record),
		// );
		mirrorStore.writeProvider(provider, { ...record, provider });
		if (footerSetStatus) {
			refreshFooterStatus(
				footerSetStatus,
				tracker,
				mirrorStore,
				hasCookieSource,
				() => lastActiveProvider,
			);
		}
	}

	async function hasBrowserProfileAutoFetchSource(): Promise<boolean> {
		try {
			const { getLiveSessionPath, getStatusPath } = await import(
				"./packages/auth/src/minimax-browser-auth.ts"
			);
			return existsSync(getLiveSessionPath()) || existsSync(getStatusPath());
		} catch {
			return false;
		}
	}

	function isMiniMaxModel(modelId: string | null | undefined): boolean {
		return providerFromModelId(modelId) === "minimax";
	}

	/** Active provider for the current/last-seen model. Updated by event handlers. */
	let lastActiveProvider: ProviderId | null = null;

	/** Set the active provider; triggers a footer refresh. */
	function noteActiveProvider(modelId: string | null | undefined): void {
		const p = providerFromModelId(modelId);
		// 	"[DEBUG noteActiveProvider] modelId =",
		// 	modelId,
		// 	"-> provider =",
		// 	p,
		// );
		if (p !== lastActiveProvider) {
			lastActiveProvider = p;
			if (footerSetStatus) {
				refreshFooterStatus(
					footerSetStatus,
					tracker,
					mirrorStore,
					hasCookieSource,
					() => lastActiveProvider,
				);
			}
		}
	}

	function getMiniMaxUsageSince(sinceMs: number): {
		tokens: number;
		requests: number;
	} {
		const records = tracker
			.since(sinceMs)
			.filter((record) => isMiniMaxModel(record.model));
		return {
			tokens: records.reduce(
				(sum, record) => sum + record.input + record.output,
				0,
			),
			requests: records.length,
		};
	}

	async function autoFetchQuotaFromBrowserProfile(
		suppressErrors = false,
	): Promise<MirrorRecord | null> {
		if (!(await hasBrowserProfileAutoFetchSource())) {
			return null;
		}

		try {
			const { scrapeWithExistingProfile } = await import(
				"./packages/auth/src/minimax-browser-auth.ts"
			);
			const status = await scrapeWithExistingProfile({ quiet: true });
			if (
				status.page_url.includes("unified-login") ||
				status.page_url.includes("login")
			) {
				return null;
			}
			const rawText =
				status.usage_lines?.join("\n")?.trim() ||
				status.detected_text_sample?.trim() ||
				"";
			if (!rawText) {
				return null;
			}

			const parsed = parseMiniMaxQuotaText(rawText);
			if (parsed.h5UsedPct === undefined && parsed.weeklyUsedPct === undefined) {
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
		} catch (error) {
			if (!suppressErrors) {
				logToFile(
					"[pi-harness]",
					"Browser-profile quota fetch skipped:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return null;
		}
	}

	async function autoFetchQuota(options?: {
		suppressErrors?: boolean;
	}): Promise<boolean> {
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

		if (!hasCookieSource()) {
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
		} catch (error) {
			if (!suppressErrors) {
				logToFile(
					"[pi-harness]",
					"Quota auto-fetch skipped:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return false;
		}
	}

	/**
	 * Auto-fetch OpenAI quota via ChatGPT Codex analytics.
	 * GPT has WEEKLY-ONLY limits (no 5h window).
	 */
	async function autoFetchOpenAIQuota(options?: {
		suppressErrors?: boolean;
	}): Promise<boolean> {
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
		} catch (error) {
			if (!suppressErrors) {
				logToFile(
					"[pi-harness]",
					"OpenAI quota auto-fetch skipped:",
					error instanceof Error ? error.message : String(error),
				);
			}
			return false;
		}
	}

		/**
	 * Auto-fetch GLM quota via z.ai API.
	 * GLM has both 5h and weekly windows.
	 */
	async function autoFetchGLMQuota(options?: {
		suppressErrors?: boolean;
	}): Promise<boolean> {
		const suppressErrors = options?.suppressErrors === true;

		try {
			const data = await _glmQuotaScraper.fetchUsage();
			if (!data) {
				if (!suppressErrors) {
					logToFile("[pi-harness]", "GLM quota auto-fetch: no data returned");
				}
				return false;
			}

			// Check if 5h quota is exhausted (100% or more used)
			const exhausted = data.h5UsedPct >= 100;

				writeMirrorRecord("glm", {
						synced_at: data.scrapedAt,
						source: "scrape",
						h5_used_pct: data.h5UsedPct,
						h5_resets_at: data.h5ResetsAt,
						h5_resets_at_epoch: data.h5ResetsAtEpoch,
						weekly_used_pct: data.weeklyUsedPct,
						weekly_resets_at: data.weeklyResetsAt,
						weekly_resets_at_epoch: data.weeklyResetsAtEpoch,
						model: data.modelName,
						exhausted,
					});
			return true;
		} catch (error) {
			// Check if this is a 429 quota error
			const errorMsg = error instanceof Error ? error.message : String(error);
			const is429 = errorMsg.includes("1308") || errorMsg.includes("Usage limit reached");

			if (is429) {
				// Extract reset time from error
				const { parseGLMErrorResetTime } = await import("./harness/e2e/glm-quota-scraper.js");
				const resetAt = parseGLMErrorResetTime(errorMsg);
				const resetEpoch = resetAt ? new Date(resetAt).getTime() : undefined;

				writeMirrorRecord("glm", {
						synced_at: new Date().toISOString(),
						source: "scrape",
						exhausted: true,
						limitType: "rate_limit",
						h5_used_pct: 100,
						h5_resets_at_epoch: resetEpoch,
					});

				// Start countdown timer for auto-resume
				if (resetAt && currentSession) {
					const countdown = getGLMQuotaCountdown();
					await countdown.startCountdown(
						currentSession.jobId,
						resetAt,
						mirrorStore,
						currentSession.machine,
					);
					logToFile("[GLM countdown]", `Started - will auto-resume at ${resetAt}`);
				}

				if (!suppressErrors) {
					const resetTime = resetAt
						? `resets at ${new Date(resetAt).toLocaleString()}`
						: "resets soon";
					logToFile("[pi-harness]", `GLM 5h quota exhausted! ${resetTime}`);
				}
				return true;
			}

			if (!suppressErrors) {
				logToFile("[pi-harness]", "GLM quota auto-fetch skipped:", errorMsg);
			}
			return false;
		}
	}

	async function maybeAutoFetchQuota(
		modelId: string | null | undefined,
	): Promise<void> {
		const provider = providerFromModelId(modelId);

		// MiniMax path
		if (provider === "minimax") {
			if (quotaAutoFetchInFlight) return;

			const nowMs = Date.now();
			if (nowMs - lastQuotaAutoFetchAt < MINIMAX_REFRESH_MIN_INTERVAL_MS) {
				return;
			}

			const mirror = mirrorStore.readProvider("minimax");
			const freshness = mirrorStore.freshness(mirror, nowMs);
			const shouldFetchBaseline = !mirror || freshness === "expired";
			const usageSinceSync = getMiniMaxUsageSince(
				mirror?.synced_at ? Date.parse(mirror.synced_at) : 0,
			);
			const shouldFetchFromUsage =
				usageSinceSync.tokens >= MINIMAX_REFRESH_TOKEN_THRESHOLD ||
				usageSinceSync.requests >= MINIMAX_REFRESH_REQUEST_THRESHOLD ||
				(freshness === "stale" && usageSinceSync.requests > 0);

			if (!shouldFetchBaseline && !shouldFetchFromUsage) {
				return;
			}

			quotaAutoFetchInFlight = true;
			lastQuotaAutoFetchAt = nowMs;
			try {
				await autoFetchQuota({ suppressErrors: true });
			} finally {
				quotaAutoFetchInFlight = false;
			}
			return;
		}

		// OpenAI path (GPT has weekly-only limits, no 5h window)
		if (provider === "openai") {
			if (quotaAutoFetchInFlight) return;

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
			} finally {
				quotaAutoFetchInFlight = false;
			}
			return;
		}

		// OpenAI Codex path (uses OAuth tokens from ~/.codex/auth.json)
		if (provider === "openai-codex") {
			if (quotaAutoFetchInFlight) return;


			const nowMs = Date.now();
			if (nowMs - lastOpenAIQuotaFetchAt < OPENAI_REFRESH_MIN_INTERVAL_MS) {
				return;
			}

			// Check if Codex auth file exists
			const codexAuthFile = join(homedir(), ".codex", "auth.json");
			if (!existsSync(codexAuthFile)) {
				return;
			}

			quotaAutoFetchInFlight = true;
			lastOpenAIQuotaFetchAt = nowMs;
			try {
				await autoFetchOpenAIQuota({ suppressErrors: true });
			} finally {
				quotaAutoFetchInFlight = false;
			}
			return;
		}

		// GLM path (z.ai has both 5h and weekly windows)
		if (provider === "glm") {
			if (quotaAutoFetchInFlight) return;

			const nowMs = Date.now();
			if (nowMs - lastGLMQuotaFetchAt < OPENAI_REFRESH_MIN_INTERVAL_MS) {
				return;
			}

			quotaAutoFetchInFlight = true;
			lastGLMQuotaFetchAt = nowMs;
			try {
				await autoFetchGLMQuota({ suppressErrors: true });
			} finally {
				quotaAutoFetchInFlight = false;
			}
			return;
		}

		// Other providers (Anthropic, OpenRouter) - TUI signal path only for now
		return;
	}

	// --- /usage — show full status ---------------------------------------
	pi.registerCommand("usage", {
		description: "Show Codex-style usage status (local + provider mirror)",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const local = aggregateWindows(tracker.all());
			const provider = providerFromModelId(ctx.model?.id ?? null);
			const mirror = provider
				? mirrorStore.readProvider(provider)
				: mirrorStore.read();
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
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const autoFetchAvailable =
				hasCookieSource() || (await hasBrowserProfileAutoFetchSource());
			if (!autoFetchAvailable) {
				ctx.ui.notify(
					"MiniMax cookies not found. Drop any cookie file (Netscape or EditThisCookie JSON) into ~/.pi-harness-runtime/cookies/ — the runtime normalizes it for you. Or run `bun packages/auth/src/run-minimax-auth.ts auth`.",
					"warning",
				);
				return;
			}
			ctx.ui.notify("Fetching quota from MiniMax console...", "info");
			const refreshed = await autoFetchQuota();
			ctx.ui.notify(
				refreshed
					? "Quota refreshed. Run `/usage` to see updated status."
					: "Quota refresh skipped. Check cookie validity or MiniMax auth profile, then run `/usage` again.",
				"info",
			);
		},
	});

	// --- /usage today — focused view -------------------------------------
	pi.registerCommand("usage-today", {
		description: "Show today's usage + 5h window",
		// The handler returns a Promise: the command API of Pi requires one.
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
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
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
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
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const ok = await ctx.ui.confirm(
				"Clear provider mirror?",
				"This will delete ~/.pi/usage-status/mirror.json. Local usage log is preserved.",
			);
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
				ctx.ui.notify(
					"Mirror cleared. The next auto refresh will repopulate it.",
					"info",
				);
				footerSetStatus = ctx.ui.setStatus.bind(ctx.ui);
				refreshFooterStatus(
					footerSetStatus,
					tracker,
					mirrorStore,
					hasCookieSource,
					() => lastActiveProvider,
				);
			} catch (e) {
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
		handler: async (args: string, ctx: ExtensionCommandContext) => {
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

				// Emit JobStarted to Telegram
				await nc("JobStarted", { requirement, jobId });

				// Create task graph using heuristic planner
				const planner = new MasterPlanner();
				const planResult = await planner.createPlan(
					requirement,
					jobId,
					HARNESS_ROOT_DIR,
				);

				if (!planResult.success) {
					ctx.ui.notify(`Failed to create plan: ${planResult.error}`, "error");
					return;
				}

				// Create blackboard
				const blackboard = createBlackboard(
					jobId,
					HARNESS_ROOT_DIR,
					planResult.graph!,
				);

				// Create repair engine
				const repairEngine = new RepairEngine(HARNESS_ROOT_DIR);

				// Store session
				currentSession = {
					jobId,
					requirement,
					machine,
					graph: TaskGraphManager.fromGraph(planResult.graph!),
					blackboard,
					repairEngine,
					createdAt: new Date().toISOString(),
				};

				const taskCount = planResult.graph?.nodes
					? Object.keys(planResult.graph.nodes).length
					: 0;
				ctx.ui.notify(
					`Job ${jobId} created with ${taskCount} tasks.\n` +
						`Requirement: ${requirement}\n\n` +
						`Run /harness status to see tasks, or /harness tasks to list them.`,
					"info",
				);
			} catch (e) {
				// The UI can already be gone. A failing notify must not hide
				// the original error, so the log line is the durable report.
				logToFile("[Harness]", `Error starting harness: ${e}`);
				try {
					ctx.ui.notify(`Error starting harness: ${e}`, "error");
				} catch {
					// The UI is not available; the log line above is the report.
				}
			}
		},
	});

	// --- /harness status — Show harness job status ---------------------
	pi.registerCommand("harness-status", {
		description: "Show current harness job status",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify(
					"No active harness job. Run /harness start <requirement> to begin.",
					"info",
				);
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
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify(
					"No active harness job. Run /harness start <requirement> to begin.",
					"info",
				);
				return;
			}

			const tasks = currentSession.graph.getAllTasks();
			if (tasks.length === 0) {
				ctx.ui.notify(
					"No tasks found. The job may not have been planned yet.",
					"info",
				);
				return;
			}

			const lines = [`Tasks for Job ${currentSession.jobId}`, `${"-".repeat(50)}`];

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
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
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
				const scheduled = scheduleAutoResume(
					"minimax",
					currentSession.machine,
					mirrorStore,
					quotaResumeObserver,
				);
				ctx.ui.notify(
					`Job paused.\n` +
						`Auto-resume at ${scheduled ?? resumeAtIso} (5h quota exhausted).\n` +
						`Run /harness cancel to abort.`,
					"info",
				);
			} else {
				ctx.ui.notify(
					`Job ${currentSession.jobId} paused.\n` +
						`Current status: paused_quota\n` +
						`Run /harness resume to continue.`,
					"info",
				);
			}
		},
	});

	// --- /harness resume — Resume the harness job -----------------------
	pi.registerCommand("harness-resume", {
		description: "Resume a paused harness job",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify("No active harness job to resume.", "info");
				return;
			}

			const checkpoint = currentSession.machine.getCheckpoint();
			if (!checkpoint || checkpoint.status !== "paused_quota") {
				ctx.ui.notify(
					"Job is not paused. Run /harness start to begin a new job.",
					"info",
				);
				return;
			}

			const result = await currentSession.machine.transition("running");
			if (!result.success) {
				ctx.ui.notify(`Failed to resume: ${result.error}`, "error");
				return;
			}

			// Cancel any scheduled auto-resume for this job
			cancelAutoResume(currentSession.jobId);

			ctx.ui.notify(
				`Job ${currentSession.jobId} resumed.\n` +
					`Current status: running\n` +
					`Run /harness status to monitor progress.`,
				"info",
			);
		},
	});

	// --- /harness cancel — Cancel the harness job ----------------------
	pi.registerCommand("harness-cancel", {
		description: "Cancel the current harness job",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!currentSession) {
				ctx.ui.notify("No active harness job to cancel.", "info");
				return;
			}

			const ok = await ctx.ui.confirm(
				`Cancel job ${currentSession.jobId}?`,
				"This will mark the job as cancelled. Task state is preserved but work stops.",
			);

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
			await nc("JobCancelled", { requirement: currentSession.requirement });
			const sessionJobId = currentSession.jobId;
			currentSession = null;

			ctx.ui.notify(
				`Job ${sessionJobId} cancelled.\n` +
					`Run \`/harness start\` to begin a new job.`,
				"info",
			);
		},
	});

	// --- /harness-header — Toggle harness custom header vs built-in Pi header ----
	pi.registerCommand("harness-header", {
		description: "Toggle or restore header: /harness-header [harness|builtin]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (ctx.mode !== "tui") {
				ctx.ui.notify("Header control is only available in TUI mode.", "info");
				return;
			}

			const mode = args.trim().toLowerCase();
			if (mode === "builtin" || mode === "pi") {
				ctx.ui.setHeader(undefined);
				ctx.ui.notify("Built-in Pi header restored.", "info");
			} else if (mode === "harness" || mode === "" || mode === "") {
				const { createHarnessHeader } = await import("./packages/tui/dist/harness-header.js");
				ctx.ui.setHeader((tui, theme) =>
					createHarnessHeader(tui, theme, {
						version: HARNESS_VERSION,
						productName: "Harness",
					}),
				);
				ctx.ui.notify("Harness custom header installed.", "info");
			} else {
				ctx.ui.notify(
					"Usage: /harness-header [harness|builtin]\n" +
					"  harness  — install the Harness half-block logo header (default)\n" +
					"  builtin  — restore Pi's built-in header",
					"info",
				);
			}
		},
	});

	// --- /harness-footer — Toggle harness custom footer vs built-in Pi footer ----
	pi.registerCommand("harness-footer", {
		description: "Toggle or restore footer: /harness-footer [harness|builtin]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			// A stale ctx throws on property access - read it defensively.
			let ctxMode: string | undefined;
			try {
				ctxMode = ctx.mode;
			} catch {
				ctxMode = undefined;
			}
			if (ctxMode !== "tui") {
				ctx.ui.notify("Footer control is only available in TUI mode.", "info");
				return;
			}

			const mode = args.trim().toLowerCase();
			if (mode === "builtin" || mode === "pi") {
				harnessFooterEnabled = false;
				ctx.ui.setFooter(undefined);
				ctx.ui.notify(
					"Built-in Pi footer restored. The workspace summary shares the status line again.",
					"info",
				);
			} else if (mode === "harness" || mode === "") {
				harnessFooterEnabled = true;
				latestFooterCtx = ctx;
				await installHarnessFooter(ctx);
				ctx.ui.notify(
					"Harness custom footer installed. The workspace summary has its own row.",
					"info",
				);
			} else {
				ctx.ui.notify(
					"Usage: /harness-footer [harness|builtin]\n" +
					"  harness  — install the Harness footer (workspace summary on its own row)\n" +
					"  builtin  — restore Pi's built-in footer",
					"info",
				);
			}
		},
	});

	// --- Harness widget state (like Todos extension) -----------------------
	// Learn from Todos extension:
	// - setWidget with placement: "aboveEditor" (fixed above input)
	// - Capture tui.requestRender from factory
	// - Return [] when hidden (removes widget height)
	// - Call requestRender(true) on hide for forced redraw
	// - Tree characters like Todos (├─ └─)
	// - Trailing spacer line for breathing room
	const HARNESS_WIDGET_KEY = "pi-harness-startup";
	let startupVisible = true;
	let harnessTUI: { requestRender: (forced?: boolean) => void } | null = null;
	let harnessWidgetRegistered = false;
	let sessionGeneration = 0;

	startupStatus.onChange = () => harnessTUI?.requestRender();

	function hideHarnessBlock() {
		startupVisible = false;
		harnessTUI?.requestRender(true); // Force redraw like Todos
	}

	function getHarnessLines(width: number): string[] {
		if (!startupVisible || harnessMessages.length === 0) return [];

		const lines: string[] = [];

		// Calculate required width for logo + version
		const versionText = `v${HARNESS_VERSION}`;
		const logoRow2WithVersion = `${HARNESS_LOGO[1]}  ${versionText}`;
		const requiredWidth = Math.max(
			HARNESS_LOGO[0].length, // Top row
			logoRow2WithVersion.length, // Middle row + version
			HARNESS_LOGO[2].length // Bottom row
		);

		// Render logo for wide terminals, fallback for small
		if (width >= requiredWidth) {
			// Wide terminal: render colored logo
			lines.push(`\x1b[0;${HARNESS_LOGO_COLORS[0]}m${HARNESS_LOGO[0]}\x1b[0m`);
			lines.push(`\x1b[0;${HARNESS_LOGO_COLORS[1]}m${HARNESS_LOGO[1]}\x1b[0m  \x1b[2m${versionText}\x1b[0m`);
			lines.push(`\x1b[0;${HARNESS_LOGO_COLORS[2]}m${HARNESS_LOGO[2]}\x1b[0m`);
		} else {
			// Small terminal: use simple heading
			lines.push(truncateToWidth("[pi-harness]", width));
		}

		for (let i = 0; i < harnessMessages.length; i++) {
			const msg = harnessMessages[i];
			const marker = harnessStatusMarker(msg.status);
			const isLast = i === harnessMessages.length - 1;
			const treeChar = isLast ? "└─" : "├─";
			let text = `${treeChar} ${marker} ${msg.label}: ${msg.text}`;
			text = truncateToWidth(text, width);
			lines.push(text);

			// Add fix instructions (indented). Every status can carry them -
			// a "[WAIT]" line that waits for the user must still say what to
			// do.
			if (msg.details && msg.details.length > 0) {
				const indent = isLast ? "   " : "│  ";
				for (const detail of msg.details) {
					lines.push(...renderDetailLines(detail, indent, width));
				}
			}
		}

		// Trailing spacer for breathing room (like Todos)
		lines.push("");

		return lines;
	}


	// --- Footer status (persistent badge) --------------------------------
	pi.on("session_start", async (_event, ctx) => {
		// Capture only the setStatus function, not the ctx
		footerSetStatus = ctx.ui.setStatus.bind(ctx.ui);
		latestFooterCtx = ctx;
		refreshFooterStatus(
			footerSetStatus,
			tracker,
			mirrorStore,
			hasCookieSource,
			() => lastActiveProvider,
		);

		// Give the workspace environment summary its own footer row
		void installHarnessFooter(ctx);

		// Increment session generation to fence late callbacks
		sessionGeneration++;
		const mySession = sessionGeneration;
		startupVisible = true;
		// A new session re-scans the key directory: the user may have created
		// the missing files in the meantime. The relay and LINE lines are
		// owned by the top-level init (not by a channel init), so they can be
		// refreshed here; the lines of the other features are set once per
		// extension load.
		keyFileAudit = null;
		keyFileAuditDone = false;
		reportRelayConfiguration();
		reportLineConfiguration();
		reportExposedKeyFiles();
		// Service states survive session changes; initialization runs once per extension load.
		harnessWidgetRegistered = false; // Reset for new session

		// --- Install harness widget (like Todos with placement: "aboveEditor") -------
		// Use setWidget with placement: "aboveEditor" - fixed above input field
		if (!harnessWidgetRegistered) {
			ctx.ui.setWidget(
				HARNESS_WIDGET_KEY,
				(tui, _theme) => {
					harnessTUI = tui;
					return {
						render: (width: number) => getHarnessLines(width),
						invalidate: () => {},
					};
				},
				{ placement: "aboveEditor" }, // Like Todos!
			);
			harnessWidgetRegistered = true;
				
			harnessTUI?.requestRender();
		} else {
			harnessTUI?.requestRender();
		}

		// Add initial harness message
		addHarnessMessage("Harness Runtime", `v${HARNESS_VERSION} initializing`, "wait");

		// A timeout is not success. Keep accepting late service updates.
		const startupTimeout = setTimeout(() => {
			if (mySession !== sessionGeneration) return;
				addHarnessMessage("Harness Runtime", `v${HARNESS_VERSION} waiting for service initialization`, "warn", [
					"How to fix: Wait for services to initialize or check /tmp/pi-harness.log for errors",
				]);
		}, 5000);
		Promise.allSettled(asyncInitPromises).then((results) => {
			clearTimeout(startupTimeout);
			if (mySession !== sessionGeneration) return;
			// Only mark as degraded for actual ERRORS, not WARNINGS (warns are expected for unconfigured optional services)
			const degraded = results.some((result) => result.status === "rejected") ||
				harnessMessages.some((msg) => msg.label !== "Harness Runtime" && msg.status === "err");
			addHarnessMessage("Harness Runtime",
				`v${HARNESS_VERSION} ${degraded ? "initialized with errors" : "initialized"}`,
				degraded ? "warn" : "ok");
		});
	});

	// Hide harness block on first user input (like [Prompts]/[Extensions] disappear)
	pi.on("message_start", (event) => {
		const msg = event.message as { role?: string };
		if (msg?.role === "user") {
			hideHarnessBlock();
		}
	});

	pi.on("turn_end", (_event, ctx) => {
		noteActiveProvider(ctx.model?.id ?? null);
		// Capture only the setStatus function, not the ctx
		footerSetStatus = ctx.ui.setStatus.bind(ctx.ui);
		latestFooterCtx = ctx;
		refreshFooterStatus(
			footerSetStatus,
			tracker,
			mirrorStore,
			hasCookieSource,
			() => lastActiveProvider,
		);
		void maybeAutoFetchQuota(ctx.model?.id ?? null);
		maybeTriggerProactiveCompact(ctx);
		maybeNotifyContextUsage(ctx);
		// The quality check of the workspace runs after the turn: it never
		// writes and it never steers the session.
		void maybeRunToolingCheck(ctx);
	});

	pi.on("agent_end", () => {
		setTimeout(() => {
			if (!pendingOutputLimitResumeAfterSettled) {
				return;
			}
			pendingOutputLimitResumeAfterSettled = false;
			void queueAutoResume(
				"output-limit-settled",
				OUTPUT_LIMIT_RESUME_PROMPT,
				"followUp",
			);
		}, 0);
	});

	pi.on("session_compact", async (event, ctx) => {
		// Capture only the setStatus function, not the ctx
		footerSetStatus = ctx.ui.setStatus.bind(ctx.ui);
		latestFooterCtx = ctx;
		proactiveCompactInFlight = false;
		lastProactiveCompactAt = Date.now();
		consecutiveCompactFailures = 0;
		proactiveCompactCircuitReported = false;
		refreshFooterStatus(
			footerSetStatus,
			tracker,
			mirrorStore,
			hasCookieSource,
			() => lastActiveProvider,
		);

		const forceOutputLimitResume = pendingOutputLimitResumeAfterCompact;
		pendingOutputLimitResumeAfterCompact = false;

		if (
			!shouldQueuePostCompactionResume(event, ctx.hasPendingMessages(), {
				force: forceOutputLimitResume,
			})
		) {
			return;
		}

		if (forceOutputLimitResume) {
			registerQueuedContinuation(
				POST_COMPACTION_CONTINUATION_ID,
				"the compaction continues the turn",
			);
			await queueAutoResume(
				"post-compact-output-limit",
				OUTPUT_LIMIT_RESUME_PROMPT,
				event.willRetry ? "steer" : "followUp",
			);
			return;
		}

		outputLimitResumeAttempts = 0;
		registerQueuedContinuation(
			POST_COMPACTION_CONTINUATION_ID,
			"the compaction continues the turn",
		);
		// pi.dev expects the literal "resume" command to continue after compaction.
		await queueAutoResume("post-compact", "resume", "followUp");
	});

	// --- Periodic quota refresh every 15 minutes ---
	// `maybeAutoFetchQuota` checks its own rate-limit (MINIMAX_REFRESH_MIN_INTERVAL_MS)
	// so this is safe to call frequently.
	setInterval(() => {
		void maybeAutoFetchQuota(lastActiveProvider ?? null);
		// Also refresh footer status so user sees updated quota data
		if (footerSetStatus) {
			refreshFooterStatus(
				footerSetStatus,
				tracker,
				mirrorStore,
				hasCookieSource,
				() => lastActiveProvider,
			);
		}
	}, MINIMAX_REFRESH_MIN_INTERVAL_MS);

	/**
	 * The reset of the provider that applies to a failure.
	 *
	 * The reset only applies when it is fresh, when it belongs to the same
	 * provider and to the same window as the failure, and when it lies in
	 * the future. A failure that names no window has no window, so no reset
	 * applies to it: the quota row is an observation, not a proof about the
	 * limit that the provider reported.
	 */
	function applicableResetEvidence(
		failure: ProviderFailure,
	): RecoveryResetEvidence | undefined {
		if (!failure.window || !failure.provider) return undefined;
		const mirror = mirrorStore.readProvider(failure.provider.toLowerCase());
		if (!mirror) return undefined;
		if (mirrorStore.freshness(mirror, Date.now()) !== "fresh") return undefined;
		const resetAt =
			failure.window === "weekly"
				? mirror.weekly_resets_at_epoch
				: failure.window === "h5"
					? mirror.h5_resets_at_epoch
					: undefined;
		if (!resetAt || resetAt <= Date.now()) return undefined;
		const observedAt = Date.parse(mirror.synced_at);
		if (!Number.isFinite(observedAt)) return undefined;
		return {
			// The identity of the provider is normalized: the cycle keys its
			// provider in lower case, so an evidence that carries the name
			// as the provider writes it ("MiniMax") must not be discarded by
			// the comparison.
			provider: failure.provider.toLowerCase(),
			window: failure.window,
			resetAt,
			observedAt,
			source: mirror.source,
		};
	}

	async function queueAutoResume(
		reason: string,
		content: string,
		deliverAs: "steer" | "followUp",
	): Promise<void> {
		try {
			pi.sendUserMessage(content, { deliverAs });
			await nc("ResumeScheduled", {
				requirement: "Session auto-resume",
				// A resume trigger is not a failure. It renders as
				// "Trigger: Context compacted", never as "Error: ...".
				trigger: reason,
			});
		} catch (error) {
			logToFile(
				"[pi-harness]",
				`Failed to queue ${reason} auto-resume:`,
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	function maybeTriggerProactiveCompact(ctx: ExtensionContext): void {
		if (proactiveCompactInFlight) {
			return;
		}
		if (consecutiveCompactFailures >= MAX_PROACTIVE_COMPACT_FAILURES) {
			if (!proactiveCompactCircuitReported) {
				proactiveCompactCircuitReported = true;
				logToFile("[pi-harness]", `Proactive compact disabled after ${consecutiveCompactFailures} consecutive failures`);
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

		const compactOptions: CompactOptions = {
			customInstructions:
				"Preserve the current task, recent code changes, pending work, exact next step, and any unresolved errors. This compaction was triggered proactively near the context limit. After compaction, continue seamlessly without asking the user to resume or recap.",
			onComplete: () => {
				proactiveCompactInFlight = false;
				lastProactiveCompactAt = Date.now();
				consecutiveCompactFailures = 0;
				proactiveCompactCircuitReported = false;
				// Emit ContextCompacted to Telegram
				nc("ContextCompacted", {
					requirement: "Session context",
					error: "Proactive compact completed",
				});
			},
			onError: (error) => {
				proactiveCompactInFlight = false;
				consecutiveCompactFailures += 1;
				logToFile("[pi-harness]", "Proactive compact failed:", error.message);
			},
		};
		ctx.compact(compactOptions);
	}
}

// ----------------------------------------------------------------------
// Helper: refresh persistent footer status with one-line summary
// ----------------------------------------------------------------------
function refreshFooterStatus(
	setStatus: (key: string, value: string) => void,
	tracker: UsageTracker,
	mirrorStore: MirrorStore,
	hasCookieSource: () => boolean,
	getActiveProvider: () => ProviderId | null = () => null,
) {
	const nowMs = Date.now();
	const local = aggregateWindows(tracker.all());
	const provider = getActiveProvider();
	const mirror = provider ? mirrorStore.readProvider(provider) : null;
	// 	"[DEBUG refreshFooterStatus] mirror =",
	// 	mirror ? JSON.stringify(mirror) : null,
	// );
	const freshness = mirrorStore.freshness(mirror, nowMs);
	const statusValue = buildFooterStatusValue(local, mirror, freshness, hasCookieSource(), provider);
	// Prepend harness version so it shows in the footer during startup
	setStatus(
		"harness-runtime",
		statusValue,
	);

	// The workspace environment summary is published under its own status key.
	// Pi renders every status value on ONE shared line, so the harness footer
	// (see installHarnessFooter) renders it on a dedicated row instead.
	setWorkspaceEnvStatus(setStatus);
}

/**
 * Set workspace environment status line
 *
 * Published under the `harness-workspace` status key. The harness footer
 * renders it on its own row (Pi's built-in footer joins all status values
 * into a single line).
 */
async function setWorkspaceEnvStatus(setStatus: (key: string, value: string) => void) {
	try {
		const { getWorkspaceEnv, formatEnvStatusLine } = await import("./packages/contracts/dist/workspace-env.js");
		const workspacePath = _piSessionCwd || process.cwd();
		const env = getWorkspaceEnv(workspacePath);
		const statusLine = formatEnvStatusLine(env);
		setStatus("harness-workspace", statusLine);
	} catch (err) {
		// Workspace env detection failed - don't show status line
		logToFile("[WorkspaceEnv]", "Status line failed:", String(err));
	}
}
