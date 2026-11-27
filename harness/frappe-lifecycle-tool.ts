/**
 * The tool of the Frappe lifecycle.
 *
 * The tool is the live seam between the agent and the policy of a
 * Frappe operation. The agent proposes an operation; the tool reads the
 * evidence of the bench, assesses the proposal and dispatches it:
 *
 * - "execute" means the operation may run as it was proposed,
 * - "countdown" means the operation waits for a confirmation that
 *   expires,
 * - "approval-required" means the human is asked through the runtime of
 *   the delegated approval,
 * - "blocked" means the operation does not run, and the reason says why.
 *
 * The tool never runs a command of a bench. It tells the agent what may
 * happen and it keeps the authorization of the operation: the operation
 * that was assessed is the operation that runs, and a routine, a folder,
 * a model or a judge never stands in for the answer of the human.
 */

import { readFileSync } from "node:fs";

import { Type } from "typebox";

import {
	readBenchLayout,
	readLifecycleHooks,
	readPatchRegistry,
	resolveDocTypeOwnership,
	resolveRoutineFile,
	hashOfFile,
	isInsideLifecycleConvention,
	type DocTypeOwnership,
	type FrappeAppLayout,
	type LifecycleHookEvidence,
} from "./frappe-lifecycle-evidence.ts";
import {
	assessFrappeOperation,
	type FrappeOperationAssessment,
	type FrappeOperationAuthorization,
	type FrappeOperationMechanism,
	type FrappeOperationWorkload,
} from "./frappe-lifecycle-policy.ts";
import {
	dispatchFrappeOperation,
	type FrappeDispatch,
} from "./frappe-approval.ts";
import type { FrappeCountdownDispatcher } from "./frappe-countdown.ts";
import type { DelegatedApprovalRuntime } from "./delegated-approval-runtime.ts";
import type { PendingActionRegistry } from "./pending-actions.ts";

/** The options of the tool. */
export interface FrappeLifecycleToolOptions {
	/** The bench of the operation. */
	benchPath: string;
	/**
	 * The runtime of the delegated approval.
	 *
	 * The runtime is read when the tool runs: it is created when the
	 * harness starts and it lives longer than the registration.
	 */
	approval?: () => DelegatedApprovalRuntime | undefined;
	/** The registry of the pending actions. */
	pending?: () => PendingActionRegistry | undefined;
	/**
	 * The owner of the countdowns.
	 *
	 * The owner keeps the assessment that the expiry is checked against,
	 * so the operation that runs is the operation that was assessed.
	 */
	countdown?: () => FrappeCountdownDispatcher | undefined;
	/** The rule of the project. */
	projectRule?: "require-approval" | "confirm" | "allow";
	/** The permission that stands. */
	standingGrant?: FrappeOperationAuthorization;
	/** The clock of the tool. */
	now?: () => number;
	/** The generation of the request that runs. */
	generation?: () => number;
	/** The session of the request. */
	sessionId?: () => string;
	/** The workspace of the operation. */
	workspace?: () => string;
}

/** The parameters of a proposal of the tool. */
export interface FrappeProposalParams {
	/** The DocType the operation touches. */
	doctype: string;
	/** The mechanism the proposal asks for. */
	mechanism: string;
	/** The exact operation. */
	proposal: string;
	/** The site the operation touches. */
	site?: string;
	/** The app the operation touches. */
	app?: string;
	/** The module the operation touches. */
	module?: string;
	/** The function the operation calls. */
	function?: string;
	/** How many steps the operation takes. */
	steps?: number;
	/** Can the operation run twice without a change? */
	idempotent?: boolean;
	/** The path of the patch that owns the migration. */
	patch?: string;
}

/** The details of an answer of the tool. */
export interface FrappeLifecycleDetails {
	/** The identity of the operation. */
	identity: string;
	/** The effect of the operation. */
	effect: string;
	/** The mechanism the ownership chose. */
	mechanism: string;
	/** What may happen. */
	dispatch: FrappeDispatch["kind"];
	/** Why the decision is what it is. */
	reason: string;
	/** The app that owns the DocType. */
	ownerApp?: string;
	/** The evidence that was read. */
	evidence: string[];
	/** What is not known. */
	unknowns: string[];
}

/**
 * The tool that assesses a Frappe lifecycle operation.
 */
export function createFrappeLifecycleTool(options: FrappeLifecycleToolOptions) {
	return {
		name: "frappe_lifecycle_check",
		label: "Frappe Lifecycle Check",
		description:
			"Check a Frappe lifecycle operation before it runs. The tool reads the ownership of the DocType from the bench, decides the mechanism that the ownership allows and tells you what may happen: it may run, it waits for a confirmation, the human has to approve it, or it is blocked. Run the operation only when the answer says that it may run.",
		parameters: Type.Object({
			doctype: Type.String({
				description: "The DocType the operation touches",
			}),
			mechanism: Type.Union([
				Type.Literal("source-json"),
				Type.Literal("custom-field"),
				Type.Literal("patch"),
				Type.Literal("hook"),
				Type.Literal("destructive"),
				Type.Literal("read-only"),
			]),
			proposal: Type.String({
				description: "The exact operation, in the words you would run it",
			}),
			site: Type.Optional(
				Type.String({ description: "The site the operation touches" }),
			),
			app: Type.Optional(
				Type.String({ description: "The app the operation touches" }),
			),
			module: Type.Optional(
				Type.String({ description: "The module the operation touches" }),
			),
			function: Type.Optional(
				Type.String({ description: "The function the operation calls" }),
			),
			steps: Type.Optional(
				Type.Number({ description: "How many steps the operation takes" }),
			),
			idempotent: Type.Optional(
				Type.Boolean({
					description:
						"Can the operation run twice without a change? An operation that cannot is never run twice.",
				}),
			),
			patch: Type.Optional(
				Type.String({
					description: "The path of the patch that owns the migration",
				}),
			),
		}),
		async execute(
			_toolCallId: string,
			params: FrappeProposalParams,
		): Promise<{
			content: Array<{ type: "text"; text: string }>;
			details: FrappeLifecycleDetails;
		}> {
			const now = (options.now ?? Date.now)();
			const evidence = await evidenceOf(options, params);
			const assessment = assessmentOf(options, params, evidence);
			const sessionId = (options.sessionId ?? (() => "session-1"))();
			const workspace = (options.workspace ?? (() => options.benchPath))();
			const dispatch = await dispatchFrappeOperation({
				assessment,
				context: {
					now,
					...(options.projectRule ? { projectRule: options.projectRule } : {}),
					...(options.standingGrant
						? { standingGrant: options.standingGrant }
						: {}),
				},
				workspace,
				sessionId,
				now,
				...(options.approval
					? { approval: options.approval() }
					: {}),
				...(options.pending ? { pending: options.pending() } : {}),
			});
			if (dispatch.kind === "countdown") {
				// The owner of the countdown keeps the assessment: the
				// expiry is checked against the proposal that was assessed.
				options.countdown?.()?.remember({
					actionId: dispatch.actionId,
					identity: dispatch.identity,
					assessment,
					deadlineAt: dispatch.deadlineAt,
					generation: assessment.requestGeneration,
					sessionId,
					workspace,
					proposal: assessment.proposal,
					// The file of the routine is read again at the expiry:
					// the code that was reviewed has to be the code that is
					// there.
					...(evidence.routine
						? { currentHash: () => hashOfFile(evidence.routine!.path) }
						: {}),
				});
			}
			const details: FrappeLifecycleDetails = {
				identity: dispatch.identity,
				effect: assessment.effect,
				mechanism: assessment.mechanism,
				dispatch: dispatch.kind,
				reason: dispatch.reason,
				...(evidence.ownership.ownerApp
					? { ownerApp: evidence.ownership.ownerApp }
					: {}),
				evidence: assessment.evidence,
				unknowns: assessment.unknowns,
			};
			return {
				content: [{ type: "text" as const, text: textOf(details, assessment) }],
				details,
			};
		},
	};
}

/** The evidence of a proposal: the ownership and the hooks of the app. */
interface ProposalEvidence {
	/** The owner of the DocType. */
	ownership: DocTypeOwnership;
	/** The app the operation touches. */
	app?: string;
	/** The namespace of the app. */
	namespace?: string;
	/** The hooks of the app. */
	hooks?: LifecycleHookEvidence;
	/** The layout of the app. */
	layout?: FrappeAppLayout;
	/** The patches the app registers. */
	patches: string[];
	/** The file of the routine, when the bench has it. */
	routine?: RoutineEvidence;
}

/**
 * The file of the routine of a proposal.
 *
 * The file is the evidence of the place of the routine and of the code
 * that was reviewed. A bench without the file has no evidence about the
 * routine at all.
 */
interface RoutineEvidence {
	/** The path of the file that defines the routine. */
	path: string;
	/** The hash of that file. */
	hash: string;
	/** The routine is inside the convention of the app. */
	inside: boolean;
	/** Why the place of the routine is what it is. */
	reason: string;
	/** The routine deletes records. */
	destructive: boolean;
}

/**
 * The evidence of a proposal.
 *
 * The ownership comes from the files of the bench, and the hooks come from
 * the hooks file of the app. Nothing here is assumed.
 */
async function evidenceOf(
	options: FrappeLifecycleToolOptions,
	params: FrappeProposalParams,
): Promise<ProposalEvidence> {
	const ownership = await resolveDocTypeOwnership(
		options.benchPath,
		params.doctype,
	);
	const layout = await readBenchLayout(options.benchPath);
	const app = params.app ?? ownership.ownerApp;
	const appEntry = layout.find((entry) => entry.app === app);
	const hooks = app
		? await readLifecycleHooks(options.benchPath, app)
		: undefined;
	const patches = app ? await readPatchRegistry(options.benchPath, app) : [];
	const routine = await routineEvidence(options.benchPath, app, appEntry, params);
	return {
		ownership,
		app,
		namespace: appEntry?.namespace ?? ownership.namespace,
		...(appEntry ? { layout: appEntry } : {}),
		...(hooks ? { hooks } : {}),
		patches,
		...(routine ? { routine } : {}),
	};
}

/**
 * The file of the routine of a proposal.
 *
 * The routine is the code that runs. The bench has to show it: the file
 * that defines it proves where it is, and its hash pins what was
 * reviewed. A routine that the bench does not have stays unknown.
 */
async function routineEvidence(
	benchPath: string,
	app: string | undefined,
	layout: FrappeAppLayout | undefined,
	params: FrappeProposalParams,
): Promise<RoutineEvidence | undefined> {
	if (!app || !layout?.namespace || !params.function) return undefined;
	const path = await resolveRoutineFile(benchPath, app, params.function);
	if (!path) return undefined;
	const hash = hashOfFile(path);
	if (!hash) return undefined;
	const convention = isInsideLifecycleConvention(path, layout);
	let source = "";
	try {
		source = readFileSync(path, "utf8");
	} catch {
		source = "";
	}
	return {
		path,
		hash,
		inside: convention.inside,
		reason: convention.reason,
		destructive: deletesRecords(source),
	};
}

/**
 * Does the routine delete records?
 *
 * The source of the routine is read, and a routine that deletes records
 * is destructive whatever the mechanism of the proposal asks for. The
 * check errs on the side of the human: a false finding asks the human,
 * a missed one would run without them.
 */
function deletesRecords(source: string): boolean {
	return (
		/frappe\.db\.sql\(\s*["'`][^"'`]*\b(delete|truncate|drop)\b/i.test(source) ||
		/\bfrappe\.delete_doc\(/i.test(source) ||
		/\bdelete_doc\(/i.test(source) ||
		/\bfrappe\.db\.delete\(/i.test(source)
	);
}

/**
 * The assessment of a proposal.
 */
function assessmentOf(
	options: FrappeLifecycleToolOptions,
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): FrappeOperationAssessment {
	const mechanism = params.mechanism as FrappeOperationMechanism;
	const workload = workloadOf(params, evidence);
	const idempotency = idempotencyOf(params, evidence);
	return assessFrappeOperation({
		requestGeneration: (options.generation ?? (() => 0))(),
		proposal: params.proposal,
		mechanism,
		target: {
			bench: options.benchPath,
			app: evidence.app,
			namespace: evidence.namespace,
			module: params.module ?? evidence.ownership.module,
			site: params.site,
			function: params.function,
		},
		ownership: evidence.ownership,
		insideConvention: conventionOf(mechanism, params, evidence),
		workload,
		idempotency,
		// The permission that stands travels with the assessment: the
		// expiry of a countdown checks that the permission still covers
		// the operation, and a permission that ended stops it.
		...(options.standingGrant ? { authorization: options.standingGrant } : {}),
		// The hash of the file of the routine pins the code that was
		// reviewed: a file that changed afterwards is another operation.
		...(evidence.routine ? { reviewedHash: evidence.routine.hash } : {}),
		// The source of the routine says what the routine does.
		...(evidence.routine?.destructive
			? {
					calleeEffect: {
						destructive: true,
						reason:
							"the source of the routine deletes records: the operation is destructive",
					},
				}
			: {}),
		registration: registrationOf(
			mechanism,
			params.function,
			evidence.hooks,
			evidence.ownership,
			params.patch,
			evidence.patches,
		),
	});
}

/**
 * The place of the operation.
 *
 * The place is verified when the bench shows it: the source of a DocType
 * and the fixture of a customization are in the convention of the app,
 * and the place of a routine is the file that defines it. A place that
 * was not inspected stays unknown, and an unknown place never carries
 * the automatic path.
 */
function conventionOf(
	mechanism: FrappeOperationMechanism,
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): {
	inside: boolean;
	reason: string;
	verified: boolean;
} {
	switch (mechanism) {
		case "source-json":
			return sourceConvention(evidence);
		case "custom-field":
			return customizationConvention(evidence);
		case "patch":
			return patchConvention(params, evidence);
		default:
			return routineConvention(evidence);
	}
}

/**
 * The place of a change of the source of a DocType.
 *
 * The source of an owned DocType is in the module of the namespace: the
 * ownership read it there.
 */
function sourceConvention(evidence: ProposalEvidence): {
	inside: boolean;
	reason: string;
	verified: boolean;
} {
	if (!evidence.ownership.sourceJson) {
		return {
			inside: false,
			reason:
				"the source of the DocType was not found in the bench: the place of the change was not inspected",
			verified: false,
		};
	}
	return {
		inside: true,
		reason: `the source of the DocType ${evidence.ownership.doctype} is in the module of the namespace`,
		verified: true,
	};
}

/**
 * The place of a customization.
 *
 * The fixture of the app carries the Custom Field records, and the
 * ownership read it there.
 */
function customizationConvention(evidence: ProposalEvidence): {
	inside: boolean;
	reason: string;
	verified: boolean;
} {
	if (evidence.ownership.fixtures.length === 0) {
		return {
			inside: false,
			reason:
				"the customization is not in a fixture of the app: the place of the change was not inspected",
			verified: false,
		};
	}
	return {
		inside: true,
		reason: `the customization is in the fixture ${evidence.ownership.fixtures[0]} of the app`,
		verified: true,
	};
}

/**
 * The place of a patch.
 *
 * The patches file of the namespace registers the migrations of the app.
 */
function patchConvention(
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): {
	inside: boolean;
	reason: string;
	verified: boolean;
} {
	if (!evidence.patches.includes(params.patch ?? "")) {
		return {
			inside: false,
			reason:
				"the patch is not registered in the patches file of the namespace: the place of the change was not inspected",
			verified: false,
		};
	}
	return {
		inside: true,
		reason: "the patch is registered in the patches file of the namespace",
		verified: true,
	};
}

/**
 * The place of a routine.
 *
 * The file of the routine is compared with the convention of the app. A
 * bench without the file leaves the place unknown.
 */
function routineConvention(evidence: ProposalEvidence): {
	inside: boolean;
	reason: string;
	verified: boolean;
} {
	if (!evidence.routine) {
		return {
			inside: false,
			reason:
				"the file of the routine was not found in the bench: the place of the routine was not inspected",
			verified: false,
		};
	}
	return {
		inside: evidence.routine.inside,
		reason: evidence.routine.reason,
		verified: true,
	};
}

/**
 * The size of the work.
 *
 * The work is bounded by the artifact the operation touches: the source
 * of the DocType, the fixture of the customization, the registered patch
 * or the code of the routine. The number of records it touches stays
 * unknown, and the note says so.
 */
function workloadOf(
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): FrappeOperationWorkload {
	const mechanism = params.mechanism as FrappeOperationMechanism;
	const bounded = boundOf(mechanism, params, evidence);
	return {
		bounded: bounded !== undefined,
		steps: params.steps ?? (bounded !== undefined ? 1 : 0),
		verified: bounded !== undefined,
		...(bounded
			? { note: `the work is the work of ${bounded}` }
			: {
					note:
						"the size of the work is not known: the bench does not show the artifact of the operation",
				}),
	};
}

/**
 * The artifact that bounds the work.
 *
 * The artifact is what the bench shows: the source of the DocType, the
 * fixture of the customization, the registered patch or the file of the
 * routine. Without one the size of the work stays unknown.
 */
function boundOf(
	mechanism: FrappeOperationMechanism,
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): string | undefined {
	switch (mechanism) {
		case "source-json":
			return evidence.ownership.sourceJson
				? `the source of the DocType ${evidence.ownership.doctype}`
				: undefined;
		case "custom-field":
			return evidence.ownership.fixtures.length > 0
				? `the fixture ${evidence.ownership.fixtures[0]}`
				: undefined;
		case "patch":
			return evidence.patches.includes(params.patch ?? "")
				? `the patch ${params.patch}`
				: undefined;
		case "hook":
		case "destructive":
			return evidence.routine
				? `the file ${evidence.routine.path}`
				: undefined;
		default:
			return undefined;
	}
}

/**
 * The idempotency of the operation.
 *
 * The repetition of an operation is harmless when the platform records
 * it, and the bench proves that the mechanism is one of those:
 *
 * - the schema of an owned DocType is synchronized: a second sync changes
 *   nothing,
 * - a customization of a fixture is applied when it is missing,
 * - a patch is recorded by the patch log of the site,
 * - a hook of the platform runs once per install or per migration.
 *
 * A routine that an operator runs by hand has no such record: nothing in
 * the bench proves that it changes nothing the second time, so the
 * idempotency stays unknown and the operation is not authorized by it.
 */
function idempotencyOf(
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): "verified" | "claimed" | "unknown" {
	const mechanism = params.mechanism as FrappeOperationMechanism;
	const verified = verifiedIdempotency(mechanism, params, evidence);
	if (verified) return "verified";
	// The claim of the request stays a claim: it names what the agent
	// said, and the bench says nothing about it.
	return params.idempotent ? "claimed" : "unknown";
}

/**
 * The idempotency that the bench proves.
 *
 * The repetition of an operation is harmless when the platform records
 * it, and the bench proves that the mechanism is one of those:
 *
 * - the schema of an owned DocType is synchronized: a second sync changes
 *   nothing,
 * - a customization of a fixture is applied when it is missing,
 * - a patch is recorded by the patch log of the site,
 * - a hook of the platform runs once per install or per migration.
 *
 * A routine that an operator runs by hand has no such record: nothing in
 * the bench proves that it changes nothing the second time.
 */
function verifiedIdempotency(
	mechanism: FrappeOperationMechanism,
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): boolean {
	switch (mechanism) {
		case "source-json":
			return evidence.ownership.standard;
		case "custom-field":
			return evidence.ownership.fixtures.length > 0;
		case "patch":
			return evidence.patches.includes(params.patch ?? "");
		case "hook":
			return platformRunsHook(params, evidence);
		default:
			return false;
	}
}

/**
 * Does the platform run the hook of the proposal?
 *
 * The hook of an app is registered in the hooks file of the app, and the
 * platform runs it when the app is installed or when the site is
 * migrated. The platform command of the registration has to be the
 * command of the proposal: a routine that an operator runs by hand is
 * not recorded by anything.
 */
function platformRunsHook(
	params: FrappeProposalParams,
	evidence: ProposalEvidence,
): boolean {
	const hooks = evidence.hooks;
	const dotted = params.function;
	if (!hooks || !dotted) return false;
	const name = dotted.split(".").pop() ?? dotted;
	const proposal = params.proposal.toLowerCase();
	const names = (entries: string[]) =>
		entries.some(
			(entry) => entry === dotted || entry === name || entry.endsWith(`.${name}`),
		);
	if (names(hooks.afterInstall)) {
		return (
			proposal.includes("install-app") &&
			proposal.includes(hooks.app.toLowerCase())
		);
	}
	if (names(hooks.afterMigrate)) {
		return proposal.includes("migrate");
	}
	return false;
}

/**
 * The registration of the operation.
 *
 * The registration is a fact of the bench, and the tool reads it:
 *
 * - a hook that the app does not register is no hook, and the operation
 *   is assessed again,
 * - the source JSON of an owned DocType registers the schema of that
 *   DocType, because Frappe synchronizes it from there,
 * - a fixture of the app registers a customization of another app,
 * - a patch file that exists registers a migration.
 */
function registrationOf(
	mechanism: FrappeOperationMechanism,
	functionName: string | undefined,
	hooks:
		| {
				afterInstall: string[];
				afterMigrate: string[];
				beforeUninstall: string[];
		  }
		| undefined,
	ownership: { sourceJson?: string; fixtures: string[] },
	patchPath: string | undefined,
	patches: string[] = [],
): Record<string, unknown> {
	return (
		hookRegistration(mechanism, functionName, hooks) ??
		sourceRegistration(mechanism, ownership) ??
		customizationRegistration(mechanism, ownership) ??
		patchRegistration(mechanism, patchPath, patches) ??
		{}
	);
}

/**
 * The registration of a hook.
 *
 * The hooks file of the app names the routines of the install, of the
 * migration and of the uninstall. A routine that the file does not name
 * is not a hook of the app.
 */
function hookRegistration(
	mechanism: FrappeOperationMechanism,
	functionName: string | undefined,
	hooks:
		| {
				afterInstall: string[];
				afterMigrate: string[];
				beforeUninstall: string[];
		  }
		| undefined,
): Record<string, unknown> | undefined {
	if (mechanism !== "hook" && mechanism !== "destructive") return undefined;
	if (!functionName) return undefined;
	const known = [
		...(hooks?.afterInstall ?? []),
		...(hooks?.afterMigrate ?? []),
		...(hooks?.beforeUninstall ?? []),
	];
	return known.includes(functionName) ? { hook: functionName } : undefined;
}

/**
 * The registration of a change of the source of a DocType.
 *
 * The source of an owned DocType is the registration of the schema: the
 * framework synchronizes it from there.
 */
function sourceRegistration(
	mechanism: FrappeOperationMechanism,
	ownership: { sourceJson?: string },
): Record<string, unknown> | undefined {
	if (mechanism !== "source-json") return undefined;
	return ownership.sourceJson ? { schema: ownership.sourceJson } : undefined;
}

/**
 * The registration of a customization.
 *
 * The fixture of the app carries the Custom Field records of the app.
 */
function customizationRegistration(
	mechanism: FrappeOperationMechanism,
	ownership: { fixtures: string[] },
): Record<string, unknown> | undefined {
	if (mechanism !== "custom-field") return undefined;
	return ownership.fixtures.length > 0
		? { fixture: ownership.fixtures[0] }
		: undefined;
}

/**
 * The registration of a patch.
 *
 * The patch of the proposal is registered in the patches file of the
 * app: a patch that the app does not register is not a migration.
 */
function patchRegistration(
	mechanism: FrappeOperationMechanism,
	patchPath: string | undefined,
	patches: string[],
): Record<string, unknown> | undefined {
	if (mechanism !== "patch" || !patchPath) return undefined;
	const registered = patches.some(
		(patch) => patch.endsWith(patchPath) || patchPath.endsWith(patch),
	);
	return registered ? { patch: patchPath } : undefined;
}

/**
 * The text of an answer.
 */
function textOf(
	details: FrappeLifecycleDetails,
	assessment: { proposal: string; target: { site?: string; app?: string } },
): string {
	const lines = [
		`The operation may ${details.dispatch === "execute" ? "run" : details.dispatch}: ${details.reason}.`,
		`The operation: ${assessment.proposal}`,
		`The effect: ${details.effect}; the mechanism: ${details.mechanism}.`,
	];
	if (details.ownerApp) {
		lines.push(`The DocType belongs to the app ${details.ownerApp}.`);
	}
	if (details.unknowns.length > 0) {
		lines.push(`What is not known: ${details.unknowns.join("; ")}.`);
	}
	if (details.dispatch === "execute") {
		lines.push("You may run it as it was proposed.");
	} else if (details.dispatch === "countdown") {
		lines.push(
			"The operation waits for the confirmation to expire. Do not run it before the confirmation.",
		);
	} else if (details.dispatch === "approval") {
		lines.push(
			"The human was asked. Do not run the operation until the answer arrives.",
		);
	} else {
		lines.push("Do not run the operation. The evidence has to come first.");
	}
	return lines.join("\n");
}

/**
 * Register the tool of the Frappe lifecycle.
 */
export function registerFrappeLifecycleTool(
	pi: { registerTool(tool: unknown): void },
	options: FrappeLifecycleToolOptions,
): void {
	pi.registerTool(createFrappeLifecycleTool(options));
}
