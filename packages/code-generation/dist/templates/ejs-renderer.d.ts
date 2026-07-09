/**
 * Code Generation Pipeline - EJS Renderer
 *
 * EJS-based template rendering.
 */
import type { TemplateRenderer } from "../generator.js";
/**
 * EJS Renderer for template rendering
 */
export declare class EjsRenderer implements TemplateRenderer {
    private readonly options;
    constructor(options?: EjsOptions);
    /**
     * Render template with variables
     */
    render(template: string, variables: Record<string, unknown>): Promise<string>;
    /**
     * Evaluate expression
     */
    private evaluateExpression;
    /**
     * Execute code block
     */
    private executeCode;
}
interface EjsOptions {
    strict?: boolean;
    debug?: boolean;
    open?: string;
    close?: string;
}
export {};
//# sourceMappingURL=ejs-renderer.d.ts.map