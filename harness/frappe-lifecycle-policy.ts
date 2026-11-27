/**
 * The policy of a Frappe lifecycle operation.
 *
 * A lifecycle operation changes a site of a bench: it installs an app, it
 * migrates a site, it seeds a record, it adds a field to a DocType. The
 * policy decides what may happen, and the decision is explicit:
 *
 * - `execute`: the operation may run now.
 * - `countdown`: the operation may run when the confirmation of the human
 *   expires, but only when a standing policy covers it already.
 * - `approval-required`: the human has to answer before anything runs.
 * - `blocked`: the evidence is not enough to decide, and nothing runs.
 *
 * The decision is deterministic. The place of the routine is evidence, not
 * a permission: a routine in the `commands` directory of the namespace may
 * delete business records, and the directory does not permit it. The
 * elapsed time of a countdown and the confidence of a judge cannot upgrade
 * a missing policy, an unknown site, an unclear effect or an explicit
 * approval rule of the project.
 *
 * The ownership comes first. The mechanism of the operation decides what
 * the operation may do:
 *
 * - the source JSON of a DocType that the app owns: the schema of the
 *   app changes, and Frappe synchronizes it. A field that is native needs
 *   no second installer.
 * - the mechanism of a Custom Field: the customization of a DocType of
 *   another app. The schema of the other app stays as it is.
 * - a patch or a migration: the records of a site change, and the values
 *   of the user are preserved unless the migration says otherwise.
 *
 * A DocType whose owner is not clear is not resolved by guessing. The
 * operation is blocked, and the evidence names what has to be read.
 */

import { createHash } from "node:crypto";

import type { DocTypeOwnership } from "./frappe-lifecycle-evidence.ts";

/** What an operation does to the site. */
export type FrappeOperationEffect =
	| "native-source"
	| "customization"
	| "data-migration"
	| "destructive"
	| "read-only"
	| "unknown";

/** The mechanism the proposal asks for. */
export type FrappeOperationMechanism =
	| "source-json"
	| "custom-field"
	| "patch"
	| "hook"
	| "destructive"
	| "read-only";

/** How much the operation may harm. */
export type FrappeOperationRisk = "none" | "low" | "medium" | "high" | "critical";

/** The decision of the policy. */
export type FrappeDecision =
	| "execute"
	| "countdown"
	| "approval-required"
	| "blocked";

/** Where the target of the operation is. */
export interface FrappeOperationTarget {
	/** The bench the operation runs in. */
	bench?: string;
	/** The app the operation belongs to. */
	app?: string;
	/** The python namespace of the app. */
	namespace?: string;
	/** The module under the namespace. */
	module?: string;
	/** The site the operation changes. */
	site?: string;
	/** The dotted path of the function that runs. */
	function?: string;
}

/** The registration of the operation in the app. */
export interface FrappeOperationRegistration {
	/** The hook that calls the routine. */
	hook?: string;
	/** The patch that owns the transformation. */
	patch?: string;
	/** The fixture that owns the customization. */
	fixture?: string;
	/**
	 * The JSON that owns the schema of the DocType.
	 *
	 * The source of an owned DocType is its registration: Frappe
	 * synchronizes the schema from it, so a change of that JSON is a
	 * registered change and not a loose edit.
	 */
	schema?: string;
	/** The operation is not registered anywhere. */
	none: boolean;
}

/** The evidence of the size of the work. */
export interface FrappeOperationWorkload {
	/** The work is bounded and known. */
	bounded: boolean;
	/** How many steps the operation takes. */
	steps: number;
	/** How many records it touches, when it is known. */
	records?: number;
	/** Why the size is unknown. */
	note?: string;
	/**
	 * The size was inspected.
	 *
	 * The claim of a request is not the inspection of the bench: without
	 * it the size of the work stays a claim, and a mutation is never
	 * authorized on a claim alone.
	 */
	verified?: boolean;
}

/**
 * The place of the routine.
 *
 * The place is evidence when it was read from the bench, and a claim when
 * it was asserted. The difference decides: a routine whose place was not
 * inspected is not inspected at all.
 */
export interface FrappeOperationConvention {
	/** The routine is inside the convention of the app. */
	inside: boolean;
	/** Why the place of the routine is what it is. */
	reason: string;
	/**
	 * The place of the routine was inspected.
	 *
	 * The convention names the directories of the namespace of the app,
	 * and only the file of the routine proves that it is in one of them.
	 */
	verified?: boolean;
}

/** The authorization of the operation. */
export interface FrappeOperationAuthorization {
	/** Where the permission comes from. */
	source: "user" | "standing" | "project" | "none";
	/** What the permission covers. */
	scope: string;
	/** The site the permission is for, when it names one. */
	site?: string;
	/** The app the permission is for, when it names one. */
	app?: string;
	/** The effects the permission covers. */
	effects?: FrappeOperationEffect[];
	/** When the permission stops applying. */
	expiresAt?: number;
}

/** The assessment of an operation. */
export interface FrappeOperationAssessment {
	/** The request the operation belongs to. */
	requestGeneration: number;
	/** What was proposed, in the words of the request. */
	proposal: string;
	/** The mechanism the proposal asks for. */
	mechanism: FrappeOperationMechanism;
	/** Where the operation runs. */
	target: FrappeOperationTarget;
	/** The owner of the DocType, when the operation touches one. */
	ownership?: DocTypeOwnership;
	/** What the operation does. */
	effect: FrappeOperationEffect;
	/** How much the operation may harm. */
	risk: FrappeOperationRisk;
	/** The size of the work. */
	workload: FrappeOperationWorkload;
	/** Whether the operation can run twice without a change. */
	idempotency: "verified" | "claimed" | "unknown";
	/** Where the operation is registered. */
	registration: FrappeOperationRegistration;
	/** Whether the result of the operation was checked. */
	verification: "verified" | "unverified" | "unknown";
	/** The permission of the operation. */
	authorization: FrappeOperationAuthorization;
	/** Whether the routine is inside the convention of the app. */
	insideConvention: FrappeOperationConvention;
	/** The hash of the code that was reviewed. */
	reviewedHash?: string;
	/** The evidence that was read. */
	evidence: string[];
	/** What is not known. */
	unknowns: string[];
	/** The identity of the operation. */
	identity: string;
}

/** The input of an assessment. */
export interface FrappeOperationInput {
	/** The request the operation belongs to. */
	requestGeneration: number;
	/** What was proposed. */
	proposal: string;
	/** The mechanism the proposal asks for. */
	mechanism: FrappeOperationMechanism;
	/** Where the operation runs. */
	target: FrappeOperationTarget;
	/** The owner of the DocType, when the operation touches one. */
	ownership?: DocTypeOwnership;
	/** Whether the routine is inside the convention of the app. */
	insideConvention?: Partial<FrappeOperationConvention>;
	/** The hash of the code that was reviewed. */
	reviewedHash?: string;
	/** The registration of the operation. */
	registration?: Partial<FrappeOperationRegistration>;
	/** The size of the work. */
	workload?: Partial<FrappeOperationWorkload>;
	/** Whether the operation can run twice. */
	idempotency?: "verified" | "claimed" | "unknown";
	/** Whether the result was checked. */
	verification?: "verified" | "unverified" | "unknown";
	/**
	 * What the source of the routine does.
	 *
	 * The mechanism and the ownership decide the effect of the operation,
	 * and the source of the routine is the last word: a routine that
	 * deletes records is destructive whatever the mechanism asks for.
	 */
	calleeEffect?: { destructive: boolean; reason: string };
	/** The permission of the operation. */
	authorization?: FrappeOperationAuthorization;
	/** The evidence that was read. */
	evidence?: string[];
}

/**
 * The effect of the mechanism and the ownership.
 *
 * The mechanism and the ownership decide the effect of the operation, and
 * the effect decides the risk. A fact that is not known is an unknown:
 * the assessment names it and the operation stays blocked.
 */
function effectOf(
	input: FrappeOperationInput,
	unknowns: string[],
): { effect: FrappeOperationEffect; risk: FrappeOperationRisk } {
	const ownership = input.ownership;
	const base = mechanismEffect(input, ownership, unknowns);
	// The source of the routine has the last word: a routine that deletes
	// records is destructive whatever the mechanism of the proposal asks
	// for. The ownership comes first: an effect that is not known stays
	// unknown.
	if (base.effect !== "unknown" && input.calleeEffect?.destructive) {
		return { effect: "destructive", risk: "high" };
	}
	return base;
}

/**
 * The effect of the mechanism of the proposal.
 *
 * The mechanism and the ownership decide the effect of the operation, and
 * the effect decides the risk. A fact that is not known is an unknown:
 * the assessment names it and the operation stays blocked.
 */
function mechanismEffect(
	input: FrappeOperationInput,
	ownership: DocTypeOwnership | undefined,
	unknowns: string[],
): { effect: FrappeOperationEffect; risk: FrappeOperationRisk } {
	switch (input.mechanism) {
		case "source-json":
			return sourceEffect(input, ownership, unknowns);
		case "custom-field":
			return customizationEffect(input, ownership, unknowns);
		case "patch":
			return { effect: "data-migration", risk: "medium" };
		case "hook":
			return { effect: "data-migration", risk: "medium" };
		case "destructive":
			return { effect: "destructive", risk: "critical" };
		case "read-only":
			return { effect: "read-only", risk: "none" };
		default:
			unknowns.push("the mechanism of the operation is not known");
			return { effect: "unknown", risk: "medium" };
	}
}

/**
 * The effect of a change of the source of a DocType.
 *
 * The source of the DocType is the registration of the schema, but only
 * for the app that owns the DocType: the schema of another app stays as
 * it is, and the change belongs to the Custom Field mechanism.
 */
function sourceEffect(
	input: FrappeOperationInput,
	ownership: DocTypeOwnership | undefined,
	unknowns: string[],
): { effect: FrappeOperationEffect; risk: FrappeOperationRisk } {
	if (!ownership) {
		unknowns.push(
			"the owner of the DocType is not known: the mechanism of the source needs it",
		);
		return { effect: "unknown", risk: "medium" };
	}
	if (ownership.ambiguous) {
		unknowns.push(
			ownership.reason ??
				`the owner of the DocType ${ownership.doctype} is not clear`,
		);
		return { effect: "unknown", risk: "medium" };
	}
	if (!ownership.standard) {
		unknowns.push(
			`the DocType ${ownership.doctype} has no source JSON in the bench: a database DocType needs a migration or a Custom Field, not an edit of a JSON`,
		);
		return { effect: "unknown", risk: "medium" };
	}
	if (
		ownership.ownerApp &&
		input.target.app &&
		ownership.ownerApp !== input.target.app
	) {
		unknowns.push(
			`the DocType ${ownership.doctype} belongs to the app ${ownership.ownerApp}, not to ${input.target.app}: the change needs the Custom Field mechanism, not the source of the other app`,
		);
		return { effect: "unknown", risk: "medium" };
	}
	return { effect: "native-source", risk: "low" };
}

/**
 * The effect of a customization of a DocType.
 *
 * A native field of the app that owns the DocType belongs in its source
 * JSON: a Custom Field record would duplicate it.
 */
function customizationEffect(
	input: FrappeOperationInput,
	ownership: DocTypeOwnership | undefined,
	unknowns: string[],
): { effect: FrappeOperationEffect; risk: FrappeOperationRisk } {
	if (!ownership) {
		unknowns.push(
			"the owner of the DocType is not known: the Custom Field mechanism needs it",
		);
		return { effect: "unknown", risk: "medium" };
	}
	if (ownership.ambiguous) {
		unknowns.push(
			ownership.reason ??
				`the owner of the DocType ${ownership.doctype} is not clear`,
		);
		return { effect: "unknown", risk: "medium" };
	}
	if (
		ownership.standard &&
		ownership.ownerApp &&
		input.target.app &&
		ownership.ownerApp === input.target.app
	) {
		unknowns.push(
			`the DocType ${ownership.doctype} belongs to the app ${ownership.ownerApp}: the field belongs in its source JSON, and a Custom Field record would duplicate it`,
		);
		return { effect: "unknown", risk: "medium" };
	}
	return { effect: "customization", risk: "low" };
}

/**
 * The size of the work.
 *
 * The size has to be bounded: an operation whose size is unknown may run
 * for ever. A bounded work that was not inspected is a claim as well, and
 * a claim is not a size.
 */
function workloadOf(
	input: FrappeOperationInput,
	automatic: boolean,
	unknowns: string[],
): FrappeOperationWorkload {
	const workload: FrappeOperationWorkload = {
		bounded: input.workload?.bounded ?? false,
		steps: input.workload?.steps ?? 0,
		records: input.workload?.records,
		note: input.workload?.note,
		verified: input.workload?.verified ?? false,
	};
	if (automatic && !workload.bounded) {
		unknowns.push(
			workload.note ??
				"the size of the work is not known: the operation is not bounded",
		);
	} else if (automatic && !workload.verified) {
		unknowns.push(
			"the size of the work was not inspected: the bench does not prove that the operation is bounded",
		);
	}
	return workload;
}

/**
 * The registration of the operation.
 *
 * The registration is the fact of the bench: a hook, a patch, a fixture
 * or the source of the app. A persistent change without a registration is
 * incomplete, and it stays blocked.
 */
function registrationEvidence(
	input: FrappeOperationInput,
	automatic: boolean,
	unknowns: string[],
): FrappeOperationRegistration {
	const registration: FrappeOperationRegistration = {
		hook: input.registration?.hook,
		patch: input.registration?.patch,
		fixture: input.registration?.fixture,
		schema: input.registration?.schema,
		none:
			input.registration?.none ??
			(!input.registration?.hook &&
				!input.registration?.patch &&
				!input.registration?.fixture &&
				!input.registration?.schema),
	};
	if (automatic && registration.none) {
		unknowns.push(
			"the operation is not registered in a hook, a patch or a fixture: a persistent change is incomplete without it",
		);
	}
	return registration;
}

/**
 * The idempotency of the operation.
 *
 * The claim of a request is not the inspection of the bench: only a
 * verified idempotency carries the automatic path.
 */
function idempotencyEvidence(
	input: FrappeOperationInput,
	automatic: boolean,
	unknowns: string[],
): "verified" | "claimed" | "unknown" {
	const idempotency = input.idempotency ?? "unknown";
	if (automatic && idempotency !== "verified") {
		unknowns.push(
			idempotency === "claimed"
				? "it is claimed that the operation can run twice without a change, and the claim was not inspected"
				: "it is not known whether the operation can run twice without a change",
		);
	}
	return idempotency;
}

/**
 * The place of the routine.
 *
 * The place is verified when the file of the routine was read and compared
 * with the convention of the app. Without the file the place stays a
 * claim, and a claim never carries the automatic path.
 */
function conventionOf(
	input: FrappeOperationInput,
	automatic: boolean,
	unknowns: string[],
): FrappeOperationConvention {
	const insideConvention: FrappeOperationConvention = {
		inside: input.insideConvention?.inside ?? false,
		reason:
			input.insideConvention?.reason ??
			"the place of the routine was not checked",
		verified: input.insideConvention?.verified ?? false,
	};
	if (automatic && !insideConvention.verified) {
		unknowns.push(insideConvention.reason);
	}
	return insideConvention;
}

/**
 * The assessment of an operation.
 *
 * The mechanism and the ownership decide the effect. The effect decides
 * the risk, and the unknowns decide whether the operation may run at all.
 */
export function assessFrappeOperation(
	input: FrappeOperationInput,
): FrappeOperationAssessment {
	const unknowns: string[] = [];
	const evidence = [...(input.evidence ?? [])];
	const ownership = input.ownership;
	const { effect, risk } = effectOf(input, unknowns);

	// The site is the target of every change. An operation without a site
	// changes nothing that can be checked, and an operation with an
	// unknown site may change the wrong one.
	if (effect !== "read-only" && !input.target.site) {
		unknowns.push("the site of the operation is not known");
	}
	// The evidence of the automatic path is needed only for the effects
	// that may run without the answer of the human: a read-only operation
	// changes nothing, and a destructive one always asks the human.
	const automatic = effect !== "read-only" && effect !== "destructive";
	const workload = workloadOf(input, automatic, unknowns);
	const registration = registrationEvidence(input, automatic, unknowns);
	const idempotency = idempotencyEvidence(input, automatic, unknowns);
	const insideConvention = conventionOf(input, automatic, unknowns);
	const verification = input.verification ?? "unknown";
	const authorization = input.authorization ?? {
		source: "none",
		scope: "",
	};

	const assessment: FrappeOperationAssessment = {
		requestGeneration: input.requestGeneration,
		proposal: input.proposal,
		mechanism: input.mechanism,
		target: input.target,
		ownership,
		effect,
		risk,
		workload,
		idempotency,
		registration,
		verification,
		authorization,
		insideConvention,
		reviewedHash: input.reviewedHash,
		evidence,
		unknowns,
		identity: "",
	};
	assessment.identity = frappeOperationIdentity(assessment);
	return assessment;
}

/**
 * The identity of an operation.
 *
 * The identity is the identity of the work, not of the request: the same
 * routine of the same app for the same site is one operation, and a second
 * request for it is the same operation with a new generation. A timer
 * race and a second click therefore end at the same operation, and the
 * result of the first one is the result of the operation.
 */
export function frappeOperationIdentity(
	assessment: FrappeOperationAssessment,
): string {
	const parts = [
		assessment.target.bench ?? "",
		assessment.target.app ?? "",
		assessment.target.namespace ?? "",
		assessment.target.module ?? "",
		assessment.target.site ?? "",
		assessment.target.function ?? "",
		assessment.mechanism,
		assessment.effect,
	];
	return createHash("sha256")
		.update(parts.join("|"))
		.digest("hex")
		.slice(0, 32);
}

/** The context of a decision. */
export interface FrappeDecisionContext {
	/** The clock of the decision. */
	now: number;
	/**
	 * The rule of the project.
	 *
	 * The rule is the rule of the owner: it can ask for an approval, it
	 * can ask for a confirmation, and it can allow the operation that the
	 * permission covers. It can never allow an operation that the
	 * evidence does not support.
	 */
	projectRule?: "require-approval" | "confirm" | "allow";
	/**
	 * The permission that stands in advance.
	 *
	 * The permission is scoped: it names a site, an app or the effects it
	 * covers. A general request to improve the autonomy is not a
	 * permission for a production database.
	 */
	standingGrant?: FrappeOperationAuthorization;
	/**
	 * The judge of the operation.
	 *
	 * The judge may name an effect it believes in, and its words are
	 * evidence. It cannot lift a restriction of the user or of the
	 * project: its assessment is never read by the decision.
	 */
	jev?: { effect?: FrappeOperationEffect; reason?: string };
}

/** The result of a decision. */
export interface FrappeDecisionResult {
	/** What may happen. */
	decision: FrappeDecision;
	/** Why the decision is what it is. */
	reason: string;
	/** The human has to be told about the operation. */
	requiresNotification: boolean;
	/** What is not known. */
	unknowns: string[];
}

/**
 * The decision of the policy.
 *
 * The order of the rules is the order of the restrictions:
 *
 * 1. An operation whose evidence is not complete is blocked. A missing
 *    fact is not a permission.
 * 2. An operation that destroys data needs the answer of the human. The
 *    place of the routine and the elapsed time of a countdown never
 *    decide it.
 * 3. The rule of the project decides the rest: an approval rule asks the
 *    human, a confirmation rule counts down, and a permission that covers
 *    the operation runs it.
 * 4. Without any of them, the human is asked.
 */
export function decideFrappeOperation(
	assessment: FrappeOperationAssessment,
	context: FrappeDecisionContext,
): FrappeDecisionResult {
	const unknowns = [...assessment.unknowns];
	if (assessment.effect === "unknown") {
		return {
			decision: "blocked",
			reason:
				unknowns[0] ??
				"the effect of the operation is not known, so nothing may run",
			requiresNotification: false,
			unknowns,
		};
	}
	if (unknowns.length > 0) {
		return {
			decision: "blocked",
			reason: `the evidence of the operation is incomplete: ${unknowns.join("; ")}`,
			requiresNotification: false,
			unknowns,
		};
	}
	// A routine whose place was inspected and that is outside the
	// convention of the app is a finding, not a missing fact: nothing of
	// that routine may run by itself.
	if (
		assessment.insideConvention.verified &&
		!assessment.insideConvention.inside
	) {
		return {
			decision: "blocked",
			reason: assessment.insideConvention.reason,
			requiresNotification: false,
			unknowns,
		};
	}
	if (assessment.effect === "destructive") {
		return {
			decision: "approval-required",
			reason:
				"the operation destroys data: it needs the explicit answer of the human, and no countdown decides it",
			requiresNotification: true,
			unknowns,
		};
	}
	if (assessment.effect === "read-only") {
		return {
			decision: "execute",
			reason: "the operation reads and changes nothing",
			requiresNotification: false,
			unknowns,
		};
	}
	const rule = context.projectRule ?? "allow";
	if (rule === "require-approval") {
		return {
			decision: "approval-required",
			reason: "the rule of the project asks for the approval of the human",
			requiresNotification: true,
			unknowns,
		};
	}
	const grant = context.standingGrant;
	const covered = grant ? grantCovers(grant, assessment, context.now) : undefined;
	if (rule === "confirm") {
		if (covered) {
			return {
				decision: "countdown",
				reason: `the confirmation expires and the permission that stands covers the operation (${covered})`,
				requiresNotification: false,
				unknowns,
			};
		}
		return {
			decision: "approval-required",
			reason:
				"the rule of the project asks for a confirmation, and no permission that stands covers the operation",
			requiresNotification: true,
			unknowns,
		};
	}
	if (covered) {
		return {
			decision: "execute",
			reason: `the permission that stands covers the operation (${covered})`,
			requiresNotification: false,
			unknowns,
		};
	}
	return {
		decision: "approval-required",
		reason: "no permission covers the operation, so the human is asked",
		requiresNotification: true,
		unknowns,
	};
}

/**
 * Does a permission that stands cover the operation?
 *
 * The permission is scoped: it names the site and the app it is for, the
 * effects it covers and the time it is valid. A permission without a scope
 * covers nothing, and a permission that expired covers nothing.
 */
export function grantCovers(
	grant: FrappeOperationAuthorization,
	assessment: FrappeOperationAssessment,
	now: number,
): string | undefined {
	if (grant.source === "none") return undefined;
	if (grant.expiresAt !== undefined && grant.expiresAt <= now) {
		return undefined;
	}
	if (grant.site && grant.site !== assessment.target.site) return undefined;
	if (grant.app && grant.app !== assessment.target.app) return undefined;
	if (grant.effects && !grant.effects.includes(assessment.effect)) {
		return undefined;
	}
	if (!grant.effects && !grant.scope) return undefined;
	return grant.scope || "the permission that stands";
}

/** The state of the world at the moment of the dispatch. */
export interface FrappeDispatchState {
	/** The request that is running now. */
	requestGeneration: number;
	/** The permission that is valid now. */
	authorization?: FrappeOperationAuthorization;
	/** The hash of the code that was reviewed. */
	reviewedHash?: string;
	/** The hash of the code now. */
	currentHash?: string;
	/** The request was cancelled or replaced. */
	cancelled?: boolean;
	/** Another operation of the same target is running. */
	conflictingOperation?: boolean;
	/** The checks of the operation passed. */
	checksPassed?: boolean;
	/** The clock of the dispatch. */
	now: number;
}

/** The result of the check before the dispatch. */
export interface FrappeRecheckResult {
	/** May the operation run? */
	ok: boolean;
	/** Why not. */
	reason: string;
}

/**
 * The check before the dispatch.
 *
 * The proposal of the countdown is pinned: the operation that was assessed
 * is the operation that runs. A new request, a cancellation, a code that
 * changed, a permission that ended, a check that failed or another
 * operation of the same target stops the dispatch.
 */
export function recheckFrappeOperation(
	assessment: FrappeOperationAssessment,
	state: FrappeDispatchState,
): FrappeRecheckResult {
	if (state.cancelled) {
		return { ok: false, reason: "the request was cancelled or replaced" };
	}
	if (state.requestGeneration !== assessment.requestGeneration) {
		return {
			ok: false,
			reason: "the request that was assessed is not the request that runs",
		};
	}
	if (state.conflictingOperation) {
		return {
			ok: false,
			reason: "another operation of the same target is running",
		};
	}
	if (
		assessment.reviewedHash &&
		assessment.reviewedHash !== state.currentHash
	) {
		return {
			ok: false,
			reason: "the code changed after the assessment: the operation is assessed again",
		};
	}
	if (state.checksPassed === false) {
		return { ok: false, reason: "the checks of the operation did not pass" };
	}
	if (assessment.authorization.source !== "none") {
		const valid =
			state.authorization !== undefined &&
			grantCovers(state.authorization, assessment, state.now) !==
				undefined;
		if (!valid) {
			return {
				ok: false,
				reason: "the permission of the operation is not valid any more",
			};
		}
	}
	return { ok: true, reason: "the operation may run" };
}
