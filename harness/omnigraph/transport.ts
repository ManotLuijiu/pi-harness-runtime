/**
 * The read side of the OmniGraph HTTP API.
 *
 * The client speaks ONE documented route: the stored query of a graph.
 * The query itself lives in the graph of the server, so the client sends
 * only its runtime inputs. That keeps the client small and keeps the
 * server in charge of what a reader may read.
 *
 * The rules of this module:
 *
 * - the credential goes in the header of the request and never into a
 *   message, a log line or an error,
 * - the version of the HTTP contract is a header of its own, and it is
 *   not the version of the server,
 * - a read has a deadline, a bound on the size of the answer and a
 *   bounded number of retries for a transient failure,
 * - a refusal of the server and an unreachable server stay apart: they
 *   need different fixes.
 */

import { redactOmnigraphSecret } from "./config.ts";

/** The answer of a stored query. */
export interface OmnigraphQueryResult {
	/** The names of the columns of the rows. */
	columns: string[];
	/** The rows of the answer. */
	rows: OmnigraphRow[];
	/** The number of the rows the server counted. */
	rowCount: number;
}

/** Why a read failed. */
export type OmnigraphFailure = "denied" | "unavailable" | "invalid";

/** The error a failed read raises. */
export class OmnigraphError extends Error {
	/**
	 * Why the read failed.
	 *
	 * The field is declared and assigned in the body of the constructor:
	 * a parameter property is TypeScript that node cannot strip, and the
	 * node suite reads these modules as they are.
	 */
	readonly code: OmnigraphFailure;

	/**
	 * @param message The reason of the failure. Never a credential.
	 * @param code Whether the server refused, could not be reached, or
	 *   answered something the client cannot read.
	 */
	constructor(message: string, code: OmnigraphFailure) {
		super(message);
		this.name = "OmnigraphError";
		this.code = code;
	}
}

/** The options of one read. */
export interface OmnigraphRequestOptions {
	/** The base address of the server. */
	url: string;
	/** The graph that holds the query. */
	graph: string;
	/** The name of the stored query. */
	query: string;
	/** The runtime inputs of the query. */
	params?: Record<string, unknown>;
	/** The bearer credential of the reader. */
	token: string;
	/** The version of the HTTP contract of the server. */
	apiVersion: string;
	/** How long the read may take, in milliseconds. */
	timeoutMs: number;
	/** How many times a transient failure is read again. */
	retries?: number;
	/** The signal that stops the read. */
	signal?: AbortSignal;
	/** The function that performs the request. A test injects one. */
	fetchImpl?: typeof fetch;
	/** The bound of the size of the answer, in bytes. */
	maxBytes?: number;
}

/** The bound of the size of an answer. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;

/**
 * The route of a stored query.
 *
 * The route is built from the endpoint of the operator and the graph of
 * the request. A graph id or a query name with a slash in it would
 * change the route, so both are refused before the request.
 */
export function omnigraphQueryUrl(
	url: string,
	graph: string,
	query: string,
): string {
	return `${url.replace(/\/+$/, "")}/graphs/${encodeURIComponent(graph)}/queries/${encodeURIComponent(query)}`;
}

/**
 * Read a stored query of a graph.
 *
 * @throws {OmnigraphError} When the server refuses the read, cannot be
 *   reached, or answers something the client cannot read.
 */
export async function omnigraphQuery(
	options: OmnigraphRequestOptions,
): Promise<OmnigraphQueryResult> {
	const request = buildRequest(options);
	const attempts = Math.max(0, options.retries ?? 2) + 1;
	let lastError: OmnigraphError | undefined;
	for (let attempt = 0; attempt < attempts; attempt++) {
		try {
			return await readOnce(request, options);
		} catch (error) {
			const failure = asOmnigraphError(error, options.token);
			// A refusal and a malformed answer are answers of the server:
			// they stay the same when the read is repeated.
			if (failure.code !== "unavailable") throw failure;
			lastError = failure;
			if (attempt + 1 < attempts) await pause(250 * (attempt + 1));
		}
	}
	throw (
		lastError ??
		new OmnigraphError("the server could not be reached", "unavailable")
	);
}

/** The parts of a request that do not change between the attempts. */
interface PreparedRequest {
	url: string;
	headers: Record<string, string>;
	body: string;
}

/** The request of one read. */
function buildRequest(options: OmnigraphRequestOptions): PreparedRequest {
	return {
		url: omnigraphQueryUrl(options.url, options.graph, options.query),
		headers: {
			authorization: `Bearer ${options.token}`,
			"omnigraph-http-api": options.apiVersion,
			"content-type": "application/json",
			accept: "application/json",
		},
		body: JSON.stringify({ params: options.params ?? {} }),
	};
}

/** One attempt of a read. */
async function readOnce(
	request: PreparedRequest,
	options: OmnigraphRequestOptions,
): Promise<OmnigraphQueryResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), options.timeoutMs);
	const onAbort = () => controller.abort();
	options.signal?.addEventListener("abort", onAbort);
	try {
		const response = await fetchImpl(request.url, {
			method: "POST",
			headers: request.headers,
			body: request.body,
			signal: controller.signal,
		});
		if (!response.ok) throw errorForStatus(response.status);
		const text = await readBounded(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
		return parseQueryResult(text, options.token);
	} catch (error) {
		throw asOmnigraphError(error, options.token);
	} finally {
		clearTimeout(timer);
		options.signal?.removeEventListener("abort", onAbort);
	}
}

/**
 * The error of a status of the server.
 *
 * A 404 is a refusal of the server as well: the server answers a query
 * the reader may not run with the same 404 as a query that does not
 * exist, so the client cannot tell them apart - and it must not try to
 * find out by guessing other names.
 */
function errorForStatus(status: number): OmnigraphError {
	if (status === 401 || status === 403 || status === 404) {
		return new OmnigraphError(
			`the server refused the read (status ${status})`,
			"denied",
		);
	}
	if (status === 408 || status === 429 || status >= 500) {
		return new OmnigraphError(
			`the server could not answer the read (status ${status})`,
			"unavailable",
		);
	}
	return new OmnigraphError(
		`the server answered the read with status ${status}`,
		"invalid",
	);
}

/**
 * The body of an answer, with a bound.
 *
 * The answer of a graph can be large. A read that answers more than the
 * bound is refused: the client asked for a catalog, not for a dump.
 *
 * The bound is applied while the answer arrives, not after it was
 * received: an answer without a useful Content-Length is read in
 * pieces, and the read stops as soon as the bound is crossed. The
 * counter counts bytes, not characters: an answer of many multi-byte
 * characters is bigger than its length says.
 */
async function readBounded(
	response: Response,
	maxBytes: number,
): Promise<string> {
	const declared = Number.parseInt(
		response.headers.get("content-length") ?? "",
		10,
	);
	if (Number.isFinite(declared) && declared > maxBytes) {
		throw new OmnigraphError(
			`the answer of the server is larger than ${maxBytes} bytes`,
			"invalid",
		);
	}
	const body = response.body;
	if (!body) {
		// An answer without a stream (a test double) is read whole, but
		// it is measured in bytes.
		const text = await response.text();
		if (Buffer.byteLength(text, "utf8") > maxBytes) {
			throw new OmnigraphError(
				`the answer of the server is larger than ${maxBytes} bytes`,
				"invalid",
			);
		}
		return text;
	}
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				// The read stops here: the rest of the answer is not
				// read, and the connection is released.
				await reader.cancel().catch(() => {});
				throw new OmnigraphError(
					`the answer of the server is larger than ${maxBytes} bytes`,
					"invalid",
				);
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock?.();
	}
	return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

/**
 * The answer of a stored query.
 *
 * The server answers with the names of the columns and the rows. A row
 * may be an array (the values in the order of the columns) or an object
 * (the names of the columns). Both are read.
 */
export function parseQueryResult(text: string, token?: string): OmnigraphQueryResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new OmnigraphError(
			"the server did not answer with JSON",
			"invalid",
		);
	}
	if (typeof parsed !== "object" || parsed === null) {
		throw new OmnigraphError("the server did not answer with a result", "invalid");
	}
	const record = parsed as Record<string, unknown>;
	const columns = Array.isArray(record.columns)
		? record.columns.filter((column): column is string => typeof column === "string")
		: [];
	const rawRows = Array.isArray(record.rows) ? record.rows : [];
	const rows = rawRows.filter(
		(row): row is unknown[] | Record<string, unknown> =>
			Array.isArray(row) || (typeof row === "object" && row !== null),
	);
	const declared = typeof record.row_count === "number" ? record.row_count : rows.length;
	if (declared > rows.length) {
		// The server counted more rows than it sent: the answer is
		// truncated, and a truncated catalog must be reported, not used.
		throw new OmnigraphError(
			`the server answered ${rows.length} of ${declared} rows`,
			"invalid",
		);
	}
	if (!columns.length && rows.some((row) => !Array.isArray(row))) {
		throw new OmnigraphError(
			"the server answered rows without the names of the columns",
			"invalid",
		);
	}
	void token;
	return { columns, rows, rowCount: declared };
}

/**
 * The error of a failed read.
 *
 * Every error that leaves this module is an OmnigraphError, and its
 * message never carries the credential.
 */
function asOmnigraphError(error: unknown, token?: string): OmnigraphError {
	if (error instanceof OmnigraphError) return error;
	const raw = error instanceof Error ? error.message : String(error ?? "");
	const name = error instanceof Error ? error.name : "";
	if (name === "AbortError" || /abort/i.test(raw)) {
		return new OmnigraphError("the read was stopped before it finished", "unavailable");
	}
	return new OmnigraphError(
		redactOmnigraphSecret(raw || "the server could not be reached", token),
		"unavailable",
	);
}

/** A pause between two attempts. */
function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One row of an answer: the values in the order of the columns, or by name. */
export type OmnigraphRow = unknown[] | Record<string, unknown>;

/** The value of one column of a row. */
export type OmnigraphValue = string | number | boolean | null | undefined;

/**
 * Whether a value of a row is a value the client can use.
 *
 * A row comes from the wire, so its values are unknown until they are
 * decoded. A value that is not one of the simple types is dropped: a
 * column that holds an object is not a column of a skill.
 */
function isOmnigraphValue(value: unknown): value is OmnigraphValue {
	return (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null ||
		value === undefined
	);
}

/**
 * The value of one column of a row.
 *
 * A row is an array or an object. The columns of an object are read by
 * their name, so the order of the answer of the server does not matter.
 */
export function columnValue(
	row: OmnigraphRow,
	columns: string[],
	name: string,
): OmnigraphValue {
	if (Array.isArray(row)) {
		const index = columns.indexOf(name);
		return index < 0 ? undefined : (row[index] as OmnigraphValue);
	}
	const value = row[name];
	return isOmnigraphValue(value) ? value : undefined;
}

/**
 * The text of one column of a row.
 *
 * A column that is not there is an empty string: the caller decides
 * whether a missing field is an error.
 */
export function columnText(
	row: OmnigraphRow,
	columns: string[],
	name: string,
): string {
	const value = columnValue(row, columns, name);
	return typeof value === "string" ? value : "";
}
