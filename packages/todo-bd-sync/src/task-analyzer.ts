/**
 * Smart Auto-Todo Task Analyzer
 *
 * Decides when to automatically create bd issues based on:
 * 1. Task complexity signals
 * 2. Session state (pending task count)
 *
 * Philosophy:
 * - Simple tasks (grep, quick edit) -> NO todo (avoid noise)
 * - Complex tasks OR multiple pending tasks -> AUTO-CREATE todo
 */

import { getOpenBdIssues } from "./sync.js";

// ─── Complexity Signals ─────────────────────────────────────────────────────────

interface TaskSignals {
	/** Estimated number of steps required */
	stepCount: number;
	/** Number of files likely involved */
	fileCount: number;
	/** Requires research (web search, docs lookup) */
	needsResearch: boolean;
	/** Creates new files */
	createsFiles: boolean;
	/** User explicitly says task is complex */
	explicitlyComplex: boolean;
	/** Likely to have subtasks discovered during work */
	likelySubtasks: boolean;
}

const COMPLEX_KEYWORDS = [
	"complicated",
	"complex",
	"tricky",
	"difficult",
	"refactor",
	"architecture",
	"design",
	"implement from scratch",
	"rewrite",
	"investigate",
	"debug",
	"fix the bug",
	"performance",
];

const RESEARCH_KEYWORDS = [
	"search",
	"look up",
	"find",
	"research",
	"check",
	"verify",
	"how to",
	"best practice",
	"compare",
	"evaluate",
	"review",
];

const SUBTASK_KEYWORDS = [
	"also",
	"plus",
	"and also",
	"while you're at it",
	"on top of that",
	"additionally",
	"another thing",
	"don't forget",
	"should also",
];

/**
 * Analyze user request text for complexity signals
 */
export function analyzeTaskSignals(userMessage: string): TaskSignals {
	const lower = userMessage.toLowerCase();

	// Count implied steps from action verbs
	const actionVerbs = [
		"create",
		"build",
		"implement",
		"design",
		"setup",
		"configure",
		"migrate",
		"convert",
		"refactor",
		"optimize",
		"fix",
		"update",
		"add",
		"remove",
		"delete",
		"modify",
		"change",
		"replace",
	];
	const stepCount = Math.max(
		1,
		actionVerbs.filter((v) => lower.includes(v)).length,
	);

	// Estimate file count from file paths and extensions
	const filePatterns =
		/[\w-]+\.(ts|js|py|json|md|yaml|yml|tsx|jsx|html|css|sql)/g;
	const fileMatches = userMessage.match(filePatterns) || [];
	const explicitFiles = fileMatches.length;

	// Check for directory patterns
	const dirPatterns =
		/(?:src|lib|packages|apps|components|hooks|utils|api)\/[\w/-]+/g;
	const dirMatches = userMessage.match(dirPatterns) || [];

	// Count "and", "also", "+" for multi-task indicators
	const multiTaskIndicator = (lower.match(/and also|also|\+/g) || []).length;
	const estimatedFiles = Math.max(
		1,
		explicitFiles + dirMatches.length + multiTaskIndicator,
	);

	return {
		stepCount,
		fileCount: estimatedFiles,
		needsResearch: RESEARCH_KEYWORDS.some((k) => lower.includes(k)),
		createsFiles:
			lower.includes("create") ||
			lower.includes("add") ||
			lower.includes("new"),
		explicitlyComplex: COMPLEX_KEYWORDS.some((k) => lower.includes(k)),
		likelySubtasks:
			SUBTASK_KEYWORDS.some((k) => lower.includes(k)) ||
			multiTaskIndicator >= 2,
	};
}

// ─── Decision Logic ───────────────────────────────────────────────────────────

export interface AutoTodoDecision {
	shouldCreate: boolean;
	reason: string;
	confidence: "high" | "medium" | "low";
	skipReason?: string;
}

/**
 * Decide whether to auto-create a todo for the given task
 */
export function decideAutoTodo(
	userMessage: string,
	options: {
		forceMode?: boolean;
		skipMode?: boolean;
	} = {},
): AutoTodoDecision {
	const signals = analyzeTaskSignals(userMessage);
	const pendingTasks = getOpenBdIssues().filter((i) => i.status !== "closed");
	const pendingCount = pendingTasks.length;

	// ── Skip Conditions ────────────────────────────────────────────────────
	// Never create todos for these

	const simplePatterns = [
		/^simply\s/i,
		/^just\s/i,
		/^quick\s/i,
		/^can you\s+(grep|find|cat|ls|echo)/i,
		/^(grep|find|cat|ls)\s+[\w.-]+/i,
		/^what('s| is) the\s+\w+\s+\?$/i,
		/^how do i\s+\w+\s*\?$/i,
	];

	if (simplePatterns.some((p) => p.test(userMessage.trim()))) {
		return {
			shouldCreate: false,
			reason: "Simple request (lookup/one-liner)",
			confidence: "high",
			skipReason: "Task is too simple to warrant tracking",
		};
	}

	// Check for trivial single actions with no complexity (lower threshold)
	// Allow more tasks to be tracked - being conservative about NOT tracking
	const isTrivial =
		signals.stepCount === 1 &&
		signals.fileCount <= 1 &&
		!signals.needsResearch &&
		!signals.createsFiles &&
		!signals.explicitlyComplex &&
		pendingCount === 0 &&
		!signals.likelySubtasks;
	if (isTrivial) {
		return {
			shouldCreate: false,
			reason: "Trivial request (single action)",
			confidence: "high",
			skipReason: "Task is trivial",
		};
	}

	// ── Force Modes ──────────────────────────────────────────────────────
	if (options.forceMode) {
		return {
			shouldCreate: true,
			reason: "Force mode enabled",
			confidence: "high",
		};
	}

	if (options.skipMode) {
		return {
			shouldCreate: false,
			reason: "Skip mode enabled",
			confidence: "high",
			skipReason: "User requested skip",
		};
	}

	// ── Auto-Create Conditions ──────────────────────────────────────────
	// Be MORE aggressive about tracking tasks - default to tracking
	const reasons: string[] = [];

	// HIGH CONFIDENCE: Task explicitly complex
	if (signals.explicitlyComplex) {
		reasons.push("explicitly complex");
	}

	// HIGH CONFIDENCE: Multiple steps (lower from 3 to 2)
	if (signals.stepCount >= 2) {
		reasons.push(`${signals.stepCount} steps implied`);
	}

	// HIGH CONFIDENCE: Multiple files (lower from 3 to 2)
	if (signals.fileCount >= 2) {
		reasons.push(`${signals.fileCount} files involved`);
	}

	// MEDIUM CONFIDENCE: Research needed
	if (signals.needsResearch) {
		reasons.push("needs research");
	}

	// MEDIUM CONFIDENCE: Creates files
	if (signals.createsFiles) {
		reasons.push("creates files");
	}

	// MEDIUM CONFIDENCE: Likely subtasks
	if (signals.likelySubtasks) {
		reasons.push("likely has subtasks");
	}

	// MEDIUM CONFIDENCE: Has pending tasks already (session busy)
	if (pendingCount >= 1) {
		reasons.push(`${pendingCount} pending tasks`);
	}

	// Default to creating todo if any signal present
	// Be conservative only for truly trivial requests (already filtered above)
	if (reasons.length === 0) {
		// No strong signals but not trivial either - track it anyway
		reasons.push("multi-step task detected");
	}

	// Create todo if ANY reason OR any pending tasks
	const shouldCreate = reasons.length >= 1 || pendingCount >= 1;

	return {
		shouldCreate,
		reason: reasons.join(", "),
		confidence: reasons.length >= 2 ? "high" : "medium",
	};
}

// ─── Quick Score ─────────────────────────────────────────────────────────────

/**
 * Quick numeric score (0-100) for task complexity
 * Higher = more likely to need a todo
 */
export function getTaskComplexityScore(userMessage: string): number {
	const signals = analyzeTaskSignals(userMessage);
	const pendingTasks = getOpenBdIssues().filter((i) => i.status !== "closed");

	let score = 0;

	// Step count (0-25)
	score += Math.min(25, signals.stepCount * 8);

	// File count (0-20)
	score += Math.min(20, signals.fileCount * 5);

	// Research needed (0-15)
	if (signals.needsResearch) score += 15;

	// Creates files (0-10)
	if (signals.createsFiles) score += 10;

	// Explicitly complex (0-20)
	if (signals.explicitlyComplex) score += 20;

	// Likely subtasks (0-10)
	if (signals.likelySubtasks) score += 10;

	// Pending task overload (0-25)
	const pendingCount = pendingTasks.length;
	if (pendingCount >= 3) score += 25;
	else if (pendingCount >= 2) score += 15;
	else if (pendingCount >= 1) score += 5;

	return Math.min(100, score);
}
