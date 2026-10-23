#!/usr/bin/env bun
/**
 * Record a validation run in the validation ledger.
 *
 * The harness never runs the tests itself, so the ledger is written by whoever
 * knows the result. This CLI is the tool the agent uses:
 *
 * ```bash
 * bun scripts/validation-run.ts --item 12 --tier fast --status passed --duration 18s --dataset 100
 * bun scripts/validation-run.ts --item 12 --tier full --status failed --duration 40m --note "5 of 320 failed"
 * bun scripts/validation-run.ts --item 12 --tier full --status passed --duration 41m -- "bun test tests/full"
 * ```
 *
 * The ledger is plain NDJSON under `~/.pi-harness-runtime/logs/`, so it can be
 * inspected with `tail` or `jq`. Every record is also mirrored into the
 * central logging pipeline (R2 / webhook).
 */

import { ValidationLedger, parseDurationMs } from "../packages/jev-judge/dist/index.js";
import { centralInfo, initCentralLogging } from "../packages/logging/dist/index.js";

interface CliOptions {
	itemId?: number;
	tier?: "fast" | "full";
	status?: "passed" | "failed" | "timeout" | "error" | "skipped";
	durationMs?: number;
	datasetSize?: number;
	exitCode?: number;
	note?: string;
	command?: string;
	label?: string;
	subject?: string;
}

const USAGE = `Usage: bun scripts/validation-run.ts --item <id> --tier <fast|full> --status <passed|failed|timeout|error|skipped> [options] [-- <command>]

Options:
  --item <id>        Todo item id the run belongs to
  --tier <kind>      fast | full
  --status <state>   passed | failed | timeout | error | skipped
  --duration <dur>   Duration of the run (e.g. 18s, 40m, 1h30m)
  --dataset <n>      Number of records the tier exercised
  --exit <code>      Exit code of the command
  --note <text>      Free-form note
  --command <cmd>    The command that was executed
  --label <text>     Human label of the tier
  --subject <text>   Subject of the todo item
  --help             Show this help
`;

function parseArgs(argv: string[]): CliOptions | null {
	const options: CliOptions = {};
	const positional: string[] = [];
	let index = 0;

	const readValue = (flag: string): string | undefined => {
		const value = argv[index + 1];
		if (value === undefined || value.startsWith("--")) return undefined;
		index++;
		return value;
	};

	while (index < argv.length) {
		const arg = argv[index];
		switch (arg) {
			case "--help":
			case "-h":
				return null;
			case "--item": {
				const value = readValue(arg);
				const parsed = value === undefined ? NaN : Number(value);
				if (Number.isFinite(parsed)) options.itemId = parsed;
				break;
			}
			case "--tier": {
				const value = readValue(arg);
				if (value === "fast" || value === "full") options.tier = value;
				break;
			}
			case "--status": {
				const value = readValue(arg);
				if (
					value === "passed" ||
					value === "failed" ||
					value === "timeout" ||
					value === "error" ||
					value === "skipped"
				) {
					options.status = value;
				}
				break;
			}
			case "--duration": {
				const value = readValue(arg);
				const parsed = value === undefined ? undefined : parseDurationMs(value);
				if (parsed !== undefined) options.durationMs = parsed;
				break;
			}
			case "--dataset": {
				const value = readValue(arg);
				const parsed = value === undefined ? NaN : Number(value);
				if (Number.isFinite(parsed)) options.datasetSize = parsed;
				break;
			}
			case "--exit": {
				const value = readValue(arg);
				const parsed = value === undefined ? NaN : Number(value);
				if (Number.isFinite(parsed)) options.exitCode = parsed;
				break;
			}
			case "--note": {
				const value = readValue(arg);
				if (value !== undefined) options.note = value;
				break;
			}
			case "--command": {
				const value = readValue(arg);
				if (value !== undefined) options.command = value;
				break;
			}
			case "--label": {
				const value = readValue(arg);
				if (value !== undefined) options.label = value;
				break;
			}
			case "--subject": {
				const value = readValue(arg);
				if (value !== undefined) options.subject = value;
				break;
			}
			case "--":
				positional.push(...argv.slice(index + 1));
				index = argv.length;
				break;
			default:
				positional.push(arg);
				break;
		}
		index++;
	}

	if (positional.length > 0 && options.command === undefined) {
		options.command = positional.join(" ");
	}
	return options;
}

function main(): void {
	const options = parseArgs(process.argv.slice(2));
	if (!options || options.itemId === undefined || !options.tier || !options.status) {
		process.stdout.write(USAGE);
		process.exit(options ? 2 : 0);
		return;
	}

	initCentralLogging();

	const ledger = new ValidationLedger({
		onRecord: (record) => {
			centralInfo("validation", "tier.run", `${record.tier} tier ${record.status}`, {
				itemId: record.itemId,
				tier: record.tier,
				status: record.status,
				durationMs: record.durationMs,
				datasetSize: record.datasetSize,
				command: record.command,
			});
		},
	});

	const record = ledger.record({
		tier: options.tier,
		status: options.status,
		itemId: options.itemId,
		itemSubject: options.subject,
		command: options.command,
		label: options.label,
		durationMs: options.durationMs,
		datasetSize: options.datasetSize,
		exitCode: options.exitCode,
		note: options.note,
	});

	process.stdout.write(
		`recorded ${options.tier} run for item ${options.itemId}: ${options.status}` +
			`${record?.durationMs !== undefined ? ` (${record.durationMs}ms)` : ""}\n` +
			`ledger: ${ledger.filePath}\n`,
	);
}

main();
