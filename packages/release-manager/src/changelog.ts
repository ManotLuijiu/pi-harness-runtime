/**
 * Release Manager — Changelog Generation (RFC-0078)
 */

import type {
	Commit,
	ChangelogEntry,
	ChangelogChanges,
	Version,
} from "./types.js";

export function classifyCommit(message: string): Commit["type"] {
	const lower = message.toLowerCase();
	if (lower.includes("breaking")) return "break";
	if (lower.startsWith("feat")) return "feat";
	if (lower.startsWith("fix")) return "fix";
	if (lower.startsWith("docs")) return "docs";
	if (lower.startsWith("style")) return "style";
	if (lower.startsWith("refactor")) return "refactor";
	if (lower.startsWith("perf")) return "perf";
	if (lower.startsWith("test")) return "test";
	return "chore";
}

export function isBreakingChange(message: string): boolean {
	const lower = message.toLowerCase();
	return (
		lower.includes("breaking change") ||
		lower.includes("breaking:") ||
		lower.includes("!:")
	);
}

export function extractScope(message: string): string | undefined {
	const match = message.match(/^\w+(?:\(([^)]+)\))?/);
	return match?.[1];
}

export function parseCommit(line: string): Commit {
	const parts = line.trim().split(/\s+/);
	if (parts.length >= 2 && /^[a-f0-9]{7,40}$/i.test(parts[0])) {
		return {
			hash: parts[0],
			message: parts.slice(1).join(" "),
			author: "unknown",
			date: new Date().toISOString(),
			type: classifyCommit(parts.slice(1).join(" ")),
		};
	}
	return {
		hash: "unknown",
		message: line,
		author: "unknown",
		date: new Date().toISOString(),
		type: classifyCommit(line),
	};
}

export function buildChanges(commits: Commit[]): ChangelogChanges {
	const changes: ChangelogChanges = {
		added: [],
		changed: [],
		deprecated: [],
		removed: [],
		fixed: [],
		security: [],
	};

	for (const commit of commits) {
		const scope = extractScope(commit.message) ?? "";
		const desc = commit.message.replace(/^\w+(?:\([^)]+\))?:\s*/, "");

		switch (commit.type) {
			case "feat":
				changes.added.push(scope ? `**${scope}**: ${desc}` : desc);
				break;
			case "fix":
				changes.fixed.push(scope ? `**${scope}**: ${desc}` : desc);
				break;
			case "refactor":
			case "docs":
			case "perf":
			case "build":
			case "chore":
				changes.changed.push(scope ? `**${scope}**: ${desc}` : desc);
				break;
			case "test":
				changes.added.push(scope ? `**${scope}** (tests): ${desc}` : desc);
				break;
			case "break":
				changes.removed.push(`BREAKING: ${desc}`);
				break;
		}
	}

	return changes;
}

export function createChangelogEntry(
	version: Version,
	commits: Commit[],
	options?: { date?: string },
): ChangelogEntry {
	const hasBreaking = commits.some(
		(c) => c.type === "break" || isBreakingChange(c.message),
	);
	const hasSecurity = commits.some((c) =>
		c.message.toLowerCase().includes("security"),
	);

	return {
		version: `${version.major}.${version.minor}.${version.patch}`,
		date: options?.date ?? new Date().toISOString().split("T")[0],
		type: hasBreaking ? "major" : "minor",
		changes: buildChanges(commits),
		breaking: hasBreaking,
		security: hasSecurity,
		authors: [...new Set(commits.map((c) => c.author))],
	};
}

export function formatChangelogMarkdown(entry: ChangelogEntry): string {
	const lines: string[] = [];
	lines.push(
		`## ${entry.version}${entry.breaking ? " **BREAKING**" : ""} (${entry.date})`,
	);
	lines.push("");
	if (entry.authors && entry.authors.length > 0) {
		lines.push(`*${entry.authors.filter(Boolean).join(", ")}*`);
		lines.push("");
	}

	const printSection = (title: string, items: string[]) => {
		if (items.length === 0) return;
		lines.push(`### ${title}`);
		for (const item of items) lines.push(`- ${item}`);
		lines.push("");
	};

	printSection("Added", entry.changes.added);
	printSection("Changed", entry.changes.changed);
	printSection("Deprecated", entry.changes.deprecated);
	printSection("Removed", entry.changes.removed);
	printSection("Fixed", entry.changes.fixed);
	printSection("Security", entry.changes.security);

	return lines.join("\n");
}
