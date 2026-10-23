/**
 * Key file audit - tell the user HOW to fix a missing credential.
 *
 * The startup summary used to say "credentials missing" and left the user
 * guessing which file to create. This module scans the key directory
 * (~/.pi-harness-runtime/keys) and reports, per feature, every credential that
 * is neither in the environment nor in a key file - together with the exact
 * `echo` command that creates the file.
 *
 * A credential is satisfied when
 *   - one of its environment variables is set (and not empty), or
 *   - one of its candidate key files exists and is not empty.
 *
 * The audit never reads or returns a secret value - only file names and the
 * state of a file (missing / empty).
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface KeyRequirement {
	/** Startup label that owns the credential ("Telegram", "Relay", "LINE", "Jev", "Qdrant"). */
	feature: string;
	/** Human readable name of the credential. */
	label: string;
	/** Key files that can hold the credential - any one of them satisfies it. */
	candidates: string[];
	/** Environment variable that can hold the credential instead. */
	env?: string;
	/** Additional environment variables that also satisfy the credential. */
	altEnv?: string[];
	/** The key file the fix command creates. */
	fixFile: string;
	/** Placeholder value used in the fix command. */
	placeholder: string;
	/** Extra fix commands for the alternatives of this credential. */
	alternates?: Array<{ file: string; placeholder: string }>;
	/** Short hint appended to the fix command. */
	hint?: string;
	/**
	 * The minimum number of characters the reader accepts.
	 *
	 * The audit must not call a credential "present" when the running code
	 * would reject it: `packages/skills/src/loader.ts` ignores a key file
	 * with 5 characters or less, `packages/jev-judge/src/index.ts` one with
	 * 10 or less.
	 */
	minLength?: number;
	/**
	 * A check the reader applies to the value.
	 *
	 * The audit must not call a credential present when the runtime would
	 * reject the value: the Telegram allowed-user list needs at least one
	 * parseable id (`harness/telegram-auth.ts` keeps the ids that parse to a
	 * number greater than zero).
	 */
	validate?: (content: string, file?: string) => boolean;
	/**
	 * A stricter check for the ENVIRONMENT value.
	 *
	 * The environment and the key files do not always accept the same
	 * format: RELAY_WS_URL must be a ws:// or wss:// endpoint, while the
	 * telegram-webhook-url.txt file may hold the https URL the ws URL is
	 * derived from.
	 */
	validateEnv?: (content: string) => boolean;
	/**
	 * An optional credential.
	 *
	 * An optional credential is not reported as missing: no startup line
	 * owns it, so a fix command for it would never reach the user. The
	 * audit still knows about it.
	 */
	optional?: boolean;
}

/**
 * The credential inventory.
 *
 * The file names and the environment variables match the places the harness
 * actually reads them from:
 *
 * - `harness/key-loader.ts` (KEY_FILE_MAP) for the credentials the loader
 *   maps into the environment,
 * - `harness/telegram-auth.ts` and `scripts/unified-webhook-server.ts` for
 *   the Telegram and LINE credentials,
 * - `packages/relay/src/relay-endpoint.ts` (RELAY_URL_SOURCES /
 *   RELAY_TOKEN_SOURCES) for the relay endpoint and token.
 *
 * A credential counts as satisfied when the environment variable it is read
 * from is set, or when one of its candidate key files exists and is not
 * empty. Where the runtime reads a credential from the FILE only, no
 * environment variable is listed - the audit must not claim a credential is
 * configured when the extension would still not find it.
 */
export const KEY_REQUIREMENTS: KeyRequirement[] = [
	{
		feature: "Telegram",
		label: "bot token",
		candidates: ["telegram-bot-token.txt"],
		fixFile: "telegram-bot-token.txt",
		placeholder: "<TOKEN>",
		hint: "DM @BotFather -> /newbot",
	},
	{
		feature: "Telegram",
		label: "chat id",
		candidates: ["telegram-chat-id.txt"],
		fixFile: "telegram-chat-id.txt",
		placeholder: "<CHAT_ID>",
		hint: "DM @userinfobot to learn your chat id",
	},
	{
		feature: "Telegram",
		label: "allowed user ids",
		candidates: ["telegram-allowed-users.txt", "telegram-chat-id.txt"],
		env: "TELEGRAM_ALLOWED_USERS",
		fixFile: "telegram-allowed-users.txt",
		placeholder: "<USER_IDS>",
		hint: "comma separated list (a legacy chat id file also works)",
		// The reader keeps the ids that parse to a number greater than zero -
		// a list of garbage satisfies neither the audit nor the runtime.
		validate: (content) =>
			content
				.split(",")
				.map((part) => part.trim())
				.filter(Boolean)
				.some((part) => {
					const id = Number.parseInt(part, 10);
					return !Number.isNaN(id) && id > 0;
				}),
	},
	{
		feature: "Relay",
		label: "auth token",
		candidates: ["relay-auth-token.txt", "telegram-webhook-secret.txt"],
		env: "RELAY_AUTH_TOKEN",
		fixFile: "relay-auth-token.txt",
		placeholder: "<TOKEN>",
		alternates: [{ file: "telegram-webhook-secret.txt", placeholder: "<SECRET>" }],
		hint: "shared by the relay server and the relay client",
	},
	{
		feature: "Relay",
		label: "WebSocket URL",
		candidates: ["relay-ws-url.txt", "telegram-webhook-url.txt"],
		env: "RELAY_WS_URL",
		fixFile: "relay-ws-url.txt",
		placeholder: "<WS_URL>",
		alternates: [{ file: "telegram-webhook-url.txt", placeholder: "<WEBHOOK_URL>" }],
		hint: "the relay URL is derived from the webhook URL",
		// The relay resolver only accepts a ws:// or wss:// endpoint - the
		// webhook URL form (http/https) is only accepted in the
		// telegram-webhook-url.txt file, where the ws URL is derived from.
		validate: (content, file) =>
			file === "telegram-webhook-url.txt"
				? isDerivableWebhookUrl(content.trim())
				: isRelayWsEndpoint(content.trim()),
		// The environment variable always holds the ws endpoint itself.
		validateEnv: (content) => isRelayWsEndpoint(content.trim()),
	},
	{
		feature: "Honcho",
		label: "API key",
		candidates: ["honcho-api-key.txt"],
		fixFile: "honcho-api-key.txt",
		placeholder: "<KEY>",
		hint: "Get key: https://app.honcho.dev/api-keys",
	},
	{
		feature: "LINE",
		label: "channel access token",
		candidates: ["line-access-token.txt"],
		fixFile: "line-access-token.txt",
		placeholder: "<ACCESS_TOKEN>",
	},
	{
		feature: "LINE",
		label: "user id",
		candidates: ["line-user-id.txt"],
		fixFile: "line-user-id.txt",
		placeholder: "<USER_ID>",
	},
	{
		feature: "LINE Webhook",
		label: "channel secret",
		candidates: ["line-channel-secret.txt"],
		fixFile: "line-channel-secret.txt",
		placeholder: "<CHANNEL_SECRET>",
		hint: "only needed on the machine that runs the webhook server",
		// No startup line owns this credential - it is only needed on the
		// host that runs the webhook server - so it must not be reported as
		// missing to every user.
		optional: true,
	},
	{
		feature: "Jev",
		label: "API key",
		candidates: ["typesafe-api-key.txt", "openrouter-api-key.txt", "jev-api-key.txt"],
		env: "TYPESAFE_API_KEY",
		altEnv: ["OPENROUTER_API_KEY"],
		fixFile: "typesafe-api-key.txt",
		placeholder: "<API_KEY>",
		alternates: [
			{ file: "openrouter-api-key.txt", placeholder: "<API_KEY>" },
			{ file: "jev-api-key.txt", placeholder: "<API_KEY>" },
		],
		hint: "one TypeSafe key or one OpenRouter key - never both in one file",
		minLength: 11,
	},
	{
		feature: "Qdrant",
		label: "cluster endpoint",
		candidates: ["qdrant-cluster-url.txt"],
		env: "QDRANT_CLUSTER_ENDPOINT",
		fixFile: "qdrant-cluster-url.txt",
		placeholder: "<CLUSTER_URL>",
		minLength: 6,
	},
	{
		feature: "Qdrant",
		label: "API key",
		candidates: ["qdrant-api-key.txt"],
		env: "QDRANT_API_KEY",
		fixFile: "qdrant-api-key.txt",
		placeholder: "<API_KEY>",
		minLength: 6,
	},
	{
		feature: "Qdrant",
		label: "embedding key",
		candidates: ["openai-api-key.txt"],
		env: "OPENAI_API_KEY",
		fixFile: "openai-api-key.txt",
		placeholder: "<API_KEY>",
		hint: "OpenAI key used to embed the skills",
		// The embedder accepts a TypeSafe or an OpenRouter key as well.
		altEnv: ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"],
		minLength: 6,
	},
	{
		feature: "Paperclip",
		label: "API key",
		candidates: ["paperclip-api-key.txt"],
		env: "PAPERCLIP_API_KEY",
		fixFile: "paperclip-api-key.txt",
		placeholder: "<API_KEY>",
		// The Paperclip integration has no startup line - it only writes a
		// hint to the log file - so the audit must not report it as missing.
		optional: true,
	},
];

export interface MissingCredential {
	requirement: KeyRequirement;
	/** The key file the fix command creates. */
	file: string;
	/**
	 * Why the credential is missing:
	 * - "missing"   = the file does not exist
	 * - "empty"     = it exists but holds nothing
	 * - "too short" = it holds a value the reader ignores (a key file with
	 *                 five characters or less, a Jev key with ten or less)
	 * - "invalid"   = it holds a value the reader rejects (a list of garbage
	 *                 where an id is expected)
	 */
	reason: "missing" | "empty" | "too short" | "invalid";
}

/**
 * Is the value a relay WebSocket endpoint?
 *
 * The relay resolver accepts a plain ws:// or wss:// URL without
 * credentials and without a query string - the same rules the resolver
 * applies (packages/relay/src/relay-endpoint.ts).
 */
function isRelayWsEndpoint(value: string): boolean {
	if (!/^wss?:\/\//i.test(value)) return false;
	// The resolver rejects a URL that carries credentials or a query string.
	if (value.includes("@") || value.includes("?")) return false;
	try {
		const url = new URL(value);
		if (url.protocol !== "ws:" && url.protocol !== "wss:") return false;
		return url.host.length > 0;
	} catch {
		return false;
	}
}

/**
 * Can a WebSocket URL be derived from this webhook URL?
 *
 * The resolver derives the ws URL from any URL that has a host (the
 * scheme decides whether the result is ws:// or wss://).
 */
function isDerivableWebhookUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.host.length > 0;
	} catch {
		return false;
	}
}

export interface KeyFileAuditOptions {
	/** The key directory to scan (e.g. ~/.pi-harness-runtime/keys). */
	keysDir: string;
	/** Environment to inspect (defaults to process.env). */
	env?: Record<string, string | undefined>;
	/** File reader override (used by the tests). */
	readFile?: (path: string) => string | undefined;
	/** Existence check override (used by the tests). */
	exists?: (path: string) => boolean;
}

export interface KeyFileAuditResult {
	/** Every credential that could not be resolved. */
	missing: MissingCredential[];
	/** The unresolved credentials grouped by their owning feature. */
	byFeature: Map<string, MissingCredential[]>;
}

/**
 * Scan the key directory and report every credential that cannot be resolved.
 */
export function auditKeyFiles(options: KeyFileAuditOptions): KeyFileAuditResult {
	const env = options.env ?? process.env;
	const exists = options.exists ?? ((path: string) => existsSync(path));
	const readFile =
		options.readFile ??
		((path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined));

	const missing: MissingCredential[] = [];

	for (const requirement of KEY_REQUIREMENTS) {
		if (requirement.optional) continue;
		const envNames = [requirement.env, ...(requirement.altEnv ?? [])].filter(
			(name): name is string => typeof name === "string" && name.length > 0,
		);
		const envSatisfied = envNames.some((name) => {
			const value = (env[name] ?? "").trim();
			if (!value) return false;
			// The reader applies the same check to the environment value as
			// to the file content: a list of garbage yields no usable id.
			// The environment has its own rule when the requirement defines
			// one (RELAY_WS_URL must be a ws endpoint, while the webhook URL
			// file may hold an https URL).
			const check = requirement.validateEnv ?? requirement.validate;
			if (check && !check(value)) return false;
			return true;
		});
		const minLength = requirement.minLength ?? 1;
		const fileSatisfied = requirement.candidates.some((file) => {
			const path = join(options.keysDir, file);
			if (!exists(path)) return false;
			const content = (readFile(path) ?? "").trim();
			// The reader may reject a too short value (a key file with 5
			// characters or less is ignored by the skills loader) - the audit
			// must not call such a credential present.
			if (content.length < minLength) return false;
			// The reader may also reject the value itself (an allowed-user
			// list of garbage yields no usable id).
			if (requirement.validate && !requirement.validate(content, file)) return false;
			return true;
		});

		if (envSatisfied || fileSatisfied) {
			continue;
		}

		const fixPath = join(options.keysDir, requirement.fixFile);
		const fixContent = exists(fixPath) ? (readFile(fixPath) ?? "").trim() : "";
		let reason: MissingCredential["reason"] = "missing";
		if (exists(fixPath)) {
			if (fixContent.length === 0) {
				reason = "empty";
			} else if (fixContent.length < minLength) {
				// The reader ignores a value that is too short.
				reason = "too short";
			} else if (requirement.validate && !requirement.validate(fixContent, requirement.fixFile)) {
				reason = "invalid";
			}
		}
		missing.push({
			requirement,
			file: requirement.fixFile,
			reason,
		});
	}

	const byFeature = new Map<string, MissingCredential[]>();
	for (const entry of missing) {
		const list = byFeature.get(entry.requirement.feature) ?? [];
		list.push(entry);
		byFeature.set(entry.requirement.feature, list);
	}

	return { missing, byFeature };
}

/** The key directory as it is shown to the user (~ instead of the home path). */
export function displayKeysDir(keysDir: string): string {
	const home = homedir();
	return keysDir.startsWith(home) ? join("~", keysDir.slice(home.length)) : keysDir;
}

/**
 * The exact command that creates the missing key file.
 *
 * The placeholder is deliberately generic - the real value never reaches the
 * startup summary, the log or the screen.
 */
export function formatKeyFileFix(
	entry: MissingCredential,
	keysDir: string,
	file = entry.file,
	placeholder = entry.requirement.placeholder,
): string {
	const command = `echo "${placeholder}" > ${join(displayKeysDir(keysDir), file)}`;
	// The reason only belongs to the primary file: an alternate file that
	// does not exist yet is simply missing, not empty.
	if (file === entry.file && entry.reason !== "missing") {
		// The command replaces the content of the file - the user has to
		// know that the value that is in there now is overwritten.
		const note =
			entry.reason === "empty"
				? "# the file exists but is empty - the command replaces it"
				: "# the file exists but the value is not accepted - the command replaces it";
		return `${command}   ${note}`;
	}
	return command;
}

/**
 * The missing credentials of one feature, optionally narrowed to some labels.
 *
 * `labels` narrows the result to specific credentials (e.g. only the bot token
 * and the chat id for a Telegram that is not configured yet).
 */
export function selectKeyFileFixes(
	audit: KeyFileAuditResult | null,
	feature: string,
	labels?: string[],
): MissingCredential[] {
	const entries = audit?.byFeature.get(feature);
	if (!entries) return [];
	if (!labels) return entries;
	return entries.filter((entry) => labels.includes(entry.requirement.label));
}

/**
 * The fix commands for a set of missing credentials, ready to be shown as
 * startup details.
 *
 * Returns an empty array when nothing is missing.
 */
export function formatKeyFileFixes(
	entries: MissingCredential[] | undefined,
	keysDir: string,
): string[] {
	if (!entries || entries.length === 0) return [];
	const fixes: string[] = [];
	const seenFiles = new Set<string>();
	const seenHints = new Set<string>();
	for (const entry of entries) {
		const commands: Array<{ file: string; command: string }> = [];
		// The hint explains WHERE the credential comes from - it is a prose
		// line, not a command.
		const hint = entry.requirement.hint;
		if (hint && !seenHints.has(hint)) {
			seenHints.add(hint);
			fixes.push(hint);
		}
		commands.push({ file: entry.file, command: formatKeyFileFix(entry, keysDir) });
		for (const alternate of entry.requirement.alternates ?? []) {
			commands.push({
				file: alternate.file,
				command: formatKeyFileFix(entry, keysDir, alternate.file, alternate.placeholder),
			});
		}
		for (const { file, command } of commands) {
			// One fix per key file: a credential whose fix file is also the
			// fix file of another credential must not be listed twice.
			if (seenFiles.has(file)) continue;
			seenFiles.add(file);
			fixes.push(command);
		}
	}
	return fixes;
}

/**
 * The fix commands of a feature, computed from the requirement list alone.
 *
 * This is the fallback for the case where the audit cannot answer - the
 * credential is then known to be missing (the runtime found it missing) but
 * the audit has nothing to say about it (a key file that is present but too
 * short for the reader, or a failed audit).
 */
export function fallbackKeyFileFixes(
	feature: string,
	labels: string[],
	keysDir: string,
	options?: { exists?: (path: string) => boolean; readFile?: (path: string) => string | undefined },
): string[] {
	const exists = options?.exists ?? ((path: string) => existsSync(path));
	const readFile = options?.readFile ?? ((path: string) => (existsSync(path) ? readFileSync(path, "utf8") : undefined));
	const fixes: string[] = [];
	const seenFiles = new Set<string>();
	for (const requirement of KEY_REQUIREMENTS) {
		if (requirement.feature !== feature) continue;
		if (labels.length > 0 && !labels.includes(requirement.label)) continue;
		if (seenFiles.has(requirement.fixFile)) continue;
		seenFiles.add(requirement.fixFile);
		const path = join(keysDir, requirement.fixFile);
		const present = exists(path) && (readFile(path) ?? "").trim().length > 0;
		if (present) {
			// The credential is in place but the runtime could not use it.
			// Overwriting it with a placeholder would destroy a working
			// secret - point at the file instead.
			fixes.push(
				`The file exists - check its value: ${join(displayKeysDir(keysDir), requirement.fixFile)}`,
			);
			continue;
		}
		fixes.push(
			formatKeyFileFix(
				{ requirement, file: requirement.fixFile, reason: "missing" },
				keysDir,
			),
		);
	}
	return fixes;
}
