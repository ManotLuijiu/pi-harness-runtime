/**
 * Experience Replay (RFC-0059)
 *
 * Reconstructs prior runtime execution from persisted events and checkpoints.
 */
import type { ReplayRequest, ReplayResult, ReplaySources, ReplayRuntimeEvent } from "./types.js";
export declare class ExperienceReplay {
    private eventListeners;
    /**
     * Replay a prior job execution
     */
    replay(request: ReplayRequest, sources: ReplaySources): Promise<ReplayResult>;
    /**
     * Subscribe to replay events
     */
    onEvent(listener: (event: ReplayRuntimeEvent) => void): () => void;
    private emit;
}
export declare function createExperienceReplay(): ExperienceReplay;
//# sourceMappingURL=replay.d.ts.map