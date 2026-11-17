/**
 * The observation of the read and search tools.
 *
 * The guard watches the tools the agent uses while it investigates. It
 * observes what the tool reported, not what the agent said it read: a tool
 * that failed read nothing, and a tool that was not recognised says nothing
 * about the coverage of any file.
 *
 * The shell is treated with care. A command that is clearly a read is
 * tracked; a command that is not recognised is unknown. The text of a
 * command is never executed to find out what it does.
 */
import type { InspectedRange, ObservationKind, ObservationSource } from "./types.js";
/**
 * What the guard learned from one tool call.
 */
export interface Observation {
    /** The kind of the observation. */
    kind: ObservationKind;
    /** How well the source of the observation is known. */
    source: ObservationSource;
    /** The tool that produced it. */
    toolName: string;
    /** The path of the file, when the tool named one. */
    path?: string;
    /** The range that was inspected, when the tool named one. */
    range?: InspectedRange;
    /** The query of a search. */
    query?: string;
    /** The scope of a search. */
    scope?: string;
    /** The size of the returned content, in bytes, when it was observed. */
    observedBytes?: number;
    /** True when the tool failed. */
    failed: boolean;
    /** True when the result was cut short. */
    truncated: boolean;
    /**
     * True when the observation counts as a read of a file.
     *
     * A search is not a read, and a tool the guard does not know says
     * nothing about the reading of a file.
     */
    countsAsRead: boolean;
    /** How long the tool took, in milliseconds. */
    durationMs?: number;
}
/**
 * The input of a tool call, as far as the guard reads it.
 */
export interface ToolCallInput {
    toolName: string;
    input?: unknown;
}
/**
 * The end of a tool call, as far as the guard reads it.
 */
export interface ToolCallEnd {
    toolName: string;
    isError?: boolean;
    result?: unknown;
    durationMs?: number;
}
/**
 * What the shell command is understood to be.
 *
 * The text of the command is only read, never run. A command that the
 * patterns do not recognise is unknown.
 */
export interface ShellCommandReading {
    kind: ObservationKind | "unknown";
    path?: string;
    query?: string;
}
/**
 * Recognise a shell command that reads.
 *
 * A command with a chain, a redirection or a substitution is unknown: the
 * parts after the first command are not inspected, so the reading of the
 * first command would be wrong.
 */
export declare function classifyShellCommand(command: string): ShellCommandReading;
/**
 * The observation of one tool call and its result.
 *
 * A failed call observes nothing: the file was not read.
 */
export declare function observeToolCall(call: ToolCallInput, end?: ToolCallEnd): Observation | undefined;
//# sourceMappingURL=observation.d.ts.map