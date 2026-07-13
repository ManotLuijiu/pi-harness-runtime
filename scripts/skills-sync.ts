#!/usr/bin/env bun
/**
 * Skills Sync — One-way sync from private source to private staging.
 *
 * IMPORTANT: This script creates a raw private mirror in staging.
 * It NEVER writes to skills/* and it does NOT sanitize content.
 * Sanitization belongs to a separate later step.
 *
 * Env override:
 *   MOO_SKILLS_SOURCE_ROOT  — override sourceRoot from manifest
 *   MOO_SKILLS_STAGING_ROOT — override staging root (default: harness/skills-staging)
 */

import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { createHash } from "crypto";
import { resolve, join } from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SourceSkillEntry {
	sourceName: string;
	targetName: string;
	sync: boolean;
	publicCandidate: boolean;
}

interface SourceManifest {
	version: number;
	sourceRoot: string;
	skills: SourceSkillEntry[];
}

interface ApprovalSkillEntry {
	targetName: string;
	approvedAt?: string;
}

interface ApprovalManifest {
	version: number;
	skills: ApprovalSkillEntry[];
}

interface SkillResult {
	sourceName: string;
	targetName: string;
	sourcePath: string;
	mirrorPath: string;
	sourceHash: string;
	previousHash: string | null;
	changed: boolean;
	status: "synced" | "unchanged" | "missing-source" | "skipped" | "error";
	error?: string;
}

interface SyncReport {
	version: 1;
	executedAt: string;
	mode: {
		selection: "skill" | "all-from-manifest";
		checkOnly: boolean;
		changedOnly: boolean;
	};
	skills: SkillResult[];
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** Compute SHA-256 hex of a string. */
function sha256(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/** Compute SHA-256 hex of a file on disk. Returns null on error. */
// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const STAGING_ROOT = process.env.MOO_SKILLS_STAGING_ROOT
	? resolve(process.env.MOO_SKILLS_STAGING_ROOT)
	: resolve(import.meta.dirname, "../harness/skills-staging");

const MANIFEST_DIR = join(STAGING_ROOT, "manifests");
const SOURCE_MANIFEST_PATH = join(MANIFEST_DIR, "source-index.json");
const APPROVAL_MANIFEST_PATH = join(MANIFEST_DIR, "approval-index.json");
const SOURCE_MIRROR_DIR = join(STAGING_ROOT, "source-mirror");
const REPORTS_DIR = join(STAGING_ROOT, "reports");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
	selection: { mode: "skill"; name: string } | { mode: "all-from-manifest" };
	checkOnly: boolean;
	changedOnly: boolean;
}

function parseArgs(argv: string[]): CliArgs {
	const args = argv.slice(2); // drop bun + script path
	const flags: Record<string, string | boolean> = {};

	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === "--skill") {
			i++;
			flags["--skill"] = args[i] ?? "";
			i++;
		} else if (arg === "--all-from-manifest") {
			flags["--all-from-manifest"] = true;
			i++;
		} else if (arg === "--changed-only") {
			flags["--changed-only"] = true;
			i++;
		} else if (arg === "--check-only") {
			flags["--check-only"] = true;
			i++;
		} else {
			console.error(`Unknown flag: ${arg}`);
			process.exit(1);
		}
	}

	const checkOnly = Boolean(flags["--check-only"]);
	const changedOnly = Boolean(flags["--changed-only"]);

	let selection: CliArgs["selection"];
	if (flags["--skill"] !== undefined) {
		const name = String(flags["--skill"]);
		if (!name) {
			console.error("--skill requires a skill name");
			process.exit(1);
		}
		selection = { mode: "skill", name };
	} else if (flags["--all-from-manifest"]) {
		selection = { mode: "all-from-manifest" };
	} else {
		printUsage();
		process.exit(1);
	}

	return { selection, checkOnly, changedOnly };
}

function printUsage(): void {
	console.error(`
Skills Sync — one-way sync from private source to private staging.

Usage:
  bun scripts/skills-sync.ts --skill <name>               Sync one skill
  bun scripts/skills-sync.ts --skill <name> --changed-only  Sync only if changed
  bun scripts/skills-sync.ts --skill <name> --check-only    Dry-run (no writes)
  bun scripts/skills-sync.ts --all-from-manifest            Sync all sync:true skills
  bun scripts/skills-sync.ts --all-from-manifest --changed-only
  bun scripts/skills-sync.ts --all-from-manifest --check-only

Env overrides:
  MOO_SKILLS_SOURCE_ROOT   Override sourceRoot from manifest
  MOO_SKILLS_STAGING_ROOT  Override staging root (default: harness/skills-staging)

Notes:
  - This script creates a raw private mirror in staging
  - This script NEVER writes to skills/*
  - Sanitization belongs to a separate later step
  - Only manifest-listed skills can be synced
`);
}

// ---------------------------------------------------------------------------
// Manifest loading
// ---------------------------------------------------------------------------

async function loadSourceManifest(): Promise<SourceManifest> {
	if (!existsSync(SOURCE_MANIFEST_PATH)) {
		console.error(`Source manifest not found: ${SOURCE_MANIFEST_PATH}`);
		process.exit(1);
	}
	try {
		const raw = await readFile(SOURCE_MANIFEST_PATH, "utf-8");
		const manifest = JSON.parse(raw) as SourceManifest;
		if (
			!manifest.version ||
			!manifest.sourceRoot ||
			!Array.isArray(manifest.skills)
		) {
			throw new Error("Invalid manifest shape");
		}
		return manifest;
	} catch (err) {
		console.error(`Invalid source manifest JSON: ${err}`);
		process.exit(1);
	}
}

async function loadApprovalManifest(): Promise<ApprovalManifest> {
	if (!existsSync(APPROVAL_MANIFEST_PATH)) {
		return { version: 1, skills: [] };
	}
	try {
		const raw = await readFile(APPROVAL_MANIFEST_PATH, "utf-8");
		return JSON.parse(raw) as ApprovalManifest;
	} catch (err) {
		console.error(`Invalid approval manifest JSON: ${err}`);
		process.exit(1);
	}
}

// ---------------------------------------------------------------------------
// Core sync logic
// ---------------------------------------------------------------------------

/**
 * Sync a single skill from source to staging mirror.
 * The mirror is a raw private copy of the source file.
 */
async function syncSkill(
	entry: SourceSkillEntry,
	sourceRoot: string,
	checkOnly: boolean,
	changedOnly: boolean,
): Promise<SkillResult> {
	const sourcePath = join(sourceRoot, entry.sourceName, "SKILL.md");
	const mirrorDir = join(SOURCE_MIRROR_DIR, entry.targetName);
	const mirrorPath = join(mirrorDir, "SKILL.md");

	// Check source exists
	if (!existsSync(sourcePath)) {
		return {
			sourceName: entry.sourceName,
			targetName: entry.targetName,
			sourcePath,
			mirrorPath,
			sourceHash: "",
			previousHash: null,
			changed: false,
			status: "missing-source",
			error: `Source file not found: ${sourcePath}`,
		};
	}

	// Read and hash source
	let sourceContent: string;
	try {
		sourceContent = await readFile(sourcePath, "utf-8");
	} catch (err) {
		return {
			sourceName: entry.sourceName,
			targetName: entry.targetName,
			sourcePath,
			mirrorPath,
			sourceHash: "",
			previousHash: null,
			changed: false,
			status: "error",
			error: `Cannot read source: ${err}`,
		};
	}
	const sourceHash = sha256(sourceContent);

	// Check previous mirror hash
	let previousHash: string | null = null;
	if (existsSync(mirrorPath)) {
		try {
			const prevContent = await readFile(mirrorPath, "utf-8");
			previousHash = sha256(prevContent);
		} catch {
			// If we can't read previous, treat as changed
		}
	}

	const changed = previousHash === null || sourceHash !== previousHash;

	// Skip if --changed-only and no change
	if (changedOnly && !changed) {
		return {
			sourceName: entry.sourceName,
			targetName: entry.targetName,
			sourcePath,
			mirrorPath,
			sourceHash,
			previousHash,
			changed: false,
			status: "skipped",
		};
	}

	// In check-only mode, don't write
	if (checkOnly) {
		return {
			sourceName: entry.sourceName,
			targetName: entry.targetName,
			sourcePath,
			mirrorPath,
			sourceHash,
			previousHash,
			changed,
			status: changed ? "synced" : "unchanged",
		};
	}

	// Write raw source content to the private staging mirror
	try {
		await mkdir(mirrorDir, { recursive: true });
		await writeFile(mirrorPath, sourceContent, "utf-8");
	} catch (err) {
		return {
			sourceName: entry.sourceName,
			targetName: entry.targetName,
			sourcePath,
			mirrorPath,
			sourceHash,
			previousHash,
			changed,
			status: "error",
			error: `Cannot write mirror: ${err}`,
		};
	}

	return {
		sourceName: entry.sourceName,
		targetName: entry.targetName,
		sourcePath,
		mirrorPath,
		sourceHash,
		previousHash,
		changed,
		status: "synced",
	};
}

/**
 * Write machine-readable report to harness/skills-staging/reports/sync-report.json
 */
async function writeReport(
	report: SyncReport,
	checkOnly: boolean,
): Promise<void> {
	if (checkOnly) return; // No side-effects in check-only mode
	await mkdir(REPORTS_DIR, { recursive: true });
	const reportPath = join(REPORTS_DIR, "sync-report.json");
	await writeFile(reportPath, JSON.stringify(report, null, 2), "utf-8");
}

/**
 * Print human-readable summary to stdout.
 */
function printSummary(
	results: SkillResult[],
	checkOnly: boolean,
	changedOnly: boolean,
): void {
	const total = results.length;
	const synced = results.filter((r) => r.status === "synced").length;
	const unchanged = results.filter(
		(r) => r.status === "unchanged" || r.status === "skipped",
	).length;
	const missing = results.filter((r) => r.status === "missing-source").length;
	const errors = results.filter((r) => r.status === "error").length;

	console.log("\n📋 Skills Sync Summary");
	console.log(
		`   Mode: ${checkOnly ? "check-only (dry-run)" : "sync"}${changedOnly ? " + changed-only" : ""}`,
	);
	console.log(
		`   Total: ${total}  Synced: ${synced}  Unchanged: ${unchanged}  Missing: ${missing}  Errors: ${errors}`,
	);

	if (errors > 0) {
		console.log("\n❌ Errors:");
		for (const r of results.filter((r) => r.status === "error")) {
			console.log(`   • ${r.sourceName}: ${r.error}`);
		}
	}
	if (missing > 0) {
		console.log("\n⚠️  Missing sources:");
		for (const r of results.filter((r) => r.status === "missing-source")) {
			console.log(`   • ${r.sourceName}: ${r.error}`);
		}
	}

	const changed = results.filter((r) => r.status === "synced");
	if (changed.length > 0 && !checkOnly) {
		console.log("\n✅ Synced skills:");
		for (const r of changed) {
			const diff = r.previousHash ? `${r.sourceHash.slice(0, 8)}…` : "(new)";
			console.log(`   • ${r.sourceName} → ${r.targetName} [${diff}]`);
		}
	}

	const skipped = results.filter(
		(r) => r.status === "skipped" || r.status === "unchanged",
	);
	if (skipped.length > 0 && changedOnly) {
		console.log("\n⏭️  Skipped (unchanged):");
		for (const r of skipped) {
			console.log(`   • ${r.sourceName}`);
		}
	}
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parseArgs(process.argv);

	const manifest = await loadSourceManifest();

	// Env override for sourceRoot
	const sourceRoot = process.env.MOO_SKILLS_SOURCE_ROOT
		? resolve(process.env.MOO_SKILLS_SOURCE_ROOT)
		: resolve(manifest.sourceRoot);

	let entriesToSync: SourceSkillEntry[];

	if (args.selection.mode === "skill") {
		const entry = manifest.skills.find((s) => {
			if (args.selection.mode !== "skill") return false;
			const name = args.selection.name;
			return s.targetName === name || s.sourceName === name;
		});
		if (!entry) {
			console.error(
				`Skill "${args.selection.name}" not found in source manifest. ` +
					`Add it to harness/skills-staging/manifests/source-index.json first.`,
			);
			process.exit(1);
		}
		entriesToSync = [entry];
	} else {
		entriesToSync = manifest.skills.filter((s) => s.sync === true);
		if (entriesToSync.length === 0) {
			console.log("No skills with sync:true found in manifest. Nothing to do.");
			process.exit(0);
		}
	}

	// Approval manifest (read-only in this slice; written by approval workflow later)
	await loadApprovalManifest();
	// Sync each skill
	const results: SkillResult[] = [];
	let hasError = false;

	for (const entry of entriesToSync) {
		const result = await syncSkill(
			entry,
			sourceRoot,
			args.checkOnly,
			args.changedOnly,
		);
		results.push(result);
		if (result.status === "error" || result.status === "missing-source") {
			hasError = true;
		}
	}

	// Write report (skip in check-only)
	const report: SyncReport = {
		version: 1,
		executedAt: new Date().toISOString(),
		mode: {
			selection: args.selection.mode,
			checkOnly: args.checkOnly,
			changedOnly: args.changedOnly,
		},
		skills: results,
	};
	await writeReport(report, args.checkOnly);

	// Print human-readable summary
	printSummary(results, args.checkOnly, args.changedOnly);

	if (hasError) {
		process.exit(1);
	}
}

main().catch((err) => {
	console.error("Unexpected error:", err);
	process.exit(1);
});
