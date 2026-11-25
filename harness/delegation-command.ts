/**
 * The command that records a delegation of the timeout decision.
 *
 * A delegation says: "if I do not answer within the window, continue with
 * a commit". The deadline of a question is not an answer: without a
 * delegation the work simply stays blocked when the window passes.
 *
 * The delegation is durable and belongs to a workspace, so this module owns
 * two things: the parsing of what the user asked for, and the report the
 * user sees. The harness owns the wiring of the command.
 *
 * The vocabulary of the kinds is small and closed. A kind that is not in
 * it authorizes nothing, so an unknown kind is refused here instead of
 * being stored and ignored later.
 */
import type { DelegationStore } from "./delegation-store.ts";
import type {
	DelegatedOperationKind,
	Delegation,
} from "./delegated-approval-types.ts";
import {
	DELEGATED_OPERATION_KINDS,
	isDelegatedOperationKind,
} from "./delegated-approval-types.ts";

/**
 * What the user asked for.
 */
export type DelegationAction = "list" | "add" | "remove" | "help";

/**
 * The plan of a command.
 *
 * The plan is the decision of the parser: it says what to do, and it
 * carries the message for the user when the request cannot be honoured.
 */
export interface DelegationPlan {
	/** What to do. */
	action: DelegationAction;
	/** The kinds an "add" covers. */
	kinds: DelegatedOperationKind[];
	/** What happens at the deadline. */
	defaultOutcome: "continue" | "block";
	/** The id a "remove" names. */
	id?: string;
	/** The message for the user, when the request was refused. */
	message?: string;
}

/**
 * The kinds the user may name, as one line.
 */
export function delegationVocabulary(): string {
	return DELEGATED_OPERATION_KINDS.join(", ");
}

/**
 * The id of a delegation.
 *
 * The id is readable: the user removes a delegation by its id, and a name
 * that says what it covers is easier to recognise than a number.
 */
export function delegationId(kinds: DelegatedOperationKind[], now: number): string {
	return `${kinds.join("-") || "delegation"}-${now}`;
}

/**
 * Parse what the user asked for.
 *
 * The command is:
 *
 * - `/harness-delegate` or `/harness-delegate list`: the delegations of
 *   the workspace.
 * - `/harness-delegate add <kind> [<kind> ...] [continue|block]`: a new
 *   delegation.
 * - `/harness-delegate remove <id>`: the end of a delegation.
 * - `/harness-delegate help`: the vocabulary and the syntax.
 *
 * The default outcome is `continue`: the user delegated the operation, so
 * the work continues at the deadline. `block` keeps the work blocked.
 */
export function parseDelegationCommand(args: string | string[]): DelegationPlan {
	const tokens = (Array.isArray(args) ? args.join(" ") : args)
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length > 0);

	if (tokens.length === 0) {
		return { action: "list", kinds: [], defaultOutcome: "continue" };
	}

	const [head, ...rest] = tokens;

	if (head === "help" || head === "--help" || head === "-h") {
		return { action: "help", kinds: [], defaultOutcome: "continue" };
	}

	if (head === "list") {
		return { action: "list", kinds: [], defaultOutcome: "continue" };
	}

	if (head === "remove" || head === "rm") {
		const id = rest[0];
		if (!id) {
			return {
				action: "remove",
				kinds: [],
				defaultOutcome: "continue",
				message:
					"Which delegation should be removed? Name its id: /harness-delegate remove <id>",
			};
		}
		return {
			action: "remove",
			kinds: [],
			defaultOutcome: "continue",
			id,
		};
	}

	if (head === "add" || head === "record") {
		if (rest.length === 0) {
			return {
				action: "add",
				kinds: [],
				defaultOutcome: "continue",
				message: `Which kind of operation may continue without your answer? One or more of: ${delegationVocabulary()}. Example: /harness-delegate add commit-and-push continue`,
			};
		}
		let defaultOutcome: "continue" | "block" = "continue";
		const named = [...rest];
		const last = named.at(-1);
		if (last === "continue" || last === "block") {
			defaultOutcome = last;
			named.pop();
		}
		const kinds: DelegatedOperationKind[] = [];
		const unknown: string[] = [];
		for (const token of named) {
			if (isDelegatedOperationKind(token)) {
				if (!kinds.includes(token)) kinds.push(token);
				continue;
			}
			unknown.push(token);
		}
		if (unknown.length > 0) {
			return {
				action: "add",
				kinds: [],
				defaultOutcome,
				message: `Unknown kind${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. A delegation covers one or more of: ${delegationVocabulary()}.`,
			};
		}
		return { action: "add", kinds, defaultOutcome };
	}

	return {
		action: "help",
		kinds: [],
		defaultOutcome: "continue",
		message: `Unknown command "${head}". Use list, add, remove or help.`,
	};
}

/**
 * The report of the delegations of a workspace.
 *
 * The report names the workspace: a delegation belongs to one, and the
 * user has to see which one they are looking at.
 */
export function delegationReport(
	workspace: string,
	delegations: Delegation[],
): string {
	const lines = [`Delegations of ${workspace}:`];
	if (delegations.length === 0) {
		lines.push(
			"- none. A question that nobody answers stays blocked at its deadline.",
		);
	}
	for (const delegation of delegations) {
		lines.push(
			`- ${delegation.id}: ${delegation.kinds.join(", ")} | at the deadline: ${
				delegation.defaultOutcome === "continue" ? "continue" : "stay blocked"
			} | recorded ${new Date(delegation.recordedAt).toISOString()}`,
		);
	}
	// The user has to know that a delegation does not end by itself: the
	// newest delegation that covers an operation is the one that counts,
	// and an older one stays in force until it is removed.
	lines.push(
		"A delegation stays in force until it is removed. A newer delegation of the same operations replaces the older one.",
	);
	return lines.join("\n");
}

/**
 * What the command does to the store.
 */
export interface DelegationCommandResult {
	/** The message for the user. */
	message: string;
	/** The error of the command, when it failed. */
	failed: boolean;
}

/**
 * Run the plan against the store.
 *
 * The plan is honoured exactly as it was parsed: a plan that names an
 * unknown kind never reaches the store.
 */
export function applyDelegationCommand(
	plan: DelegationPlan,
	options: {
		store: DelegationStore;
		workspace: string;
		now: number;
	},
): DelegationCommandResult {
	if (plan.action === "list") {
		return {
			message: delegationReport(
				options.workspace,
				options.store.list(options.workspace),
			),
			failed: false,
		};
	}

	if (plan.action === "help") {
		const lines: string[] = [];
		if (plan.message) {
			lines.push(plan.message, "");
		}
		lines.push(
			"A delegation says: if I do not answer within the window, continue with this operation.",
			"",
			"/harness-delegate list - the delegations of this workspace",
			"/harness-delegate add <kind> [<kind> ...] [continue|block] - record one",
			"/harness-delegate remove <id> - end one",
			"",
			`The kinds are: ${delegationVocabulary()}.`,
			"A delegation for one kind never covers another.",
		);
		return {
			message: lines.join("\n"),
			failed: false,
		};
	}

	if (plan.action === "remove") {
		if (!plan.id) {
			return {
				message:
					plan.message ??
					"Which delegation should be removed? Name its id: /harness-delegate remove <id>",
				failed: true,
			};
		}
		const removed = options.store.remove(plan.id, options.workspace);
		if (!removed) {
			return {
				message: `No delegation "${plan.id}" was found in ${options.workspace}.`,
				failed: true,
			};
		}
		return {
			message: `The delegation "${plan.id}" was removed.`,
			failed: false,
		};
	}

	if (plan.kinds.length === 0) {
		return {
			message:
				plan.message ??
				`Which kind of operation may continue without your answer? One or more of: ${delegationVocabulary()}.`,
			failed: true,
		};
	}

	const id = delegationId(plan.kinds, options.now);
	options.store.record({
		id,
		workspace: options.workspace,
		kinds: plan.kinds,
		defaultOutcome: plan.defaultOutcome,
		recordedAt: options.now,
	});
	return {
		message: [
			`The delegation "${id}" was recorded for ${options.workspace}.`,
			`It covers: ${plan.kinds.join(", ")}.`,
			`At the deadline the work will ${
				plan.defaultOutcome === "continue" ? "continue" : "stay blocked"
			}.`,
			`Remove it with: /harness-delegate remove ${id}`,
		].join("\n"),
		failed: false,
	};
}
