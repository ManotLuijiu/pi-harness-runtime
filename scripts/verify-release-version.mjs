#!/usr/bin/env node
/**
 * The version that is published, and whether it may be published.
 *
 * The version of a release is the version that `main` names. The bump
 * happens on `develop` and reaches `main` through a merge, so the
 * manifest of `main` already carries the version of the release.
 *
 * Two questions decide whether the release publishes:
 *
 *   - is the version a version at all, and
 *   - is it a version the registry does not have yet.
 *
 * A version that the registry already has cannot be published again: npm
 * refuses it. A version that is not newer than the newest published one
 * is a manifest that was not kept up to date, and publishing it would
 * put an old release back in front of the new ones. Both cases are not
 * a failure of the release - `main` moves for changes that are not a
 * release - so the script reports them and says that nothing is
 * published.
 *
 * The registry is asked what it has. If the registry cannot be reached,
 * the script stops: a release that cannot tell whether its version
 * exists must not publish.
 */

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The versions npm accepts for a release. */
export const VERSION_PATTERN =
	/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * The parts of a version, in the order npm compares them.
 *
 * @param {string} version
 */
export function parseVersion(version) {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(
		String(version),
	);
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] ? match[4].split(".") : [],
	};
}

/**
 * The order of two versions: a negative number when the first one is the
 * older one, a positive number when it is the newer one.
 *
 * A prerelease is older than the release it belongs to: `1.2.0-beta.1` is
 * older than `1.2.0`.
 *
 * @param {string} left
 * @param {string} right
 */
export function compareVersions(left, right) {
	const a = parseVersion(left);
	const b = parseVersion(right);
	if (!a || !b) return 0;
	for (const key of ["major", "minor", "patch"]) {
		if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
	}
	if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0;
	if (a.prerelease.length === 0) return 1;
	if (b.prerelease.length === 0) return -1;
	const length = Math.max(a.prerelease.length, b.prerelease.length);
	for (let index = 0; index < length; index++) {
		const one = a.prerelease[index];
		const other = b.prerelease[index];
		if (one === undefined) return -1;
		if (other === undefined) return 1;
		const oneNumber = /^\d+$/.test(one);
		const otherNumber = /^\d+$/.test(other);
		if (oneNumber && otherNumber) {
			const difference = Number(one) - Number(other);
			if (difference !== 0) return difference < 0 ? -1 : 1;
			continue;
		}
		if (oneNumber !== otherNumber) return oneNumber ? -1 : 1;
		if (one !== other) return one < other ? -1 : 1;
	}
	return 0;
}

/**
 * The versions the registry has for a package.
 *
 * @param {string} name
 */
export function publishedVersions(name) {
	const output = execFileSync("npm", ["view", name, "versions", "--json"], {
		cwd: ROOT,
		encoding: "utf8",
	});
	let parsed;
	try {
		parsed = JSON.parse(output);
	} catch (error) {
		throw new Error(
			`the registry did not answer with a list of versions: ${
				error && error.message ? error.message : String(error)
			}`,
		);
	}
	if (Array.isArray(parsed)) return parsed;
	if (typeof parsed === "string") return [parsed];
	return [];
}

/**
 * Write an output of the step, when the run has one.
 *
 * @param {string} key
 * @param {string} value
 */
function writeOutput(key, value) {
	const path = process.env.GITHUB_OUTPUT;
	if (!path) return;
	try {
		appendFileSync(path, `${key}=${value}\n`);
	} catch {
		// A missing output file is not a reason to fail the run.
	}
}

/**
 * The name and the version of the manifest of the repository.
 *
 * @returns {{name: string, version: string}}
 */
export function readManifest() {
	const raw = readFileSync(join(ROOT, "package.json"), "utf8");
	let manifest;
	try {
		manifest = JSON.parse(raw);
	} catch (error) {
		throw new Error(
			`the manifest is not JSON: ${
				error && error.message ? error.message : String(error)
			}`,
		);
	}
	return { name: manifest.name, version: manifest.version };
}

function main() {
	let manifest;
	try {
		manifest = readManifest();
	} catch (error) {
		console.error(
			`the manifest of the repository could not be read: ${
				error && error.message ? error.message : String(error)
			}`,
		);
		process.exit(1);
	}
	const { name, version } = manifest;

	writeOutput("version", version);
	writeOutput("name", name);

	if (!VERSION_PATTERN.test(String(version))) {
		console.error(
			`the version ${version} of the manifest is not a version npm accepts.`,
		);
		process.exit(1);
	}

	let versions;
	try {
		versions = publishedVersions(name);
	} catch (error) {
		console.error(
			`the published versions of ${name} could not be read: ${
				error && error.message ? error.message : String(error)
			}`,
		);
		// The registry could not be asked, so the release cannot tell
		// whether its version exists. It stops.
		process.exit(1);
	}

	if (versions.includes(version)) {
		console.log(
			`${name}@${version} is on the registry. Nothing is published.`,
		);
		writeOutput("publishable", "false");
		writeOutput("reason", "the version is already on the registry");
		return;
	}

	const newer = versions
		.filter((published) => compareVersions(published, version) > 0)
		.sort(compareVersions)
		.pop();
	if (newer) {
		console.log(
			`${name}@${version} is older than the published ${newer}. Nothing is published.`,
		);
		writeOutput("publishable", "false");
		writeOutput("reason", "the version is older than the published version");
		return;
	}

	console.log(`${name}@${version} is new. It is published.`);
	writeOutput("publishable", "true");
	writeOutput("reason", "the version is new");
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(process.argv[1]).href
) {
	main();
}
