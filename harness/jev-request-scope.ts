/**
 * The scope of a request in the task list.
 *
 * The task list is the history of the session: the todos of a request that
 * was finished stay in it. A new request therefore inherits a list that is
 * already complete, and the completion of the old request says nothing
 * about the new one.
 *
 * This module keeps the two apart without deleting anything. It remembers
 * how the list looked when the request started, and it derives from that
 * memory which todos belong to the request that is running.
 *
 * The list alone is not enough to tell that: a todo that the request
 * reopened and finished again looks exactly like the todo it was before.
 * The history of the list says what a change touched, so the request keeps
 * the todo it worked on.
 *
 * Nothing here touches the list: the history stays a record of what
 * happened, and the scope is only a reading of it.
 */

/**
 * The part of a todo item the scope needs.
 */
export interface RequestTodoLike {
	/** The id of the item, when the list has one. */
	id?: number | string;
	/** The subject of the item. */
	subject?: string;
	/** The status of the item ("pending", "in_progress", "completed", ...). */
	status: string;
}

/**
 * One state of the list in its history.
 */
export interface TodoHistoryLike {
	/** The list as it was after the change. */
	items: readonly RequestTodoLike[];
}

/**
 * The scope of the request that is running.
 */
export interface JevRequestScope {
	/** The number of the request. It grows with every request of the human. */
	readonly generation: number;
	/**
	 * The list as it was when the request started: the key of the item and
	 * the shape it had then.
	 */
	readonly baseline: ReadonlyMap<string, string>;
	/**
	 * The keys of the todos that the request touched.
	 *
	 * A todo belongs to the request when the request changed it, also when
	 * the change left it in the state it had before.
	 */
	readonly touched: ReadonlySet<string>;
	/**
	 * The number of states the list had when the request started.
	 *
	 * The states after this number are the changes of the request.
	 */
	readonly historyIndex: number;
	/**
	 * Is the number of states known?
	 *
	 * The history of the list could not be read when the request started:
	 * the changes of the request cannot be told from the changes of the
	 * earlier requests, so the history is not used at all.
	 */
	readonly historyKnown: boolean;
}

/**
 * Is the todo still open?
 */
export function isOpenTodo(item: RequestTodoLike): boolean {
	return item.status === "pending" || item.status === "in_progress";
}

/**
 * The key of an item.
 *
 * An item without an id has no key: it cannot be told apart from another
 * one, so it is always treated as new.
 */
function itemKey(item: RequestTodoLike): string | null {
	if (item.id === undefined || item.id === null) return null;
	return `id:${String(item.id)}`;
}

/**
 * The shape of an item: what a request may change about it.
 */
function itemShape(item: RequestTodoLike): string {
	return `${item.status}\0${(item.subject ?? "").trim()}`;
}

/**
 * The keys of the items that a change touched.
 *
 * The history is a sequence of states. A change touched an item when the
 * item is new, when its status or its subject changed, and when it is gone.
 * An item that was reopened and finished again is touched twice: the
 * request that did it keeps the item.
 */
export function touchedKeys(
	history: readonly TodoHistoryLike[] | null | undefined,
	from: number,
): Set<string> {
	const touched = new Set<string>();
	if (!history || history.length === 0) return touched;
	// The state before the request is the last one before its first change.
	const start = Math.max(1, from);
	for (let index = start; index < history.length; index += 1) {
		const before = new Map<string, RequestTodoLike>();
		for (const item of history[index - 1]?.items ?? []) {
			const key = itemKey(item);
			if (key !== null) before.set(key, item);
		}
		const after = new Map<string, RequestTodoLike>();
		for (const item of history[index]?.items ?? []) {
			const key = itemKey(item);
			if (key !== null) after.set(key, item);
		}
		for (const [key, item] of after) {
			const previous = before.get(key);
			if (
				!previous ||
				previous.status !== item.status ||
				(previous.subject ?? "").trim() !== (item.subject ?? "").trim()
			) {
				touched.add(key);
			}
		}
		for (const key of before.keys()) {
			// The item is gone: the change that removed it touched it.
			if (!after.has(key)) touched.add(key);
		}
	}
	return touched;
}

/**
 * Remember how the list looked when the request started.
 */
export function captureRequestScope(
	items: readonly RequestTodoLike[] | null | undefined,
	generation: number,
	options: {
		/** The keys of the todos that the request touched. */
		touched?: ReadonlySet<string>;
		/** The number of states the list had when the request started. */
		historyIndex?: number;
		/**
		 * Is the number of states known?
		 *
		 * Without it the history is not read: the changes of the request
		 * cannot be told from the changes of the earlier requests.
		 */
		historyKnown?: boolean;
	} = {},
): JevRequestScope {
	const baseline = new Map<string, string>();
	for (const item of items ?? []) {
		const key = itemKey(item);
		if (key === null) continue;
		baseline.set(key, itemShape(item));
	}
	return {
		generation,
		baseline,
		touched: options.touched ?? new Set<string>(),
		historyIndex: options.historyIndex ?? 0,
		historyKnown: options.historyKnown ?? options.touched !== undefined,
	};
}

/**
 * The todos that belong to the request.
 *
 * A todo belongs to the request when the request created it or changed it.
 * A todo that was already finished when the request started belongs to the
 * request that finished it, and its completion says nothing about this one.
 */
export function itemsOfRequest(
	items: readonly RequestTodoLike[],
	scope: JevRequestScope | null | undefined,
): RequestTodoLike[] {
	if (!scope) return [...items];
	return items.filter((item) => {
		const key = itemKey(item);
		// An item without an id cannot be told apart: it belongs to the
		// request that is running.
		if (key === null) return true;
		// The request touched the item, also when the change left it in the
		// state it had before.
		if (scope.touched.has(key)) return true;
		const before = scope.baseline.get(key);
		// The item was not there when the request started.
		if (before === undefined) return true;
		// The request changed it.
		return before !== itemShape(item);
	});
}

/**
 * The subjects of the todos, without the empty ones.
 */
export function scopeSubjects(items: readonly RequestTodoLike[]): string[] {
	return items
		.map((item) => (item.subject ?? "").trim())
		.filter((subject) => subject.length > 0);
}

/**
 * The scope of the request that is running.
 *
 * The tracker is the boundary between the requests of the human and the
 * history of the task list. It reads the list when a request starts, so the
 * scope of the request is the list as it was before the request touched it.
 */
export class RequestScopeTracker {
	/** The number of the request that is running. */
	private _generation = 0;
	/** The scope of the request that is running, once it was read. */
	private _pending: Promise<JevRequestScope | null> | null = null;
	/** The read of the task list. */
	private readonly readTodos: () => Promise<
		readonly RequestTodoLike[] | null | undefined
	>;
	/** The read of the history of the task list. */
	private readonly readHistory?: () => Promise<
		readonly TodoHistoryLike[] | null | undefined
	>;

	constructor(options: {
		/** Read the task list as it is now. */
		readTodos: () => Promise<readonly RequestTodoLike[] | null | undefined>;
		/**
		 * Read the history of the task list: the state after every change.
		 *
		 * Without it the tracker sees the list alone, and a todo that the
		 * request reopened and finished again looks like the todo it was
		 * before.
		 */
		readHistory?: () => Promise<readonly TodoHistoryLike[] | null | undefined>;
	}) {
		this.readTodos = options.readTodos;
		this.readHistory = options.readHistory;
	}

	/**
	 * The number of the request that is running.
	 */
	get generation(): number {
		return this._generation;
	}

	/**
	 * A new request of the human begins.
	 *
	 * The list is read now, while the request has not touched it: this is
	 * the work that the request inherits. The read of the list is
	 * asynchronous, so the capture happens when the list arrives: the
	 * scope is the list of that moment and not of a later one. The history
	 * is read after the list, so the changes of the request are never
	 * counted as the changes of an earlier one.
	 *
	 * A message of the harness itself does not begin a request: it is the
	 * harness that continues the work, not the human that asks for it.
	 */
	begin(): number {
		this._generation += 1;
		const generation = this._generation;
		this._pending = (async () => {
			let items: readonly RequestTodoLike[] | null | undefined;
			try {
				items = await this.readTodos();
			} catch {
				// The list could not be read: there is no evidence of what
				// the request inherits, so there is no scope.
				return null;
			}
			let history: readonly TodoHistoryLike[] | null = null;
			try {
				history = (await this.readHistory?.()) ?? null;
			} catch {
				history = null;
			}
			return captureRequestScope(items ?? null, generation, {
				historyIndex: history?.length ?? 0,
				historyKnown: history !== null,
			});
		})();
		return generation;
	}

	/**
	 * The session changed.
	 *
	 * The scope of the previous session says nothing about the new one: the
	 * todos of the previous session are the history of that session. The
	 * scope is dropped, and the work of the new session is read without a
	 * scope until the human asks for something.
	 */
	reset(): void {
		this._generation += 1;
		this._pending = null;
	}

	/**
	 * The scope of the request that is running.
	 *
	 * The scope is read together with the list, so the two belong to the
	 * same request: a request that starts while the list is read owns the
	 * work now, and the read of the old scope is stale.
	 */
	async read(): Promise<{
		scope: JevRequestScope | null;
		items: readonly RequestTodoLike[] | null;
	}> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const pending = this._pending;
			let items: readonly RequestTodoLike[] | null = null;
			try {
				items = (await this.readTodos()) ?? null;
			} catch {
				items = null;
			}
			const scope = pending ? await pending : null;
			// A request that started in the meantime owns the work now.
			if (pending !== this._pending) continue;
			let history: readonly TodoHistoryLike[] | null = null;
			try {
				history = (await this.readHistory?.()) ?? null;
			} catch {
				history = null;
			}
			// A request that started while the history was read owns the
			// work now: the scope of the older request is stale.
			if (pending !== this._pending) continue;
			// The history is only read when the number of states was known
			// when the request started: otherwise the changes of the earlier
			// requests would look like the changes of this one.
			const touched =
				scope?.historyKnown === true
					? touchedKeys(history, scope.historyIndex)
					: new Set<string>();
			return { scope: scope ? { ...scope, touched } : null, items };
		}
		return { scope: null, items: null };
	}
}
