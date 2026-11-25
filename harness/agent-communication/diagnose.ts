/**
 * The diagnosis of a worker that did not answer.
 *
 * A worker that fails does not always fail in the same way: it may be
 * signed out, it may have used up its allowance, it may ask for a
 * permission that nobody answered, or it may simply be broken.
 *
 * The harness names the states it can prove and leaves the rest unknown.
 * A failure that is not understood stays a failure: the harness does not
 * call every broken worker a quota problem, because that is a guess about
 * the account of the user.
 */

import type { ConsultStatus } from "./types.ts";

/**
 * The sign of a worker that cannot run.
 *
 * The patterns are the words the vendored CLIs use when they are not
 * signed in or when their allowance is used up.
 */
const AUTH_OR_QUOTA = [
	/not logged in/i,
	/not signed in/i,
	/unauthorized/i,
	/unauthenticated/i,
	/invalid api key/i,
	/authentication (failed|error|required)/i,
	/please (run )?\/login/i,
	/login required/i,
	/insufficient[_ ]quota/i,
	/credit balance is too low/i,
	/usage limit/i,
	/rate limit/i,
	/too many requests/i,
	/quota exceeded/i,
];

/**
 * The sign of a worker that asks for a permission.
 *
 * The permission belongs to the human: the harness never answers it.
 */
const APPROVAL = [
	/approval/i,
	/requires? (your )?(permission|confirmation|approval)/i,
	/permission denied/i,
	/not allowed to run/i,
	/ask for approval/i,
];

/**
 * What the words of a worker say about the failure.
 *
 * The order matters: a worker that is not signed in says so before it
 * talks about anything else, and a worker that asks for a permission is
 * not an account problem.
 */
export function classifyWorkerFailure(text: string): {
	status: ConsultStatus;
	diagnostic: string;
} {
	const value = text ?? "";
	if (AUTH_OR_QUOTA.some((pattern) => pattern.test(value))) {
		return {
			status: "blocked-auth-or-quota",
			diagnostic: firstLine(value, "the worker cannot run: sign-in or allowance"),
		};
	}
	if (APPROVAL.some((pattern) => pattern.test(value))) {
		return {
			status: "blocked-approval",
			diagnostic: firstLine(value, "the worker asks for a permission"),
		};
	}
	return {
		status: "failed",
		diagnostic: firstLine(value, "the worker failed"),
	};
}

/**
 * The first line of a text, bounded.
 *
 * The reason is a line for the human: it names what happened, and it does
 * not carry the whole output of a worker.
 */
export function firstLine(text: string, fallback: string): string {
	const line = (text ?? "")
		.split("\n")
		.map((entry) => entry.trim())
		.find((entry) => entry.length > 0);
	const value = (line ?? fallback).slice(0, 300);
	return value.length > 0 ? value : fallback;
}
