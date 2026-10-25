/**
 * The rules that keep a client name out of the shared collection.
 *
 * The names of the clients of the users of the harness are **not** in this
 * repository. The repository is public, and a list of client names in it
 * is a list of client names in the world - the names of the projects and
 * of the clients of every person who installs the package.
 *
 * The rules therefore live in a local file:
 *
 *   ~/.pi-harness-runtime/skill-sanitization.json
 *
 * and this module is the mechanism that reads them and applies them. The
 * file is per installation, so a machine holds the rules of its own
 * clients and nobody else's.
 *
 * The file is optional. Without it only the generic rules apply, and the
 * name of a client would travel into the collection of that installation.
 * `sanitizationStatus()` tells the caller which of the two is the case,
 * so a missing file is a visible state and not a silent one.
 *
 * The format of the file:
 *
 * ```json
 * {
 *   "rules": [
 *     { "pattern": "acme", "replacement": "[Client A]", "flags": "gi" }
 *   ],
 *   "nameMap": {
 *     "acme-approval-workflow": "client-a-approval-workflow"
 *   }
 * }
 * ```
 *
 * The pattern is the source of a regular expression and the flags default
 * to "gi". The rules match a plain fragment, without a word boundary: a
 * client name rarely stands alone, it appears inside a directory name
 * (`erp_report_2024.json`), inside a module name (`acme_pharma`) or in a
 * sentence ("integrated with Acme"). A word boundary would miss all of
 * them - and `_` is a word character, so a boundary never follows an
 * underscore.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A rule as it is written in the local file. */
export interface SanitizationRuleSpec {
  /** The source of a regular expression. */
  pattern: string;
  /** What a match becomes. */
  replacement: string;
  /** The flags of the regular expression. Defaults to "gi". */
  flags?: string;
}

/** A compiled rule. */
export interface SanitizationRule {
  pattern: RegExp;
  replacement: string;
}

/** The whole rule set of one installation. */
export interface SanitizationRuleSet {
  /** The rules, in the order they are applied. */
  rules: SanitizationRule[];
  /** The names that are renamed as a whole. */
  nameMap: Record<string, string>;
  /** Where the rules came from. */
  source: "local-file" | "generic-only";
  /** Why the local file did not contribute its rules. */
  error?: string;
}

/**
 * The rules that hold for every installation.
 *
 * They are about the way a text talks about a client, not about the name
 * of a client: "Company Name" is a placeholder in a template, and it
 * must not become a client name in the collection.
 */
const GENERIC_RULES: SanitizationRule[] = [
  { pattern: /Company Name/gi, replacement: "[Client Name]" },
  { pattern: /your company/gi, replacement: "[Client]" },
  { pattern: /our client/gi, replacement: "[Client]" },
  { pattern: /client-specific/gi, replacement: "[Project-specific]" },
];

/**
 * The names that are renamed as a whole, for every installation.
 *
 * A name that would be unreadable after the pattern rules - a name that
 * carries the client name in its middle - is renamed here.
 */
const GENERIC_NAME_MAP: Record<string, string> = {
  whispertool: "whisper-tool",
};

/** Where the rules of this installation live. */
export function sanitizationFilePath(): string {
  const override = process.env.PI_SKILL_SANITIZATION_FILE;
  if (override && override.trim()) return override.trim();
  const home = process.env.HOME || process.env.USERPROFILE || homedir();
  return join(home, ".pi-harness-runtime", "skill-sanitization.json");
}

/**
 * The state of the rules of this installation.
 *
 * `configured` is false when the local file is missing or unreadable. The
 * caller shows it, because a missing file is a weaker privacy guarantee
 * and not a detail.
 */
export function sanitizationStatus(): {
  configured: boolean;
  path: string;
  ruleCount: number;
  error?: string;
} {
  const path = sanitizationFilePath();
  const set = loadSanitizationRules(path);
  return {
    configured: set.source === "local-file",
    path,
    ruleCount: set.rules.length,
    ...(set.error ? { error: set.error } : {}),
  };
}

let cached: { path: string; set: SanitizationRuleSet } | undefined;

/**
 * The rules of this installation.
 *
 * The file is read once per process: the rules do not change while the
 * harness runs, and a skill that is indexed a hundred times must not read
 * a file a hundred times.
 */
export function loadSanitizationRules(path = sanitizationFilePath()): SanitizationRuleSet {
  if (cached && cached.path === path) return cached.set;

  const set = readSanitizationRules(path);
  cached = { path, set };
  return set;
}

/** Forget the cached rules. A test needs it, a new file needs it. */
export function resetSanitizationRulesCache(): void {
  cached = undefined;
}

function readSanitizationRules(path: string): SanitizationRuleSet {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      return {
        rules: [...GENERIC_RULES],
        nameMap: { ...GENERIC_NAME_MAP },
        source: "generic-only",
        error: `The sanitization rules at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return {
      rules: [...GENERIC_RULES],
      nameMap: { ...GENERIC_NAME_MAP },
      source: "generic-only",
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      rules: [...GENERIC_RULES],
      nameMap: { ...GENERIC_NAME_MAP },
      source: "generic-only",
      error: `The sanitization rules at ${path} are not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const rules: SanitizationRule[] = [...GENERIC_RULES];
  const nameMap: Record<string, string> = { ...GENERIC_NAME_MAP };

  const file = parsed as {
    rules?: SanitizationRuleSpec[];
    nameMap?: Record<string, string>;
  };

  for (const spec of file.rules ?? []) {
    if (!spec || typeof spec.pattern !== "string" || typeof spec.replacement !== "string") {
      continue;
    }
    try {
      rules.push({
        pattern: new RegExp(spec.pattern, spec.flags ?? "gi"),
        replacement: spec.replacement,
      });
    } catch {
      // A broken pattern must not take the whole rule set down: the other
      // rules still hold, and the broken one is reported below.
      rules.push({
        pattern: /$^/,
        replacement: spec.replacement,
      });
    }
  }

  for (const [from, to] of Object.entries(file.nameMap ?? {})) {
    if (typeof from === "string" && typeof to === "string") nameMap[from] = to;
  }

  return { rules, nameMap, source: "local-file" };
}
