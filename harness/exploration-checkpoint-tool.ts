/**
 * The tool that records the exploration checkpoint of the agent.
 *
 * The guard watches the reads of the agent, but it does not know what the
 * agent learned from them. Only the agent can say that: the findings, the
 * questions that are still open, the next concrete action and the hash of
 * the files that were read.
 *
 * The tool records that statement beside the coverage of the request, so a
 * compaction does not make the agent find it again.
 *
 * The tool records evidence and authorises nothing. It never writes a file,
 * never changes a branch and never starts another task.
 */

import { Type } from "typebox";
import {
	defineTool,
	type ExtensionAPI,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { CheckpointInput } from "../packages/exploration-guard/dist/index.js";

/**
 * The recorder of the checkpoint.
 *
 * The runtime of the running request records the checkpoint. The recorder
 * is read when the tool is called, because the request changes while the
 * tool stays registered.
 */
export interface ExplorationCheckpointRecorder {
	/**
	 * Record the checkpoint of the request.
	 *
	 * The result is true when the checkpoint was written.
	 */
	recordCheckpoint(input: CheckpointInput): boolean;
}

/**
 * The options of the tool.
 */
export interface ExplorationCheckpointToolOptions {
	/**
	 * The recorder of the running request.
	 *
	 * There is no recorder when no request is running, and the tool says
	 * so instead of pretending that it recorded something.
	 */
	current: () => ExplorationCheckpointRecorder | null;
}

/**
 * The name of the tool.
 */
export const EXPLORATION_CHECKPOINT_TOOL = "exploration_checkpoint";

/**
 * The parameters of the tool.
 */
const parameters = Type.Object({
	findings: Type.Optional(
		Type.Array(
			Type.Object({
				statement: Type.String({
					description:
						"What was found, in one sentence. A finding names a location when it has one.",
				}),
				locations: Type.Optional(
					Type.Array(
						Type.String({
							description: "Where the finding was found.",
						}),
					),
				),
			}),
			{ description: "The findings of the investigation so far." },
		),
	),
	hypotheses: Type.Optional(
		Type.Array(
			Type.Object({
				statement: Type.String({
					description: "A hypothesis about the cause of the problem.",
				}),
				rejected: Type.Optional(
					Type.Boolean({
						description: "True when the hypothesis was ruled out.",
					}),
				),
			}),
			{ description: "The hypotheses that were narrowed or ruled out." },
		),
	),
	openQuestions: Type.Optional(
		Type.Array(
			Type.String({ description: "A question that is still open." }),
			{ description: "The questions that are still open." },
		),
	),
	nextAction: Type.Optional(
		Type.String({
			description:
				"The next concrete action, in one sentence. It names what to do next, not what to conclude.",
		}),
	),
	references: Type.Optional(
		Type.Array(
			Type.Object({
				path: Type.String({
					description: "The file the findings refer to.",
				}),
				contentHash: Type.Optional(
					Type.String({
						description:
							"The hash of the content that was observed. A file whose hash changes is read again.",
					}),
				),
			}),
			{ description: "The files the findings refer to." },
		),
	),
});

/**
 * The tool that records the exploration checkpoint.
 *
 * The tool never throws: a checkpoint that cannot be written is reported
 * as a failure of the record, and the agent continues.
 */
export function explorationCheckpointTool(
	options: ExplorationCheckpointToolOptions,
): ToolDefinition<typeof parameters> {
	return defineTool({
		name: EXPLORATION_CHECKPOINT_TOOL,
		label: "Exploration checkpoint",
		description:
			"Record the exploration checkpoint of the current request: the findings, the hypotheses that were ruled out, the questions that are still open, the next concrete action and the hash of the files that were read. " +
			"Use it when the investigation has produced an answer that a compaction or a later turn would otherwise lose, and when the guard asks for a checkpoint. " +
			"It records evidence: it does not authorise a change, it does not write anything and it does not start another task.",
		parameters,
		async execute(_toolCallId, params) {
			const recorder = options.current();
			if (!recorder) {
				return {
					content: [
						{
							type: "text",
							text: "There is no running request, so there is no exploration to record.",
						},
					],
					details: {},
				};
			}
			const recorded = recorder.recordCheckpoint({
				findings: params.findings,
				hypotheses: params.hypotheses,
				openQuestions: params.openQuestions,
				nextAction: params.nextAction,
				references: params.references,
			});
			if (!recorded) {
				return {
					content: [
						{
							type: "text",
							text: "The checkpoint of the request could not be recorded.",
						},
					],
					details: {},
				};
			}
			// The answer names what was recorded: the agent must be able to
			// see that the record holds its findings, and a record of
			// nothing is a record that says nothing.
			const parts: string[] = [];
			if (params.findings?.length) {
				parts.push(`${params.findings.length} finding(s)`);
			}
			if (params.hypotheses?.length) {
				parts.push(`${params.hypotheses.length} hypothesis(es)`);
			}
			if (params.openQuestions?.length) {
				parts.push(`${params.openQuestions.length} open question(s)`);
			}
			if (params.references?.length) {
				parts.push(`${params.references.length} file reference(s)`);
			}
			if (params.nextAction) {
				parts.push("a next action");
			}
			return {
				content: [
					{
						type: "text",
						text:
							parts.length > 0
								? `The checkpoint of the request was recorded: ${parts.join(", ")}.`
								: "The checkpoint of the request was recorded, but it was empty.",
					},
				],
				details: {},
			};
		},
	});
}

/**
 * Register the tool of the exploration checkpoint.
 */
export function registerExplorationCheckpointTool(
	pi: ExtensionAPI,
	options: ExplorationCheckpointToolOptions,
): void {
	pi.registerTool(explorationCheckpointTool(options));
}
