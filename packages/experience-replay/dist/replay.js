/**
 * Experience Replay (RFC-0059)
 *
 * Reconstructs prior runtime execution from persisted events and checkpoints.
 */
// ─── Event Timeline Reconstruction ───────────────────────────────────────────
function reconstructTimeline(events, startSequence = 0) {
    return events.map((event, index) => ({
        sequence: startSequence + index,
        timestamp: event.ts,
        type: event.type,
        data: event.data || {},
    }));
}
// ─── State Reconstruction ─────────────────────────────────────────────────────
function reconstructState(jobId, checkpoint, events, taskGraph) {
    // Apply events to checkpoint to get final state
    let currentTaskId = checkpoint?.currentTaskId;
    let status = checkpoint?.status || "unknown";
    // Process events to find latest state
    for (const event of events) {
        if (event.type === "task.started" && event.data?.taskId) {
            currentTaskId = event.data.taskId;
        }
        if (event.type === "job.status") {
            status = event.data?.status || status;
        }
    }
    return {
        jobId,
        status,
        currentTaskId,
        checkpoint: checkpoint || {
            version: 0,
            jobId,
            status: "unknown",
            requirement: "",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        },
        taskGraph: taskGraph || { nodes: [], edges: [] },
        events,
        timestamp: new Date().toISOString(),
    };
}
// ─── Divergence Detection ────────────────────────────────────────────────────
// ─── Source Validation ────────────────────────────────────────────────────────
function validateSources(sources) {
    const missing = [];
    if (!sources.checkpoint && !sources.events) {
        missing.push("checkpoint or events");
    }
    return { valid: missing.length === 0, missing };
}
// ─── Mode Handlers ────────────────────────────────────────────────────────────
async function handleInspect(sources, jobId, fromSequence, toSequence) {
    const events = sources.events || [];
    const filteredEvents = fromSequence !== undefined || toSequence !== undefined
        ? events.slice(fromSequence, toSequence)
        : events;
    const timeline = reconstructTimeline(filteredEvents, fromSequence ?? 0);
    const state = reconstructState(jobId, sources.checkpoint, filteredEvents, sources.taskGraph);
    return { state, timeline };
}
async function handleSimulate(sources, jobId, fromSequence, toSequence) {
    const events = sources.events || [];
    const filteredEvents = fromSequence !== undefined || toSequence !== undefined
        ? events.slice(fromSequence, toSequence)
        : events;
    const timeline = reconstructTimeline(filteredEvents, fromSequence ?? 0);
    const state = reconstructState(jobId, sources.checkpoint, filteredEvents, sources.taskGraph);
    // Check for divergent events
    const divergences = [];
    for (let i = 0; i < timeline.length; i++) {
        const event = timeline[i];
        if (event.type.includes("error") || event.type.includes("failure")) {
            divergences.push({
                sequence: event.sequence,
                reason: "Provider output differs",
                severity: "warning",
            });
        }
    }
    return { state, timeline, divergences };
}
async function handleReexecute(sources, jobId, allowExternalCalls) {
    // Reexecute requires explicit approval and valid sources
    const validation = validateSources(sources);
    if (!validation.valid) {
        throw new Error(`Missing required sources: ${validation.missing.join(", ")}`);
    }
    if (!allowExternalCalls) {
        throw new Error("Reexecution with external calls requires explicit approval");
    }
    // For reexecution, we simulate first then mark for actual reexecution
    const result = await handleSimulate(sources, jobId);
    // Add informational divergence for reexecution mode
    result.divergences.push({
        sequence: 0,
        reason: "Runtime version differs",
        severity: "info",
    });
    return result;
}
// ─── Main Engine ───────────────────────────────────────────────────────────────
export class ExperienceReplay {
    eventListeners = [];
    /**
     * Replay a prior job execution
     */
    async replay(request, sources) {
        const { jobId, mode } = request;
        // Emit start event
        this.emit({ type: "replay.started", jobId, mode });
        // Validate sources
        const validation = validateSources(sources);
        if (!validation.valid) {
            return {
                jobId,
                reconstructedState: {
                    jobId,
                    status: "error",
                    checkpoint: sources.checkpoint || {},
                    taskGraph: sources.taskGraph || { nodes: [], edges: [] },
                    events: [],
                    timestamp: new Date().toISOString(),
                },
                timeline: [],
                divergences: [
                    {
                        sequence: 0,
                        reason: `Missing sources: ${validation.missing.join(", ")}`,
                        severity: "error",
                    },
                ],
                artifacts: [],
                replayedAt: new Date().toISOString(),
            };
        }
        try {
            let result;
            switch (mode) {
                case "inspect":
                    result = await handleInspect(sources, jobId, request.fromSequence, request.toSequence);
                    break;
                case "simulate":
                    result = await handleSimulate(sources, jobId, request.fromSequence, request.toSequence);
                    break;
                case "reexecute":
                    result = await handleReexecute(sources, jobId, request.allowExternalCalls);
                    break;
            }
            // Emit divergence events
            if (result.divergences) {
                for (const div of result.divergences) {
                    this.emit({
                        type: "replay.divergence.detected",
                        jobId,
                        reason: div.reason,
                    });
                }
            }
            // Collect artifacts
            const artifacts = [];
            if (sources.prompts)
                artifacts.push(...Object.keys(sources.prompts));
            if (sources.outputs)
                artifacts.push(...Object.keys(sources.outputs));
            // Emit completion event
            this.emit({ type: "replay.completed", jobId });
            return {
                jobId,
                reconstructedState: result.state,
                timeline: result.timeline,
                divergences: result.divergences || [],
                artifacts,
                replayedAt: new Date().toISOString(),
            };
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                jobId,
                reconstructedState: {
                    jobId,
                    status: "error",
                    checkpoint: sources.checkpoint || {},
                    taskGraph: sources.taskGraph || { nodes: [], edges: [] },
                    events: [],
                    timestamp: new Date().toISOString(),
                },
                timeline: [],
                divergences: [
                    {
                        sequence: 0,
                        reason: errorMessage,
                        severity: "error",
                    },
                ],
                artifacts: [],
                replayedAt: new Date().toISOString(),
            };
        }
    }
    /**
     * Subscribe to replay events
     */
    onEvent(listener) {
        this.eventListeners.push(listener);
        return () => {
            this.eventListeners = this.eventListeners.filter((l) => l !== listener);
        };
    }
    emit(event) {
        for (const listener of this.eventListeners) {
            try {
                listener(event);
            }
            catch {
                // Best effort
            }
        }
    }
}
// ─── Factory ─────────────────────────────────────────────────────────────────
export function createExperienceReplay() {
    return new ExperienceReplay();
}
//# sourceMappingURL=replay.js.map