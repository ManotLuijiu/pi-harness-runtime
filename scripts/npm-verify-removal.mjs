#!/usr/bin/env node
/**
 * Verify that an npm removal actually happened.
 *
 * The removal itself is irreversible, so the report that follows it has to
 * be trustworthy. The obvious way to check - ask the registry for one
 * version at a time and treat a non-zero exit as "the version is gone" -
 * cannot tell "the version is gone" from "the registry did not answer".
 * A network hiccup during the check therefore reads as a successful
 * removal, and the operator is told the private content is gone while it
 * is still published.
 *
 * This verifier separates the two.
 *
 * What it proves, for a version that should be gone:
 *
 *   1. The version is absent from the packument's version map. The
 *      packument keeps a `time` entry that still names a removed version,
 *      so the version map - not the whole document - is the criterion.
 *   2. The tarball answers 404. The packument entry is the listing; the
 *      tarball is the content. Only the second one proves that the
 *      private content is no longer downloadable.
 *
 * What it proves, for a version that should remain:
 *
 *   1. The version is still in the version map.
 *
 * What it proves, for a dist-tag:
 *
 *   1. The tag still points at the version it pointed at before.
 *
 * Exit codes:
 *
 *   0  everything the spec asks for was proven.
 *   1  the spec was not met: a version is still published, a version is
 *      missing, or a dist-tag moved.
 *   2  the state could not be established. The registry was unreachable
 *      or answered something unexpected. This is NOT a pass, and it is
 *      deliberately not the same code as a failure, because "I could not
 *      check" and "the check failed" call for different responses.
 *
 * The check reads the registry without a credential. It therefore proves
 * what an anonymous reader can see, which is exactly the exposure that
 * matters here.
 *
 * Usage:
 *
 *   node scripts/npm-verify-removal.mjs <package> <spec.json>
 *   node scripts/npm-verify-removal.mjs <package> --capture <spec.json> <version> [version ...]
 *
 * The capture form records the state that the check will later prove: the
 * versions to remove, every other published version as one to keep, and
 * the dist-tags as they are at that moment. Capturing before the removal
 * is what makes the later check meaningful - a spec written by hand can
 * describe a state that was never the real one.
 *
 * The spec is a JSON document:
 *
 *   {
 *     "gone": ["1.1.390", "1.1.391"],
 *     "keep": ["1.1.425"],
 *     "tags": { "latest": "1.1.433" }
 *   }
 *
 * Every section is optional. The registry comes from
 * npm_config_registry, so a test can point it at a local server.
 */

import { readFile, writeFile } from "node:fs/promises";

const REGISTRY = (process.env.npm_config_registry || "https://registry.npmjs.org").replace(/\/+$/, "");

/**
 * The number of tarball probes that run at once. Each probe is a HEAD
 * against a different URL, so the limit is about the registry's patience
 * rather than this process's memory.
 */
const PROBE_CONCURRENCY = 6;

async function main() {
	const args = process.argv.slice(2);
	const packageName = args[0];
	if (!packageName) {
		process.stderr.write("usage: npm-verify-removal.mjs <package> <spec.json>\n");
		process.stderr.write("       npm-verify-removal.mjs <package> --capture <spec.json> <version> [version ...]\n");
		return 2;
	}

	// The capture form records the current state instead of checking it.
	if (args[1] === "--capture") {
		const [, , specPath, ...gone] = args;
		if (!specPath || gone.length === 0) {
			process.stderr.write("usage: npm-verify-removal.mjs <package> --capture <spec.json> <version> [version ...]\n");
			return 2;
		}
		return capture(packageName, specPath, gone);
	}

	const specPath = args[1];
	if (!specPath) {
		process.stderr.write("usage: npm-verify-removal.mjs <package> <spec.json>\n");
		return 2;
	}

	let spec;
	try {
		spec = JSON.parse(await readFile(specPath, "utf8"));
	} catch (error) {
		process.stderr.write(`could not read the spec: ${error.message}\n`);
		return 2;
	}

	const gone = spec.gone ?? [];
	const keep = spec.keep ?? [];
	const tags = spec.tags ?? {};

	// One request for the whole packument. Asking per version would be
	// 31 requests for a 31-version removal, and the whole document is
	// what every check below needs.
	let packument;
	try {
		const response = await fetch(packumentUrl(packageName));
		if (!response.ok) {
			process.stdout.write(`could not verify: the registry answered ${response.status} for the packument\n`);
			return 2;
		}
		packument = await response.json();
	} catch (error) {
		process.stdout.write(`could not verify: the registry could not be reached (${error.message})\n`);
		return 2;
	}

	const published = new Set(Object.keys(packument.versions ?? {}));
	const failures = [];

	// The versions that should be gone.
	const stillPublished = gone.filter((version) => published.has(version));
	for (const version of stillPublished) {
		failures.push(`still published: ${version}`);
	}

	// The versions that should remain.
	const missing = keep.filter((version) => !published.has(version));
	for (const version of missing) {
		failures.push(`missing: ${version}`);
	}

	// The dist-tags, which must not have moved.
	const currentTags = packument["dist-tags"] ?? {};
	for (const [name, expected] of Object.entries(tags)) {
		const actual = currentTags[name];
		if (actual !== expected) {
			failures.push(`dist-tag ${name} points at ${actual ?? "(unset)"}, expected ${expected}`);
		}
	}

	// The tarballs. A removed version must not be downloadable.
	const probes = await mapLimit(
		gone.filter((version) => !published.has(version)),
		PROBE_CONCURRENCY,
		(version) => probeTarball(packageName, version),
	);
	let unknown = 0;
	for (const [version, result] of probes) {
		if (result === "gone") continue;
		if (result === "alive") {
			failures.push(`the tarball is still downloadable: ${version}`);
		} else {
			unknown++;
			failures.push(`could not determine the tarball state: ${version}`);
		}
	}

	// The report.
	process.stdout.write(`package: ${packageName}\n`);
	process.stdout.write(`registry: ${REGISTRY}\n`);
	process.stdout.write(`published versions: ${published.size}\n`);
	process.stdout.write(`expected gone: ${gone.length}, expected to remain: ${keep.length}\n`);
	if (Object.keys(tags).length > 0) {
		const shown = Object.entries(tags)
			.map(([name, value]) => `${name}=${value}`)
			.join(", ");
		process.stdout.write(`dist-tags checked: ${shown}\n`);
	}

	if (unknown > 0) {
		process.stdout.write(`could not verify: ${unknown} tarball probe(s) did not answer\n`);
		return 2;
	}
	if (failures.length > 0) {
		process.stdout.write("not verified:\n");
		for (const failure of failures) process.stdout.write(`  ${failure}\n`);
		return 1;
	}

	process.stdout.write("verified:\n");
	process.stdout.write(`  every one of the ${gone.length} removed version(s) is absent and its tarball answers 404\n`);
	process.stdout.write(`  every one of the ${keep.length} retained version(s) is still published\n`);
	if (Object.keys(tags).length > 0) process.stdout.write("  every dist-tag still points where it did\n");
	return 0;
}

/**
 * Record the state that a later check will prove.
 *
 * Every published version that is not on the removal list is recorded as
 * one to keep, and the dist-tags are recorded as they are now. A spec
 * that was written by hand can describe a state that was never the real
 * one; a captured one cannot.
 */
async function capture(packageName, specPath, gone) {
	let packument;
	try {
		const response = await fetch(packumentUrl(packageName));
		if (!response.ok) {
			process.stdout.write(`could not capture: the registry answered ${response.status} for the packument\n`);
			return 2;
		}
		packument = await response.json();
	} catch (error) {
		process.stdout.write(`could not capture: the registry could not be reached (${error.message})\n`);
		return 2;
	}

	const published = Object.keys(packument.versions ?? {});
	const removing = new Set(gone);
	const keep = published.filter((version) => !removing.has(version));
	const spec = {
		gone: [...removing],
		keep,
		tags: packument["dist-tags"] ?? {},
	};
	await writeFile(specPath, `${JSON.stringify(spec, null, 2)}\n`);

	process.stdout.write(`captured the registry state into ${specPath}\n`);
	process.stdout.write(`  to remove: ${spec.gone.length}\n`);
	process.stdout.write(`  to keep:  ${spec.keep.length}\n`);
	const shown = Object.entries(spec.tags)
		.map(([name, value]) => `${name}=${value}`)
		.join(", ");
	if (shown) process.stdout.write(`  dist-tags: ${shown}\n`);
	return 0;
}

/**
 * The packument URL. A scoped name is encoded so the registry reads it
 * as one package rather than a path.
 */
function packumentUrl(packageName) {
	const encoded = packageName.startsWith("@") ? packageName.replace("/", "%2f") : packageName;
	return `${REGISTRY}/${encoded}`;
}

/**
 * The tarball URL. npm names the file after the package without its
 * scope, so `@scope/name` publishes `name-<version>.tgz`.
 */
function tarballUrl(packageName, version) {
	const bare = packageName.startsWith("@") ? packageName.slice(packageName.indexOf("/") + 1) : packageName;
	return `${REGISTRY}/${packageName}/-/${bare}-${version}.tgz`;
}

/**
 * Probe one tarball. A HEAD is enough: the registry answers it with the
 * same status it gives the GET, without moving the body.
 *
 * The three answers are kept apart on purpose:
 *
 *   "gone"   the registry answered 404. The content is not downloadable.
 *   "alive"  the registry answered 200. The content is still there.
 *   "unknown" the registry did not answer. Nothing was proven.
 */
async function probeTarball(packageName, version) {
	try {
		const response = await fetch(tarballUrl(packageName, version), { method: "HEAD" });
		if (response.status === 404) return "gone";
		if (response.status === 200) return "alive";
		return "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * Run an async worker over a list with a bounded number in flight.
 */
async function mapLimit(items, limit, worker) {
	const results = [];
	let next = 0;
	const runner = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = [items[index], await worker(items[index])];
		}
	};
	const runners = [];
	for (let i = 0; i < Math.min(limit, items.length); i++) runners.push(runner());
	await Promise.all(runners);
	return results;
}

process.exit(await main());
