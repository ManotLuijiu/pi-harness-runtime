/**
 * The types of the exploration guard.
 *
 * The guard watches what the agent reads while it investigates a request.
 * It keeps a bounded record of that investigation, so a compaction cannot
 * make the agent rediscover what it already read, and a repeated read of the
 * same range can be recognised instead of silently accepted.
 *
 * Nothing here claims that the agent understood a file. The record holds
 * observations and the statements of the agent, and both are evidence to
 * inspect, not proof.
 */

/** The phase the exploration belongs to. */
export type ExplorationPhase =
	| "implementation"
	| "review"
	| "review_fixes"
	| "test"
	| "other";

/**
 * The kind of an observation.
 *
 * A read of a range and a search are different kinds of work, and a file
 * that was only searched is not a file that was read.
 */
export type ObservationKind = "read" | "search" | "shell-read";

/**
 * How well the source of an observation is known.
 *
 * A tool that reports a file and a range is a known source. A shell command
 * that was recognised as a read is a known kind with an unknown target. A
 * command that was not recognised is unknown: it says nothing about the
 * coverage of any file.
 */
export type ObservationSource = "known" | "unknown";

/**
 * A range of a file that was inspected.
 *
 * The range is one-based and inclusive on both ends. A read without a range
 * covers the whole file, and a read of a truncated result covers only what
 * was returned.
 */
export interface InspectedRange {
	/** The first line of the range. */
	start: number;
	/** The last line of the range. */
	end: number;
	/** True when the result was cut short and the range is only a part. */
	truncated?: boolean;
}

/**
 * What the guard knows about one file.
 *
 * The record holds the identity of the file and the hash of its content, so
 * a change of the file can be detected. It never holds the content itself.
 */
export interface FileCoverage {
	/** The path of the file, as the tool reported it. */
	path: string;
	/** The hash of the content, when the source reported one. */
	contentHash?: string;
	/** The version of the file, when the source reported one. */
	version?: string;
	/** Every range that was inspected successfully. */
	ranges: InspectedRange[];
	/** How often the file was read. */
	readCount: number;
	/** How often a range was read that was already covered. */
	repeatCount: number;
	/** The size of the returned content, in bytes, when it was observed. */
	observedBytes?: number;
	/** True when the file was only searched and never read. */
	searchOnly: boolean;
	/** The queries that searched this file. */
	searchQueries: string[];
}

/**
 * A search that was run.
 *
 * A search is not a read of a file: it names a query and a scope, and the
 * same query twice is a repetition unless the question changed.
 */
export interface SearchCoverage {
	/** The query of the search. */
	query: string;
	/** The scope of the search, when the source reported one. */
	scope?: string;
	/** How often the same query was run. */
	count: number;
	/** The size of the returned content, in bytes, when it was observed. */
	observedBytes?: number;
}

/**
 * A finding the agent reported.
 *
 * A finding names where it came from, so a later reader can check it.
 */
export interface ExplorationFinding {
	/** The short statement of the finding. */
	statement: string;
	/** The source locations the finding came from. */
	locations?: string[];
	/** When the finding was recorded. */
	at: number;
}

/**
 * A hypothesis the agent narrowed.
 *
 * A hypothesis that was ruled out is progress too, and it is recorded so a
 * later agent does not spend the effort again.
 */
export interface NarrowedHypothesis {
	/** The statement of the hypothesis. */
	statement: string;
	/** True when the hypothesis was ruled out. */
	rejected: boolean;
	/** When the hypothesis was recorded. */
	at: number;
}

/**
 * The semantic checkpoint of the agent.
 *
 * The agent supplies this, because only the agent knows what it found and
 * what it still needs. The guard never writes it.
 */
export interface ExplorationCheckpoint {
	/** The findings of the investigation. */
	findings: ExplorationFinding[];
	/** The hypotheses that were narrowed or ruled out. */
	hypotheses: NarrowedHypothesis[];
	/** The questions that are still open. */
	openQuestions: string[];
	/** The next concrete action. */
	nextAction?: string;
	/** The revision of the checkpoint, bumped by the agent. */
	revision: number;
	/**
	 * The issue of the store that the work belongs to.
	 *
	 * The identifiers are evidence, not identity: they say which handoff
	 * the checkpoint belongs to, and they never take part in the identity
	 * of the request.
	 */
	bdIssueId?: string;
	/** The handoff that the work belongs to. */
	handoffId?: string;
	/** The correlation of the request the work belongs to. */
	correlationId?: string;
}

/**
 * The reason a repeated read was allowed.
 *
 * A repeat is legitimate when the file changed, when a new question needs
 * it, or when the agent recorded an extension.
 */
export type RereadReason =
	| "content-changed"
	| "new-question"
	| "recorded-extension"
	| "revalidation";

/**
 * A warning the guard raised.
 */
export interface ExplorationWarning {
	/** Why the guard raised it. */
	reason: string;
	/** When it was raised. */
	at: number;
}

/**
 * The persisted state of the exploration of one request.
 *
 * The state is keyed by the workspace, the session, the generation, the
 * phase and the todo, so a new request never inherits the counters of
 * another one.
 */
export interface ExplorationState {
	/** The canonical workspace of the request. */
	workspace: string;
	/** The session of the request. */
	sessionId: string;
	/** The generation of the request. */
	generation: string;
	/** The phase the exploration belongs to. */
	phase: ExplorationPhase;
	/** The todo the exploration belongs to, when there is one. */
	todoId?: number;
	/** The coverage of every file the agent read. */
	files: FileCoverage[];
	/** The searches the agent ran. */
	searches: SearchCoverage[];
	/** How many reads were observed. */
	readCount: number;
	/** How many reads repeated a range that was already covered. */
	repeatCount: number;
	/** The estimated cost of the observed output, in tokens. */
	estimatedTokens: number;
	/** True when the estimate is an estimate and not a measured value. */
	estimatedTokensApproximate: boolean;
	/** The cumulative time spent exploring, in milliseconds. */
	explorationTimeMs: number;
	/** The semantic checkpoint of the agent. */
	checkpoint: ExplorationCheckpoint;
	/** The revision of the checkpoint. */
	checkpointRevision: number;
	/**
	 * The revision the guard spoke at, when it spoke.
	 *
	 * The pair of the revision and the seriousness is what the guard
	 * remembers. It is part of the state, so a restart of the harness does
	 * not make the guard speak again for a warning the agent already got.
	 */
	spokenRevision?: number;
	/**
	 * The seriousness of the last intervention the guard delivered.
	 */
	spokenSeverity?: number;
	/** The last warning the guard raised. */
	lastWarning?: ExplorationWarning;
	/** The reason of the last allowed repeat. */
	lastRereadReason?: RereadReason;
	/**
	 * True when the checkpoint of the previous compaction was consumed.
	 *
	 * The guard restores the checkpoint after a compaction. A consumed
	 * checkpoint is one that the agent already worked with, so it is not
	 * restored a second time.
	 */
	previousCheckpointConsumed: boolean;
	/** When the state was written. */
	updatedAt: number;
}

/**
 * The identity of the exploration of a request.
 *
 * Every part of the identity has to match: a state of another workspace, of
 * another session or of another generation is a different exploration.
 */
export interface ExplorationKey {
	workspace: string;
	sessionId: string;
	generation: string;
	phase: ExplorationPhase;
	todoId?: number;
}

/**
 * The budget of the exploration.
 *
 * The values are configuration, not a law: a large investigation needs
 * more than a small one, and the deployment chooses them from its own
 * traces.
 */
export interface ExplorationBudget {
	/**
	 * The number of reads after which the guard asks for a checkpoint.
	 *
	 * A value of zero disables the warning on the count alone.
	 */
	readWarning: number;
	/**
	 * The number of reads after which the guard requires a checkpoint before
	 * another broad exploration batch.
	 *
	 * A value of zero disables the budget.
	 */
	readBudget: number;
	/**
	 * The number of reads without a narrowing after which the guard asks
	 * what the investigation is for.
	 */
	stallWarning: number;
	/**
	 * The estimated token cost after which the guard asks for a checkpoint.
	 */
	tokenWarning: number;
	/**
	 * The exploration time in milliseconds after which the guard asks for a
	 * checkpoint.
	 */
	timeWarningMs: number;
	/**
	 * The number of identical reads of one range after which the guard
	 * warns about that range.
	 */
	repeatWarning: number;
}
