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
export {};
//# sourceMappingURL=types.js.map