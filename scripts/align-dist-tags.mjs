#!/usr/bin/env node
/**
 * The alignment of the npm channels of a package with the release that
 * the repository just published.
 *
 * A version on npm is a published thing. A channel is a pointer, and a
 * pointer is what a consumer actually installs: `npm install
 * pi-harness-runtime@develop` resolves the `develop` channel and hands
 * over the build that the pointer names.
 *
 * The channels of this package were left behind by the era in which the
 * releases carried the numbers of the 0.10.x line. The `develop` channel
 * named 0.10.42 and the `beta` channel named 1.1.71-3, so a consumer
 * who asked for the development build received a build from a line the
 * repository left months ago, while GitHub and npm agreed on 1.1.455
 * for the release itself.
 *
 * The rule of this script is therefore narrow and mechanical: every
 * channel of a package names the version of the release, or it is
 * removed. The release removes the channels that name an older version.
 * A channel that names a newer version (a pre-release of the future)
 * stays, and `latest` always stays: it is the release itself.
 *
 * The script also reports the version tags of the repository that no
 * published version carries. Such a tag is the residue of a release
 * that failed after its tag was pushed. The report never deletes a tag:
 * a tag is a public ref and its removal is the owner's decision.
 *
 * Nothing here prints a credential. The channels and the versions are
 * public facts of the package.
 */

import { execFileSync } from "node:child_process";

/**
 * Compare two versions by their numbers.
 *
 * A pre-release suffix does not change the order of a line: 1.1.71-3
 * is older than 1.1.455, because 71 is older than 455.
 *
 * @param {string} left
 * @param {string} right
 * @returns {number} Negative when left is older, positive when it is
 *   newer, zero when both name the same version.
 */
export function compareVersions(left, right) {
	const numbers = (value) =>
		String(value)
			.split("-")[0]
			.split(".")
			.map((part) => Number.parseInt(part, 10) || 0);
	const a = numbers(left);
	const b = numbers(right);
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference < 0 ? -1 : 1;
	}
	return 0;
}

/**
 * The channels that name a version older than the release.
 *
 * `latest` is never stale: it is the release itself. A channel that
 * names the release stays, because it is aligned.
 *
 * @param {Record<string, string>} channels The channels of the package.
 * @param {string} currentVersion The version that was published.
 * @returns {string[]} The names of the channels to remove.
 */
export function staleDistTags(channels, currentVersion) {
	return Object.entries(channels)
		.filter(([channel, version]) => channel !== "latest")
		.filter(([, version]) => compareVersions(version, currentVersion) < 0)
		.map(([channel]) => channel)
		.sort();
}

/**
 * The version tags of the repository that no published version carries.
 *
 * Only the tags that are newer than the newest published version are
 * reported. A tag that promises a version the registry does not have,
 * above everything that was published, is the residue of a release that
 * failed after its tag was pushed. The older tags of the repository are
 * the history of an era in which the releases were not published to npm
 * at all, and they are not a mismatch of today.
 *
 * A residue is reported while it is the newest thing: when a later
 * release publishes, the old residue becomes history, exactly like the
 * tags of the era before npm.
 *
 * @param {string[]} remoteTags The tag names of the remote.
 * @param {string[]} publishedVersions The versions on npm.
 * @param {{since?: string}} [options] The newest published version.
 * @returns {string[]} The tag names without a published version.
 */
export function orphanedVersionTags(remoteTags, publishedVersions, options = {}) {
	const { since } = options;
	const published = new Set(publishedVersions);
	return remoteTags
		.filter((tag) => /^v?\d+\.\d+\.\d+$/.test(tag))
		.map((tag) => (tag.startsWith("v") ? tag.slice(1) : tag))
		.filter((version) => !published.has(version))
		.filter((version) =>
			since ? compareVersions(version, since) > 0 : true,
		)
		.map((version) => `v${version}`)
		.sort();
}

/**
 * The line of a version: the numbers before the last one.
 *
 * @param {string} version
 * @returns {string} The line, e.g. "1.1" for 1.1.455.
 */
export function versionLine(version) {
	return String(version)
		.split("-")[0]
		.split(".")
		.slice(0, -1)
		.join(".");
}

/**
 * Parse the output of `npm dist-tag ls`.
 *
 * The command prints one channel per line as "name: version".
 *
 * @param {string} output
 * @returns {Record<string, string>}
 */
export function parseDistTagOutput(output) {
	const channels = {};
	for (const line of String(output).split("\n")) {
		const match = /^\s*([^\s:]+)\s*:\s*(\S+)\s*$/.exec(line);
		if (match) channels[match[1]] = match[2];
	}
	return channels;
}

/**
 * Read the channels of a package.
 *
 * @param {string} packageName
 * @returns {Record<string, string>}
 */
export function readDistTags(packageName) {
	const output = execFileSync("npm", ["dist-tag", "ls", packageName], {
		encoding: "utf8",
	});
	return parseDistTagOutput(output);
}

/**
 * Read the published versions of a package.
 *
 * @param {string} packageName
 * @returns {string[]}
 */
export function readPublishedVersions(packageName) {
	const output = execFileSync(
		"npm",
		["view", packageName, "versions", "--json"],
		{ encoding: "utf8" },
	);
	try {
		const parsed = JSON.parse(output || "[]");
		return Array.isArray(parsed) ? parsed : [String(parsed)];
	} catch {
		// The registry answered with something that is not a version list.
		// The report of the orphan tags stays empty.
		return [];
	}
}

/**
 * Read the tag names of the remote.
 *
 * @param {string} remote
 * @returns {string[]}
 */
export function readRemoteTags(remote = "origin") {
	const output = execFileSync(
		"git",
		["ls-remote", "--tags", remote],
		{ encoding: "utf8" },
	);
	return output
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => line.split(/\s+/)[1] ?? "")
		.filter((ref) => ref.startsWith("refs/tags/"))
		.map((ref) => ref.slice("refs/tags/".length))
		.filter((name) => !name.endsWith("^{}"));
}

/**
 * Remove a channel of a package.
 *
 * @param {string} packageName
 * @param {string} channel
 */
export function removeDistTag(packageName, channel) {
	execFileSync("npm", ["dist-tag", "rm", packageName, channel], {
		stdio: "inherit",
	});
}

/**
 * Align the channels of a package with a published version.
 *
 * @param {{packageName: string, currentVersion: string, apply?: boolean,
 *   remote?: string}} options
 * @returns {{removed: string[], failed: string[], orphaned: string[]}}
 */
export function alignDistTags(options) {
	const { packageName, currentVersion, apply = false, remote = "origin" } =
		options;
	const channels = readDistTags(packageName);
	const stale = staleDistTags(channels, currentVersion);
	const removed = [];
	const failed = [];
	if (apply) {
		for (const channel of stale) {
			try {
				removeDistTag(packageName, channel);
				removed.push(channel);
			} catch {
				failed.push(channel);
			}
		}
	}
	let orphaned = [];
	try {
		orphaned = orphanedVersionTags(
			readRemoteTags(remote),
			readPublishedVersions(packageName),
			{ since: currentVersion },
		);
	} catch {
		// The report is a convenience. A remote that cannot be read does
		// not stop the alignment of the channels.
	}
	return { stale, removed, failed, orphaned };
}

/**
 * The command line of the script.
 *
 * @param {string[]} argv
 * @returns {number} The exit code.
 */
export function main(argv) {
	const args = argv.slice(2);
	const read = (name) => {
		const index = args.indexOf(`--${name}`);
		return index >= 0 ? args[index + 1] : undefined;
	};
	const packageName = read("package") ?? "pi-harness-runtime";
	const currentVersion = read("version");
	if (!currentVersion) {
		console.error("the version of the release is required");
		return 2;
	}
	const apply = args.includes("--apply");
	const remote = read("remote") ?? "origin";
	const result = alignDistTags({ packageName, currentVersion, apply, remote });
	console.log(
		`channels of ${packageName}: the release is ${currentVersion}`,
	);
	if (result.stale.length > 0) {
		console.log(
			`stale channels (an older version): ${result.stale.join(", ")}`,
		);
	}
	if (result.removed.length > 0) {
		console.log(`removed ${result.removed.length} stale channel(s)`);
	}
	if (result.failed.length > 0) {
		console.error(
			`${result.failed.length} channel(s) could not be removed: ${result.failed.join(", ")}`,
		);
	}
	if (result.orphaned.length > 0) {
		console.log(
			`version tags without a published version: ${result.orphaned.join(", ")}`,
		);
	}
	return result.failed.length > 0 ? 1 : 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
	process.exitCode = main(process.argv);
}
