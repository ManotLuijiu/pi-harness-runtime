/**
 * Deterministic write-review loop as a LangGraph StateGraph.
 *
 *   START → plan (GPT) → write (MiniMax) → review (GPT)
 *                                      ├─ approved / blocked / max-iter → finish
 *                                      └─ changes_requested → write (with comments)
 *
 * Unlike the supervisor variant (agents.ts, agents.py style) where an LLM
 * decides routing, here the structured review verdict drives the conditional
 * edge — the loop is guaranteed to terminate at maxIterations.
 *
 * Wiki: wiki/multi-agent-langchain.md
 */
import { type ReviewVerdict } from "./agents.js";
import type { LoopWidget } from "./widget.js";
declare const LoopState: import("@langchain/langgraph").AnnotationRoot<{
    /** Original user request */
    request: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Plan produced by the GPT planner */
    plan: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Current iteration (0 = first pass) */
    iteration: import("@langchain/langgraph").BaseChannel<number, number | import("@langchain/langgraph").OverwriteValue<number>, unknown>;
    /** Latest code output from the MiniMax coder */
    code: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Latest structured review from the GPT reviewer */
    review: {
        (annotation: import("@langchain/langgraph").SingleReducer<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, {
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }>): import("@langchain/langgraph").BaseChannel<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, import("@langchain/langgraph").OverwriteValue<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }> | {
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, unknown>;
        (): import("@langchain/langgraph").LastValue<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Human-readable step log (reducer appends) */
    log: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
    /** File that received comments in the previous review. Used for smart-stop. */
    lastCommentedFile: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
}>;
export type LoopState = typeof LoopState.State;
export interface LoopDeps {
    plan: (request: string) => Promise<string>;
    write: (plan: string, review: ReviewVerdict | null) => Promise<string>;
    review: (plan: string, code: string) => Promise<ReviewVerdict>;
    maxIterations: number;
    onStep?: (step: string, state: LoopState) => void;
    /** Optional widget for TUI / status-line display (mirrors pi-lens footer style). */
    widget?: LoopWidget;
}
export declare function buildWriteReviewLoop(deps: LoopDeps, opts?: {
    checkpointer?: boolean | unknown;
}): import("@langchain/langgraph").CompiledStateGraph<{
    request: string;
    plan: string;
    iteration: number;
    code: string;
    review: {
        verdict: "approved" | "blocked" | "changes_requested";
        summary: string;
        comments: {
            file?: string | undefined;
            comment: string;
            severity?: "critical" | "major" | "minor" | undefined;
        }[];
    };
    log: string[];
    lastCommentedFile: string | undefined;
}, {
    request?: string | undefined;
    plan?: string | undefined;
    iteration?: number | import("@langchain/langgraph").OverwriteValue<number> | undefined;
    code?: string | undefined;
    review?: {
        verdict: "approved" | "blocked" | "changes_requested";
        summary: string;
        comments: {
            file?: string | undefined;
            comment: string;
            severity?: "critical" | "major" | "minor" | undefined;
        }[];
    } | undefined;
    log?: string[] | import("@langchain/langgraph").OverwriteValue<string[]> | undefined;
    lastCommentedFile?: string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined;
}, "__start__" | "finishStep" | "planStep" | "reviewStep" | "writeStep", {
    /** Original user request */
    request: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Plan produced by the GPT planner */
    plan: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Current iteration (0 = first pass) */
    iteration: import("@langchain/langgraph").BaseChannel<number, number | import("@langchain/langgraph").OverwriteValue<number>, unknown>;
    /** Latest code output from the MiniMax coder */
    code: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Latest structured review from the GPT reviewer */
    review: {
        (annotation: import("@langchain/langgraph").SingleReducer<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, {
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }>): import("@langchain/langgraph").BaseChannel<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, import("@langchain/langgraph").OverwriteValue<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }> | {
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, unknown>;
        (): import("@langchain/langgraph").LastValue<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Human-readable step log (reducer appends) */
    log: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
    /** File that received comments in the previous review. Used for smart-stop. */
    lastCommentedFile: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
}, {
    /** Original user request */
    request: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Plan produced by the GPT planner */
    plan: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Current iteration (0 = first pass) */
    iteration: import("@langchain/langgraph").BaseChannel<number, number | import("@langchain/langgraph").OverwriteValue<number>, unknown>;
    /** Latest code output from the MiniMax coder */
    code: {
        (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
        (): import("@langchain/langgraph").LastValue<string>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Latest structured review from the GPT reviewer */
    review: {
        (annotation: import("@langchain/langgraph").SingleReducer<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, {
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }>): import("@langchain/langgraph").BaseChannel<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, import("@langchain/langgraph").OverwriteValue<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }> | {
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }, unknown>;
        (): import("@langchain/langgraph").LastValue<{
            verdict: "approved" | "blocked" | "changes_requested";
            summary: string;
            comments: {
                file?: string | undefined;
                comment: string;
                severity?: "critical" | "major" | "minor" | undefined;
            }[];
        }>;
        Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
    };
    /** Human-readable step log (reducer appends) */
    log: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
    /** File that received comments in the previous review. Used for smart-stop. */
    lastCommentedFile: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
}, import("@langchain/langgraph").StateDefinition, {
    finishStep: Partial<import("@langchain/langgraph").StateType<{
        /** Original user request */
        request: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Plan produced by the GPT planner */
        plan: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Current iteration (0 = first pass) */
        iteration: import("@langchain/langgraph").BaseChannel<number, number | import("@langchain/langgraph").OverwriteValue<number>, unknown>;
        /** Latest code output from the MiniMax coder */
        code: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Latest structured review from the GPT reviewer */
        review: {
            (annotation: import("@langchain/langgraph").SingleReducer<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>): import("@langchain/langgraph").BaseChannel<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, import("@langchain/langgraph").OverwriteValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }> | {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, unknown>;
            (): import("@langchain/langgraph").LastValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Human-readable step log (reducer appends) */
        log: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        /** File that received comments in the previous review. Used for smart-stop. */
        lastCommentedFile: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
    }>>;
    planStep: Partial<import("@langchain/langgraph").StateType<{
        /** Original user request */
        request: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Plan produced by the GPT planner */
        plan: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Current iteration (0 = first pass) */
        iteration: import("@langchain/langgraph").BaseChannel<number, number | import("@langchain/langgraph").OverwriteValue<number>, unknown>;
        /** Latest code output from the MiniMax coder */
        code: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Latest structured review from the GPT reviewer */
        review: {
            (annotation: import("@langchain/langgraph").SingleReducer<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>): import("@langchain/langgraph").BaseChannel<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, import("@langchain/langgraph").OverwriteValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }> | {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, unknown>;
            (): import("@langchain/langgraph").LastValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Human-readable step log (reducer appends) */
        log: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        /** File that received comments in the previous review. Used for smart-stop. */
        lastCommentedFile: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
    }>>;
    reviewStep: Partial<import("@langchain/langgraph").StateType<{
        /** Original user request */
        request: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Plan produced by the GPT planner */
        plan: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Current iteration (0 = first pass) */
        iteration: import("@langchain/langgraph").BaseChannel<number, number | import("@langchain/langgraph").OverwriteValue<number>, unknown>;
        /** Latest code output from the MiniMax coder */
        code: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Latest structured review from the GPT reviewer */
        review: {
            (annotation: import("@langchain/langgraph").SingleReducer<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>): import("@langchain/langgraph").BaseChannel<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, import("@langchain/langgraph").OverwriteValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }> | {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, unknown>;
            (): import("@langchain/langgraph").LastValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Human-readable step log (reducer appends) */
        log: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        /** File that received comments in the previous review. Used for smart-stop. */
        lastCommentedFile: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
    }>>;
    writeStep: Partial<import("@langchain/langgraph").StateType<{
        /** Original user request */
        request: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Plan produced by the GPT planner */
        plan: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Current iteration (0 = first pass) */
        iteration: import("@langchain/langgraph").BaseChannel<number, number | import("@langchain/langgraph").OverwriteValue<number>, unknown>;
        /** Latest code output from the MiniMax coder */
        code: {
            (annotation: import("@langchain/langgraph").SingleReducer<string, string>): import("@langchain/langgraph").BaseChannel<string, string | import("@langchain/langgraph").OverwriteValue<string>, unknown>;
            (): import("@langchain/langgraph").LastValue<string>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Latest structured review from the GPT reviewer */
        review: {
            (annotation: import("@langchain/langgraph").SingleReducer<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>): import("@langchain/langgraph").BaseChannel<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, import("@langchain/langgraph").OverwriteValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }> | {
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }, unknown>;
            (): import("@langchain/langgraph").LastValue<{
                verdict: "approved" | "blocked" | "changes_requested";
                summary: string;
                comments: {
                    file?: string | undefined;
                    comment: string;
                    severity?: "critical" | "major" | "minor" | undefined;
                }[];
            }>;
            Root: <S extends import("@langchain/langgraph").StateDefinition>(sd: S) => import("@langchain/langgraph").AnnotationRoot<S>;
        };
        /** Human-readable step log (reducer appends) */
        log: import("@langchain/langgraph").BaseChannel<string[], string[] | import("@langchain/langgraph").OverwriteValue<string[]>, unknown>;
        /** File that received comments in the previous review. Used for smart-stop. */
        lastCommentedFile: import("@langchain/langgraph").BaseChannel<string | undefined, string | import("@langchain/langgraph").OverwriteValue<string | undefined> | undefined, unknown>;
    }>>;
}, unknown, unknown, []>;
/** Inferred compiled-graph type (do not hand-roll langgraph generics). */
export type WriteReviewLoop = ReturnType<typeof buildWriteReviewLoop>;
export interface RealLoopOptions {
    maxIterations?: number;
    onStep?: (step: string, state: LoopState) => void;
    /** Directory for .write-review/blackboard. Defaults to process.cwd(). */
    blackboardDir?: string;
    importAgents?: () => Promise<{
        createPlannerAgent: () => {
            invoke: (input: {
                messages: unknown[];
            }) => Promise<{
                messages: Array<{
                    content: unknown;
                }>;
            }>;
        };
        createCoderAgent: () => {
            invoke: (input: {
                messages: unknown[];
            }) => Promise<{
                messages: Array<{
                    content: unknown;
                }>;
            }>;
        };
        createReviewerAgent: () => {
            invoke: (input: {
                messages: unknown[];
            }) => Promise<{
                messages: Array<{
                    content: unknown;
                }>;
                structuredResponse?: ReviewVerdict;
            }>;
        };
    }>;
}
/**
 * Build LoopDeps backed by the real GPT/MiniMax agents from agents.ts.
 * Kept lazy (dynamic import) so dry-run mode never touches API keys.
 *
 * The WriteReviewBlackboard is updated at each step and its markdown is
 * injected into every agent prompt — so each agent sees the shared scoreboard
 * naturally, without explicit prompt injection.
 */
export declare function buildRealLoopDeps(options?: RealLoopOptions): Promise<LoopDeps>;
/** Deterministic stubs: iteration 1 requests changes, iteration 2 approves. */
export declare function buildDryRunDeps(options?: {
    maxIterations?: number;
    onStep?: LoopDeps["onStep"];
    /** Directory for .write-review/blackboard. Defaults to process.cwd(). */
    blackboardDir?: string;
}): LoopDeps;
//# sourceMappingURL=graph.d.ts.map