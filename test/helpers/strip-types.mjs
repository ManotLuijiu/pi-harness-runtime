import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/**
 * Strip the TypeScript syntax from a source file.
 *
 * Node exposes `node:module.stripTypeScriptTypes` (since v22.13; the
 * "transform" mode needs a newer v22/v24). Bun 1.3.14 does not have it, but
 * it ships `Bun.Transpiler`. The test suite runs under both runtimes, so
 * the helper picks whichever is available.
 *
 * The two are NOT equivalent:
 *
 * - node's default "strip" mode erases the types and keeps the source
 *   positions; "transform" mode transpiles the TypeScript away.
 * - `Bun.Transpiler` always transpiles (it rewrites enums, namespaces and
 *   parameter properties into runtime code).
 *
 * The bun path is therefore a transform, not a strip: the caller must only
 * rely on the result being valid JavaScript, never on its exact shape. Ask
 * for `{ mode: "transform" }` so both runtimes use the same semantics - a
 * request for another mode is rejected under bun instead of silently
 * returning something different.
 */
export function stripTypeScriptTypes(source, options = {}) {
	// "transform" is the only mode both runtimes support: node has it since
	// v22.13 (transform mode) and bun always transpiles.
	const mode = options.mode ?? "transform";
	const nodeModule = require("node:module");

	if (typeof nodeModule.stripTypeScriptTypes === "function") {
		try {
			return nodeModule.stripTypeScriptTypes(source, { ...options, mode });
		} catch (error) {
			throw new Error(
				`node:module.stripTypeScriptTypes failed for mode "${mode}" (node ${process.versions.node}): ${error?.message ?? error}`,
			);
		}
	}

	if (globalThis.Bun?.Transpiler) {
		if (mode !== "transform") {
			throw new Error(
				`mode "${mode}" is not supported under bun (bun only transpiles) - use { mode: "transform" }`,
			);
		}
		return new globalThis.Bun.Transpiler({ loader: "ts" }).transformSync(source);
	}

	throw new Error(
		"No TypeScript stripper available (node:module.stripTypeScriptTypes or Bun.Transpiler)",
	);
}
