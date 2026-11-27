/**
 * The configuration of the Frappe policy.
 *
 * Two things decide what a Frappe operation may do, and both of them come
 * from the owner of the workspace:
 *
 * - the rule of the project: it asks for the approval of the human, it
 *   asks for a confirmation, or it allows the operation that a permission
 *   covers,
 * - the permission that stands: a scoped permission that covers the
 *   operations of one site, one app or one effect.
 *
 * The rule and the permission are read from the environment of the
 * session, so an operator can change them without a change of the code. A
 * value that cannot be read is no value: an unknown rule and an invalid
 * permission leave the policy as it was, so a typo never opens an
 * operation that the human did not open.
 *
 * The permission that stands is never invented here. Without the
 * environment the policy has no rule and no permission, and every
 * operation that changes a site asks the human.
 */

import type {
	FrappeOperationAuthorization,
	FrappeOperationEffect,
} from "./frappe-lifecycle-policy.ts";

/** The rules that the project may set. */
export type FrappeProjectRule = "require-approval" | "confirm" | "allow";

/** The rules that the configuration accepts. */
export const FRAPPE_PROJECT_RULES: FrappeProjectRule[] = [
	"require-approval",
	"confirm",
	"allow",
];

/** The effects that a permission may cover. */
export const FRAPPE_EFFECTS: FrappeOperationEffect[] = [
	"native-source",
	"customization",
	"data-migration",
	"destructive",
	"read-only",
	"unknown",
];

/** The name of the variable that names the rule of the project. */
export const FRAPPE_PROJECT_RULE_ENV = "PI_FRAPPE_PROJECT_RULE";

/** The name of the variable that holds the permission that stands. */
export const FRAPPE_STANDING_GRANT_ENV = "PI_FRAPPE_STANDING_GRANT";

/** The configuration of the policy. */
export interface FrappePolicyConfig {
	/** The rule of the project, when one is configured. */
	projectRule?: FrappeProjectRule;
	/** The permission that stands, when one is configured. */
	standingGrant?: FrappeOperationAuthorization;
}

/**
 * The rule of the project.
 *
 * An unknown rule is no rule: the policy falls back to asking the human,
 * which is the safe answer.
 */
export function readFrappeProjectRule(
	value: string | undefined,
): FrappeProjectRule | undefined {
	const raw = (value ?? "").trim().toLowerCase();
	if (!raw) return undefined;
	return FRAPPE_PROJECT_RULES.find((rule) => rule === raw);
}

/**
 * The permission that stands.
 *
 * The permission is scoped: it names what it covers, and the site, the app
 * and the effects it is limited to. A permission without a scope covers
 * nothing, so it is refused here instead of being used as a general
 * permission.
 */
export function readFrappeStandingGrant(
	value: string | undefined,
): FrappeOperationAuthorization | undefined {
	const raw = (value ?? "").trim();
	if (!raw) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object") return undefined;
	return grantOf(parsed as Record<string, unknown>);
}

/**
 * The permission of a parsed record.
 *
 * The permission is scoped: it names what it covers, and the site, the app
 * and the effects it is limited to. A permission without a scope covers
 * nothing, so it is refused instead of being used as a general permission.
 */
function grantOf(
	record: Record<string, unknown>,
): FrappeOperationAuthorization | undefined {
	const scope = textOf(record.scope);
	if (!scope) return undefined;
	const effects = effectsOf(record.effects);
	if (record.effects !== undefined && !effects) {
		// A permission that names an effect that does not exist covers
		// nothing: it is refused instead of being read as a general
		// permission.
		return undefined;
	}
	const expiresAt = numberOf(record.expiresAt);
	const site = textOf(record.site);
	const app = textOf(record.app);
	return {
		source: "standing",
		scope,
		...(site ? { site } : {}),
		...(app ? { app } : {}),
		...(effects ? { effects } : {}),
		...(expiresAt !== undefined ? { expiresAt } : {}),
	};
}

/**
 * The effects of a permission.
 *
 * Every effect of the list has to be a known effect. A list with an
 * unknown effect is refused: a permission that names something that does
 * not exist covers nothing.
 */
function effectsOf(value: unknown): FrappeOperationEffect[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) return undefined;
	const effects: FrappeOperationEffect[] = [];
	for (const effect of value) {
		if (typeof effect !== "string") return undefined;
		if (!FRAPPE_EFFECTS.includes(effect as FrappeOperationEffect)) return undefined;
		effects.push(effect as FrappeOperationEffect);
	}
	return effects.length > 0 ? effects : undefined;
}

/** A text of a record, without the spaces around it. */
function textOf(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}

/** A number of a record, when it is one. */
function numberOf(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The configuration of the policy of the session.
 */
export function readFrappePolicyConfig(
	env: Record<string, string | undefined> = process.env,
): FrappePolicyConfig {
	const projectRule = readFrappeProjectRule(env[FRAPPE_PROJECT_RULE_ENV]);
	const standingGrant = readFrappeStandingGrant(env[FRAPPE_STANDING_GRANT_ENV]);
	return {
		...(projectRule ? { projectRule } : {}),
		...(standingGrant ? { standingGrant } : {}),
	};
}
