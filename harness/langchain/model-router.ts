/**
 * Smart model router — reads the request prompt and decides which model to use
 * for each agent role at runtime. No hardcoded model IDs; all choices are driven
 * by env vars + optional per-request directives in the prompt.
 *
 * Per-request directives (optional — fallback to env defaults if absent):
 *
 *   Planner directive:
 *     [planner: gpt-5.6]   or  [planner: GLM-5.2]   or  [planner: MiniMax-M2]
 *
 *   Reviewer directive (master reviewer — GLM is the design default):
 *     [reviewer: GLM-5.2]  or  [reviewer: GPT-5.6]
 *
 *   Coder directive:
 *     [coder: MiniMax-M2]   or  [coder: gpt-5.6]
 *
 *   Examples in a prompt:
 *     "Implement X   [reviewer: GPT-5.6]  [planner: GLM-5.2]"
 *     "Use GLM as master reviewer for this task"
 *     "GPT as reviewer: please review this code"
 *
 *   The parser is forgiving — these all work:
 *     [reviewer: GLM]        → uses GLM_MODEL from env
 *     [reviewer: gpt]         → uses PLANNER_MODEL from env (same family)
 *     [reviewer: MiniMax]     → uses MINIMAX_MODEL from env
 *
 * Wiki: wiki/multi-agent-langchain.md
 */

/** Matches [role: modelFamily] directives, case-insensitive. */
const DIRECTIVE_RE = /\[(\w+)\s*:\s*(\w[\w-]*)\]/gi;

/** Map from directive family name → env prefix. */
const FAMILY_MAP: Record<string, string> = {
	gpt: "PLANNER",
	glm: "GLM",
	minimax: "MINIMAX",
};

/** Env vars that exist for each prefix. */
const ENVVARS = {
	PLANNER: ["PLANNER_MODEL", "PLANNER_BASE_URL", "PLANNER_API_KEY"],
	GLM: ["GLM_MODEL", "GLM_BASE_URL", "GLM_API_KEY"],
	MINIMAX: ["MINIMAX_MODEL", "MINIMAX_BASE_URL", "MINIMAX_API_KEY"],
};

/** Model options derived from a resolved env prefix. */
export interface ResolvedModel {
	model: string;
	baseURL: string;
	apiKey: string;
}

/** Result of routing a request to models. */
export interface RouteResult {
	planner: ResolvedModel;
	reviewer: ResolvedModel; // master reviewer
	coder: ResolvedModel;
	/** Text of the request with directive comments stripped (safe for agent prompts). */
	cleanRequest: string;
}

/**
 * Resolve a model family to actual env-backed model options.
 * family: "GLM" | "PLANNER" | "MINIMAX" (case-insensitive input)
 */
export function resolveModel(family: string): ResolvedModel {
	const key = FAMILY_MAP[family.toLowerCase()] ?? family.toUpperCase();
	const env = process.env;

	const modelKey = `${key}_MODEL`;
	const baseURLKey = `${key}_BASE_URL`;
	const apiKeyKey = `${key}_API_KEY`;

	const model = env[modelKey];
	const baseURL = env[baseURLKey];
	const apiKey = env[apiKeyKey];

	if (!apiKey) {
		throw new Error(
			`${apiKeyKey} is not set. Set it in .env (see .env.example).`,
		);
	}
	if (!model) {
		throw new Error(
			`${modelKey} is not set. Set it in .env (e.g. ${modelKey}="GLM-5.2").`,
		);
	}
	if (!baseURL) {
		throw new Error(
			`${baseURLKey} is not set. Set it in .env (e.g. ${baseURLKey}="https://api.z.ai/api/v1").`,
		);
	}

	return { model, baseURL, apiKey };
}

/**
 * Route a request prompt to the correct model configuration.
 *
 * Algorithm:
 * 1. Extract [role: family] directives from the prompt
 * 2. Resolve each family to actual env-backed model options
 * 3. Apply defaults (planner→PLANNER, reviewer→GLM, coder→MINIMAX)
 * 4. Strip directive comments from the request before passing to agents
 */
export function routeRequest(request: string): RouteResult {
	const directives = new Map<string, string>();
	let clean = request;

	// Extract and strip directives
	let match: RegExpExecArray | null;
	const re = new RegExp(DIRECTIVE_RE.source, "gi");
	while ((match = re.exec(request)) !== null) {
		const [, role, family] = match;
		directives.set(role.toLowerCase(), family.toLowerCase());
	}
	// Remove directive lines/comments from the prompt
	clean = request.replace(DIRECTIVE_RE, "").trim();

	// Resolve each role
	const plannerFamily = directives.get("planner") ?? "gpt";
	const reviewerFamily = directives.get("reviewer") ?? "glm";
	const coderFamily = directives.get("coder") ?? "minimax";

	return {
		planner: resolveModel(plannerFamily),
		reviewer: resolveModel(reviewerFamily),
		coder: resolveModel(coderFamily),
		cleanRequest: clean,
	};
}

/** Also match natural-language hints in the request. */
const NATURAL_HINTS: Array<[RegExp, string, string]> = [
	// Reviewer hints
	[/\bGLM\s+as\s+(master\s+)?reviewer\b/gi, "reviewer", "glm"],
	[/\bGPT\s+as\s+(master\s+)?reviewer\b/gi, "reviewer", "gpt"],
	[/\[reviewer:\s*GLM\]/gi, "reviewer", "glm"],
	[/\[reviewer:\s*GPT\]/gi, "reviewer", "gpt"],
	// Planner hints
	[/\bGPT\s+as\s+planner\b/gi, "planner", "gpt"],
	[/\bGLM\s+as\s+planner\b/gi, "planner", "glm"],
	[/\[planner:\s*GLM\]/gi, "planner", "glm"],
	[/\[planner:\s*GPT\]/gi, "planner", "gpt"],
	// Coder hints
	[/\bMiniMax\s+as\s+coder\b/gi, "coder", "minimax"],
	[/\bGPT\s+as\s+coder\b/gi, "coder", "gpt"],
	[/\[coder:\s*MiniMax\]/gi, "coder", "minimax"],
	[/\[coder:\s*GPT\]/gi, "coder", "gpt"],
];

/**
 * Route a request, also scanning natural-language hints.
 * Directives ([role: family]) take precedence over natural hints.
 */
export function routeRequestSmart(request: string): RouteResult {
	const directives = new Map<string, string>();
	const hints = new Map<string, string>();
	let clean = request;

	// 1. Extract [role: family] directives
	let match: RegExpExecArray | null;
	const re = new RegExp(DIRECTIVE_RE.source, "gi");
	while ((match = re.exec(request)) !== null) {
		const [, role, family] = match;
		directives.set(role.toLowerCase(), family.toLowerCase());
	}
	clean = request.replace(DIRECTIVE_RE, "").trim();

	// 2. Scan for natural-language hints
	for (const [pattern, role, family] of NATURAL_HINTS) {
		if (!hints.has(role) && pattern.test(request)) {
			hints.set(role, family);
		}
	}

	// 3. Merge: directives override hints, hints fill gaps
	const getRole = (role: string, def: string) =>
		directives.get(role) ?? hints.get(role) ?? def;

	return {
		planner: resolveModel(getRole("planner", "gpt")),
		reviewer: resolveModel(getRole("reviewer", "glm")),
		coder: resolveModel(getRole("coder", "minimax")),
		cleanRequest: clean,
	};
}
