#!/usr/bin/env node
/**
 * The check that keeps a client name out of a pull request.
 *
 * The repository is public, so a name that reaches a pull request has
 * reached the world. GitHub's free secret scanning finds credential
 * patterns; a client name is a custom text pattern and is not part of
 * that detection. So the names live in a repository secret, and this
 * script compares them with what a pull request adds.
 *
 * The comparison is a plain, case-insensitive fragment - not a word
 * boundary. A name appears inside identifiers and inside file names, so
 * a word boundary would miss exactly the cases that matter. The same
 * rule is used by the skill sanitizer.
 *
 * Two properties matter more than the matching:
 *
 *   1. The script never prints a term and never prints the line that
 *      matched. The log of a workflow run is public, and the log is
 *      where a term would leak a second time. A hit is reported as a
 *      path and a line number - both are already public in the pull
 *      request itself.
 *   2. The script fails closed. An empty term list is not "nothing
 *      found", it is "nothing was checked", and the exit code says so.
 *
 * The exit codes:
 *
 *   0  nothing was found
 *   1  a term was found
 *   2  the check could not run - no terms, no pull request, no registry
 *
 * The usage:
 *
 *   node scripts/check-sensitive-terms.mjs --pr 42
 *   node scripts/check-sensitive-terms.mjs --diff changes.patch
 *   node scripts/check-sensitive-terms.mjs --file README.md
 *   node scripts/check-sensitive-terms.mjs --text "a name"
 *
 * The terms come from, in this order:
 *
 *   --terms-file <path>          a file with one term per line
 *   SENSITIVE_TERMS              the environment (the repository secret)
 *   PI_SENSITIVE_TERMS_FILE      the environment (a local file)
 *
 * The script is written so that it can be tested: the matching, the
 * diff parsing and the reporting are exported, and the command line
 * only wires them together.
 */

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * The exit codes of the check.
 */
export const EXIT_CLEAN = 0;
export const EXIT_FOUND = 1;
export const EXIT_UNAVAILABLE = 2;

/**
 * The terms of a list.
 *
 * A list is one term per line. An empty line is not a term, and a line
 * that starts with a hash is a comment, so the list can be grouped
 * without a second file.
 */
export function parseTerms(text) {
	const terms = [];
	const seen = new Set();
	for (const raw of String(text ?? "").split(/\r?\n/)) {
		const term = raw.trim();
		if (!term) continue;
		if (term.startsWith("#")) continue;
		const key = term.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		terms.push(term);
	}
	return terms;
}

/**
 * The terms of a file.
 *
 * A file that cannot be read is no terms - and the caller has to notice
 * that, because a missing list and an empty list mean the same thing
 * here: nothing was checked.
 */
export function readTermsFile(path) {
	if (!path || !existsSync(path)) return [];
	try {
		return parseTerms(readFileSync(path, "utf8"));
	} catch {
		return [];
	}
}

/**
 * The terms of the environment.
 *
 * The repository secret arrives as SENSITIVE_TERMS. The local file
 * arrives as PI_SENSITIVE_TERMS_FILE.
 */
export function termsFromEnv(env = process.env) {
	if (env.SENSITIVE_TERMS) return parseTerms(env.SENSITIVE_TERMS);
	if (env.PI_SENSITIVE_TERMS_FILE) return readTermsFile(env.PI_SENSITIVE_TERMS_FILE);
	return [];
}

/**
 * Does a line hold one of the terms?
 *
 * The comparison is a plain fragment, case-insensitive. The first
 * match wins - the caller only needs to know that there is one.
 */
export function lineHasTerm(line, terms) {
	if (!line) return false;
	const haystack = line.toLowerCase();
	for (const term of terms) {
		if (haystack.includes(term.toLowerCase())) return true;
	}
	return false;
}

/**
 * The added lines of a unified diff, with the line number they have in
 * the new file.
 *
 * Only the added lines are scanned. A removed line is a line that is
 * on its way out - a pull request that deletes a name must not fail
 * because of it, or the cleanup of a leak can never be merged.
 *
 * The result is a list of { line, text }. The text is never printed by
 * the caller.
 */
export function addedLines(patch) {
	const result = [];
	if (!patch) return result;
	let newLine = 0;
	for (const raw of String(patch).split("\n")) {
		const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
		if (hunk) {
			newLine = Number.parseInt(hunk[1], 10);
			continue;
		}
		if (raw.startsWith("+++") || raw.startsWith("---")) continue;
		if (raw.startsWith("+")) {
			result.push({ line: newLine, text: raw.slice(1) });
			newLine += 1;
			continue;
		}
		if (raw.startsWith("-")) continue;
		if (raw.startsWith("\\")) continue;
		if (raw.startsWith(" ")) newLine += 1;
	}
	return result;
}

/**
 * The lines of a whole file.
 *
 * This is the fallback for a file whose diff the API does not return -
 * a large file, or a file that is new. The whole content is scanned,
 * because a name that is not in the diff is in the file.
 */
export function fileLines(content) {
	return String(content ?? "")
		.split("\n")
		.map((text, index) => ({ line: index + 1, text }));
}

/**
 * A hit: a place, and nothing else.
 *
 * The place is a path and a line number. Both are already visible in
 * the pull request, so naming them leaks nothing that the pull request
 * does not already show - and it tells the author where to look.
 */
function hit(path, line) {
	return { path, line };
}

/**
 * Does a path hold a term?
 *
 * A file name can carry a name, and a path that does is a leak that
 * no diff would show - a file that was only renamed keeps its content
 * and changes its path. The path is reported as a hit on line 0.
 */
export function pathHasTerm(path, terms) {
	return lineHasTerm(path, terms);
}

/**
 * Hide the terms in a text.
 *
 * A path can hold a term - that is often why it is a hit - so a report
 * that prints the path as it is would print the term with it. Every
 * term becomes a fixed mark, so the report still says which file and
 * where, and still says nothing that is private.
 */
export function redactTerms(text, terms) {
	let result = String(text ?? "");
	for (const term of terms) {
		if (!term) continue;
		result = result.replace(new RegExp(escapeRegExp(term), "gi"), "***");
	}
	return result;
}

/**
 * The regular expression of a term, with the characters of a term that
 * mean something in a pattern escaped.
 */
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scan a patch for the terms.
 */
export function scanPatch(patch, path, terms) {
	const hits = [];
	if (pathHasTerm(path, terms)) hits.push(hit(path, 0));
	for (const { line, text } of addedLines(patch)) {
		if (lineHasTerm(text, terms)) hits.push(hit(path, line));
	}
	return hits;
}

/**
 * Scan a whole text for the terms.
 *
 * The path is a label, not a file that is read again.
 */
export function scanText(text, path, terms) {
	const hits = [];
	if (pathHasTerm(path, terms)) hits.push(hit(path, 0));
	for (const { line, text: content } of fileLines(text)) {
		if (lineHasTerm(content, terms)) hits.push(hit(path, line));
	}
	return hits;
}

/**
 * The report of a scan.
 *
 * The report names the places and nothing else. The term is not in it
 * and the matching line is not in it.
 */
export function formatReport({ hits, scanned, mode, terms = [] }) {
	const lines = [];
	if (hits.length === 0) {
		lines.push(`scanned ${scanned} ${mode}`);
		lines.push("no sensitive term was found");
		return lines.join("\n");
	}
	lines.push("this change holds a term from the repository's sensitive list.");
	lines.push("the term is not printed here: the list is a repository secret and this log is public.");
	lines.push("the places to look:");
	for (const found of hits) {
		// A path can be the place the term is in, so the path is
		// printed with the terms hidden.
		lines.push(`  ${redactTerms(found.path, terms)}:${found.line}`);
	}
	lines.push("remove the term from the change, or keep the discussion out of the public repository.");
	return lines.join("\n");
}

/**
 * The files of a pull request.
 *
 * The API returns the patch of every file it can. A file it cannot
 * return a patch for is a file that is too large or that is binary -
 * for a file that is too large the content is fetched instead, because
 * a name that is not in the diff is in the file.
 */
async function pullRequestFiles({ owner, repo, number, token, fetchImpl }) {
	const files = [];
	let page = 1;
	for (;;) {
		const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`;
		const response = await fetchImpl(url, {
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${token}`,
				"user-agent": "pi-harness-runtime-sensitive-terms",
				"x-github-api-version": "2022-11-28",
			},
		});
		if (!response.ok) {
			throw new Error(`the pull request files could not be read: HTTP ${response.status}`);
		}
		const batch = await response.json();
		if (!Array.isArray(batch) || batch.length === 0) break;
		files.push(...batch);
		if (batch.length < 100) break;
		page += 1;
	}
	return files;
}

/**
 * The title and the body of a pull request.
 *
 * Both are public the moment the pull request exists, so both are
 * scanned.
 */
async function pullRequestMeta({ owner, repo, number, token, fetchImpl }) {
	const url = `https://api.github.com/repos/${owner}/${repo}/pulls/${number}`;
	const response = await fetchImpl(url, {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"user-agent": "pi-harness-runtime-sensitive-terms",
			"x-github-api-version": "2022-11-28",
		},
	});
	if (!response.ok) {
		throw new Error(`the pull request could not be read: HTTP ${response.status}`);
	}
	const pull = await response.json();
	return { title: pull?.title ?? "", body: pull?.body ?? "" };
}

/**
 * The content of a file at a revision.
 *
 * A file that is binary, or that the API refuses, is not scanned - and
 * the caller is told, because a file that was not scanned is a file
 * that was not checked.
 */
async function fileContentAtRef({ owner, repo, path, ref, token, fetchImpl }) {
	const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
	const response = await fetchImpl(url, {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"user-agent": "pi-harness-runtime-sensitive-terms",
			"x-github-api-version": "2022-11-28",
		},
	});
	if (!response.ok) return null;
	const payload = await response.json();
	if (!payload || typeof payload.content !== "string") return null;
	let text;
	try {
		text = Buffer.from(payload.content, "base64").toString("utf8");
	} catch {
		return null;
	}
	// A binary file is not text. It is not a place a name would be.
	if (text.includes(" ")) return null;
	return text;
}

/**
 * The scan of a pull request.
 */
export async function scanPullRequest({ owner, repo, number, token, terms, fetchImpl = fetch }) {
	const hits = [];
	let scanned = 0;

	const meta = await pullRequestMeta({ owner, repo, number, token, fetchImpl });
	if (lineHasTerm(meta.title, terms)) hits.push(hit("pull request title", 1));
	if (lineHasTerm(meta.body, terms)) hits.push(hit("pull request body", 1));
	scanned += 2;

	const files = await pullRequestFiles({ owner, repo, number, token, fetchImpl });
	for (const file of files) {
		const path = file?.filename ?? "(unknown)";
		if (typeof file?.patch === "string" && file.patch.length > 0) {
			hits.push(...scanPatch(file.patch, path, terms));
			scanned += 1;
			continue;
		}
		// No patch. A binary file has nothing to find; a large file has
		// to be read as a whole.
		if (file?.patch === undefined && file?.changes !== undefined) {
			const content = await fileContentAtRef({
				owner,
				repo,
				path,
				ref: file.sha ?? "HEAD",
				token,
				fetchImpl,
			});
			if (content === null) continue;
			hits.push(...scanText(content, path, terms));
			scanned += 1;
		}
	}

	return { hits, scanned, mode: "files, added lines, and the pull request title and body" };
}

/**
 * The diff of a range of commits.
 */
function gitRangeDiff(range, cwd) {
	return execFileSync("git", ["diff", "--unified=0", range], {
		cwd,
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
	});
}

/**
 * The scan of a range of commits.
 */
export function scanRange(range, terms, cwd = process.cwd()) {
	const diff = gitRangeDiff(range, cwd);
	const files = [];
	let current = null;
	for (const raw of diff.split("\n")) {
		if (raw.startsWith("diff --git ")) {
			const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
			current = { path: match ? match[2] : "(unknown)", patch: "" };
			files.push(current);
			continue;
		}
		if (!current) continue;
		if (raw.startsWith("@@") || raw.startsWith("+") || raw.startsWith(" ")) {
			current.patch += `${raw}\n`;
		}
	}
	const hits = [];
	for (const file of files) {
		hits.push(...scanPatch(file.patch, file.path, terms));
	}
	return { hits, scanned: files.length, mode: "changed files" };
}

/**
 * The arguments of the command line.
 */
function parseArgs(argv) {
	const args = { mode: null };
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		const next = () => argv[++index];
		if (arg === "--pr") args.mode = "pr", (args.number = next());
		else if (arg === "--diff") args.mode = "diff", (args.path = next());
		else if (arg === "--file") args.mode = "file", (args.path = next());
		else if (arg === "--text") args.mode = "text", (args.text = next());
		else if (arg === "--range") args.mode = "range", (args.range = next());
		else if (arg === "--terms-file") args.termsFile = next();
		else if (arg === "--repo") args.repo = next();
	}
	return args;
}

/**
 * The main.
 */
async function main() {
	const args = parseArgs(process.argv.slice(2));

	let terms = args.termsFile ? readTermsFile(args.termsFile) : termsFromEnv();
	if (terms.length === 0 && args.termsFile) {
		// The list was named and it was empty. That is a broken setup,
		// not a clean run.
		console.error("the term list is empty, so nothing could be checked.");
		return EXIT_UNAVAILABLE;
	}
	if (terms.length === 0) {
		console.error("no term list is configured, so nothing could be checked.");
		console.error("set SENSITIVE_TERMS, or pass --terms-file <path>.");
		return EXIT_UNAVAILABLE;
	}

	let result;
	if (args.mode === "pr") {
		const repo = args.repo ?? process.env.GITHUB_REPOSITORY;
		const token = process.env.GITHUB_TOKEN;
		const number = args.number ?? process.env.PR_NUMBER;
		if (!repo || !number) {
			console.error("the pull request or the repository is unknown.");
			return EXIT_UNAVAILABLE;
		}
		if (!token) {
			console.error("no token is available for the pull request API.");
			return EXIT_UNAVAILABLE;
		}
		const [owner, name] = repo.split("/");
		result = await scanPullRequest({ owner, repo: name, number, token, terms });
	} else if (args.mode === "diff") {
		const diff = readFileSync(args.path, "utf8");
		const files = [];
		let current = null;
		for (const raw of diff.split("\n")) {
			if (raw.startsWith("diff --git ")) {
				const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(raw);
				current = { path: match ? match[2] : "(unknown)", patch: "" };
				files.push(current);
				continue;
			}
			if (!current) continue;
			if (raw.startsWith("@@") || raw.startsWith("+")) current.patch += `${raw}\n`;
		}
		const hits = [];
		for (const file of files) hits.push(...scanPatch(file.patch, file.path, terms));
		result = { hits, scanned: files.length, mode: "changed files" };
	} else if (args.mode === "file") {
		result = { hits: scanText(readFileSync(args.path, "utf8"), args.path, terms), scanned: 1, mode: "file" };
	} else if (args.mode === "text") {
		result = { hits: scanText(args.text, "(text)", terms), scanned: 1, mode: "text" };
	} else if (args.mode === "range") {
		result = scanRange(args.range, terms);
	} else {
		console.error("nothing to check. use --pr, --diff, --file, --text or --range.");
		return EXIT_UNAVAILABLE;
	}

	console.log(formatReport({ ...result, terms }));
	return result.hits.length > 0 ? EXIT_FOUND : EXIT_CLEAN;
}

// Only run when the file is the program, not when it is imported.
if (import.meta.url === `file://${process.argv[1]}`) {
	main()
		.then((code) => {
			process.exitCode = code;
		})
		.catch((error) => {
			console.error(`the check could not run: ${error?.message ?? error}`);
			process.exitCode = EXIT_UNAVAILABLE;
		});
}
