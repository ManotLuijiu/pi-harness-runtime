/**
 * The progress of a request that the harness observes.
 *
 * The open work of a request is the list of its todos, but a chunk that
 * edits files does not always change that list: the agent works, the todo
 * keeps its id and its status, and the list alone cannot tell that work
 * from a loop.
 *
 * The harness observes the tool calls of the request and counts the ones
 * that changed a file. The counter is the bounded evidence of the
 * progress: it is a number, it belongs to the request, and a change of it
 * means that the request moved.
 *
 * The counter is not a judgement about the quality of the work. A call
 * that changed a file counts, even when the change was wrong: the
 * lifecycle of the request only needs to know that the agent did
 * something, and the review of the diff decides whether it was right.
 */

/**
 * The tools that change a file by themselves.
 */
const FILE_TOOLS = new Set(["edit", "write"]);

/**
 * The commands of a shell call that change a file.
 *
 * A shell call is not a change by itself: `ls` and `cat` read, `rm` and
 * `git checkout` write. The list names the commands that write, so a
 * reading call is never counted as progress.
 */
const MUTATING_COMMANDS = [
	/\brm\b/,
	/\bmv\b/,
	/\bcp\b/,
	/\bmkdir\b/,
	/\btouch\b/,
	/\bchmod\b/,
	/\bchown\b/,
	/\bln\b/,
	/\btruncate\b/,
	/\btee\b/,
	/\bpatch\b/,
	/\bsed\b[^|;&]*\s-i\b/,
	/\bgit\s+(checkout|switch|restore|apply|add|commit|reset|stash|clean|merge|rebase|cherry-pick)\b/,
	/\b(bun|npm|pnpm|yarn|pip|apt-get)\s+(install|add|remove)\b/,
];

/**
 * The shell calls that write into a file.
 */
const MUTATING_SHELL_TOOLS = new Set(["bash", "powershell", "shell"]);

/**
 * Does the call change a file?
 *
 * The answer is about the call, not about the result: the harness counts
 * the change when the call ends without an error, so a call that failed
 * changed nothing.
 */
export function changesFiles(toolName: string, input?: unknown): boolean {
	const name = (toolName ?? "").trim();
	if (FILE_TOOLS.has(name)) return true;
	if (!MUTATING_SHELL_TOOLS.has(name)) return false;
	const command = commandOf(input);
	if (!command) return false;
	// A redirection writes into a file.
	if (/(?:^|[^0-9a-zA-Z_>\-])>{1,2}\s*[^\s|&;]/.test(command)) return true;
	return MUTATING_COMMANDS.some((pattern) => pattern.test(command));
}

/**
 * The command of a shell call.
 */
function commandOf(input: unknown): string {
	if (!input || typeof input !== "object") return "";
	const record = input as Record<string, unknown>;
	for (const key of ["command", "cmd", "script", "code"]) {
		const value = record[key];
		if (typeof value === "string") return value;
	}
	return "";
}

/**
 * The progress of the request that is running.
 *
 * The counter is bounded in size and it belongs to the request: a new
 * request of the human starts a new counter, because the progress of the
 * old one says nothing about the new one.
 */
export class RequestProgress {
	private count = 0;

	/**
	 * A call changed a file.
	 */
	noteChange(): void {
		this.count += 1;
	}

	/**
	 * The token of the progress of the request.
	 *
	 * The token is empty when nothing changed: a request that changed
	 * nothing has no progress to show.
	 */
	token(): string {
		return this.count === 0 ? "" : `c${this.count}`;
	}

	/** How many changes the request made. */
	get changeCount(): number {
		return this.count;
	}

	/**
	 * A new request of the human begins.
	 *
	 * The progress of the old request is its own: the new one starts with
	 * an empty counter.
	 */
	reset(): void {
		this.count = 0;
	}
}
