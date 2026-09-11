import { PingPongDecisionEngine, type PingPongDecisionOptions, type PingPongDecisionResult } from "../../packages/intent-analyzer/src/index.js";
export interface PingPongMiddlewareOptions extends PingPongDecisionOptions {
    /** Shared directory watched by LoopDaemon. Defaults to /tmp/herdr-workspace. */
    workspace?: string;
    /** Repository root and blackboard owner. Defaults to process.cwd(). */
    projectRoot?: string;
    /** Agent or terminal identifier for audit records. */
    actorId?: string;
    /** Also enqueue suggest_ping_pong decisions. Default: false. */
    enqueueSuggestions?: boolean;
    /** Test hook for stable timestamps. */
    now?: () => Date;
}
export interface PingPongMiddlewareResult {
    decision: PingPongDecisionResult;
    enqueued: boolean;
    taskId?: string;
    taskFile?: string;
    auditFile: string;
    blackboardFile: string;
}
export declare class PingPongMiddleware {
    private readonly engine;
    constructor(engine?: PingPongDecisionEngine);
    submit(request: string, options?: PingPongMiddlewareOptions): PingPongMiddlewareResult;
}
export declare function submitPingPongIntent(request: string, options?: PingPongMiddlewareOptions): PingPongMiddlewareResult;
//# sourceMappingURL=ping-pong-middleware.d.ts.map