/**
 * Secret redaction for log records.
 *
 * Two independent layers, because either one alone leaks:
 *   1. Key based - a field named `apiKey` is replaced wholesale.
 *   2. Value based - a secret embedded in free text (`Bearer abc...`) is
 *      replaced even when the key name is innocuous.
 *
 * The rules are intentionally conservative: over-redacting a log line is
 * cheap, leaking a credential is not.
 */

/**
 * The redacted shape of a log value. Everything that leaves the process is
 * JSON, so the redactor is typed against JSON instead of `unknown`.
 */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

export interface RedactionOptions {
	/** Longest string kept verbatim before truncation. Default 2000. */
	maxStringLength?: number;
	/** Maximum nesting depth kept. Default 5. */
	maxDepth?: number;
	/** Maximum number of keys kept per object. Default 50. */
	maxKeys?: number;
	/** Maximum number of items kept per array. Default 20. */
	maxArrayItems?: number;
	/** Placeholder written instead of a redacted value. */
	placeholder?: string;
}

const DEFAULT_PLACEHOLDER = "[REDACTED]";

/**
 * Key names that always hold a secret. Matched as a whole token after the
 * key is split on non-alphanumerics and camelCase boundaries.
 */
const SECRET_KEY_TOKENS = new Set([
	"password",
	"passwd",
	"passphrase",
	"secret",
	"secrets",
	"token",
	"tokens",
	"apikey",
	"apisecret",
	"authorization",
	"auth",
	"credential",
	"credentials",
	"privatekey",
	"cookie",
	"setcookie",
	"sessionkey",
	"accesskey",
	"secretaccesskey",
	"refreshtoken",
	"bearertoken",
	"signature",
	"otp",
	"pin",
	"mfa",
	"totp",
]);

/**
 * Key names whose VALUE is sensitive even though the key itself is not a
 * credential: prompts, raw model output and embeddings must never leave the
 * machine in a log line.
 */
const SENSITIVE_VALUE_TOKENS = new Set([
	"content",
	"raw",
	"prompt",
	"prompts",
	"messages",
	"embedding",
	"embeddings",
	"vector",
	"vectors",
	"body",
	"chatid",
	"payload",
	"transcript",
]);

/**
 * Value patterns that look like credentials wherever they appear.
 * Order matters: the more specific patterns run first.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
	// Authorization headers and bearer tokens.
	/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
	// JWT.
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
	// OpenAI / Anthropic style keys.
	/\bsk-[A-Za-z0-9_-]{12,}/g,
	// AWS access key ids.
	/\bAKIA[0-9A-Z]{12,}/g,
	// GitHub / Slack / Stripe style tokens.
	/\bgh[pousr]_[A-Za-z0-9]{16,}/g,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
	// Cloudflare R2 style secret keys (long base64-ish runs).
	/\b[A-Za-z0-9_-]{40,}\b/g,
];

/**
 * `key = value` assignments of a credential-looking key. The key prefix is
 * preserved, only the value is replaced.
 */
const SECRET_ASSIGNMENT_PATTERN =
	/\b((?:api[_-]?key|apikey|access[_-]?key|secret[_-]?key|secret|token|password|passwd|authorization)\s*[:=]\s*)("?)([^\s"',;}]{4,})\2/gi;

/** Split a key into lowercase tokens (`apiKey` -> `api`, `key`). */
export function splitKeyTokens(key: string): string[] {
	return key
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean)
		.map((part) => part.toLowerCase());
}

/** True when the key itself identifies a secret. */
export function isSecretKey(key: string): boolean {
	const tokens = splitKeyTokens(key);
	if (tokens.some((token) => SECRET_KEY_TOKENS.has(token))) return true;
	// Compound names such as `openaiApiKey` or `r2_secret_access_key`.
	const joined = tokens.join("");
	return (
		joined.includes("apikey") ||
		joined.includes("secretaccesskey") ||
		joined.includes("privatekey") ||
		joined.includes("accesstoken") ||
		joined.includes("authtoken")
	);
}

/** True when the key holds content that must not be logged verbatim. */
export function isSensitiveValueKey(key: string): boolean {
	const tokens = splitKeyTokens(key);
	return tokens.some((token) => SENSITIVE_VALUE_TOKENS.has(token));
}

/** Replace credential-looking substrings inside a free-text value. */
export function redactText(text: string, placeholder = DEFAULT_PLACEHOLDER): string {
	let result = text;

	for (const pattern of SECRET_VALUE_PATTERNS) {
		// The regexes are global, so `lastIndex` must be reset per use.
		pattern.lastIndex = 0;
		result = result.replace(pattern, placeholder);
	}

	// `apiKey=abc` keeps the key name, loses the value. This runs last so a
	// credential that was already replaced is not matched a second time.
	SECRET_ASSIGNMENT_PATTERN.lastIndex = 0;
	result = result.replace(SECRET_ASSIGNMENT_PATTERN, `$1${placeholder}`);

	return result;
}

function truncate(text: string, maxLength: number): string {
	if (text.length <= maxLength) return text;
	return `${text.slice(0, maxLength)}...[truncated:${text.length - maxLength}]`;
}

/** Redact an arbitrary value (strings, numbers, objects, arrays). */
export function redactValue(
	value: unknown,
	options: RedactionOptions = {},
	depth = 0,
	keyHint?: string,
): JsonValue {
	const maxStringLength = options.maxStringLength ?? 2000;
	const maxDepth = options.maxDepth ?? 5;
	const maxKeys = options.maxKeys ?? 50;
	const maxArrayItems = options.maxArrayItems ?? 20;
	const placeholder = options.placeholder ?? DEFAULT_PLACEHOLDER;

	if (keyHint && isSecretKey(keyHint)) {
		return placeholder;
	}

	if (value === null || value === undefined) return null;

	switch (typeof value) {
		case "string":
			return truncate(redactText(value, placeholder), maxStringLength);
		case "number":
		case "boolean":
			return value;
		case "bigint":
			return value.toString();
		case "function":
		case "symbol":
			return `[${typeof value}]`;
		default:
			break;
	}

	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) {
		const info: { name: string; message: string; stack?: string } = {
			name: value.name,
			message: redactText(value.message, placeholder),
		};
		if (value.stack) info.stack = redactText(value.stack, placeholder);
		return info;
	}

	if (depth >= maxDepth) return "[MAX_DEPTH]";

	if (Array.isArray(value)) {
		const items = value.slice(0, maxArrayItems).map((item) => redactValue(item, options, depth + 1));
		if (value.length > maxArrayItems) {
			items.push(`[+${value.length - maxArrayItems} more]`);
		}
		return items;
	}

	if (value instanceof Map) {
		const out: Record<string, JsonValue> = {};
		let count = 0;
		for (const [key, item] of value) {
			if (count >= maxKeys) break;
			out[String(key)] = redactValue(item, options, depth + 1, String(key));
			count++;
		}
		return out;
	}

	if (value instanceof Set) {
		return redactValue([...value], options, depth + 1);
	}

	const record = value as Record<string, unknown>;
	const out: Record<string, JsonValue> = {};
	const keys = Object.keys(record);
	for (const key of keys.slice(0, maxKeys)) {
		const item = record[key];
		if (isSecretKey(key)) {
			out[key] = placeholder;
			continue;
		}
		if (isSensitiveValueKey(key)) {
			out[key] = placeholder;
			continue;
		}
		out[key] = redactValue(item, options, depth + 1, key);
	}
	if (keys.length > maxKeys) {
		out["[truncatedKeys]"] = keys.length - maxKeys;
	}
	return out;
}

/** Redact a flat field bag (the `fields` member of a record). */
export function redactFields(
	fields: Record<string, unknown> | undefined,
	options: RedactionOptions = {},
): Record<string, JsonValue> | undefined {
	if (!fields) return undefined;
	return redactValue(fields, options) as Record<string, JsonValue>;
}
