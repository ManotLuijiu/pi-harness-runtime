/**
 * Journey Renderer - ASCII timeline visualization of learning
 *
 * Renders the learning journey as an ASCII timeline.
 * Based on Hermes Agent's Learning Journey visualization.
 */
import type { NodeType } from "./learning-graph.js";
/**
 * Render options
 */
export interface JourneyRenderOptions {
    /** Maximum width */
    width: number;
    /** Maximum height */
    height: number;
    /** Show colors */
    color: boolean;
    /** Show all nodes or recent only */
    showAll: boolean;
    /** Limit to specific type */
    type?: NodeType;
    /** Limit to recent N nodes */
    limit?: number;
}
/**
 * Default render options
 */
export declare const DEFAULT_RENDER_OPTIONS: JourneyRenderOptions;
/**
 * Render the journey timeline
 */
export declare function renderJourney(options?: Partial<JourneyRenderOptions>): string;
/**
 * Render as JSON
 */
export declare function renderJourneyJSON(): string;
/**
 * Render summary
 */
export declare function renderSummary(): string;
/**
 * Render node list
 */
export declare function renderNodeList(type?: NodeType): string;
/**
 * Animate journey build-up
 */
export declare function animateJourney(onFrame: (output: string) => void, options?: Partial<JourneyRenderOptions>): Promise<void>;
export declare function parseJourneyArgs(args: string[]): {
    command: string;
    options: Partial<JourneyRenderOptions>;
};
//# sourceMappingURL=journey-renderer.d.ts.map