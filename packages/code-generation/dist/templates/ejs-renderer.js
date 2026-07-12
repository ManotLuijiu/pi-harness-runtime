/**
 * Code Generation Pipeline - EJS Renderer
 *
 * EJS-based template rendering.
 */
/**
 * EJS Renderer for template rendering
 */
export class EjsRenderer {
    options;
    constructor(options = {}) {
        this.options = {
            ...DEFAULT_EJS_OPTIONS,
            ...options,
        };
    }
    /**
     * Render template with variables
     */
    async render(template, variables) {
        // Simple EJS-like template rendering
        // In production, use the actual ejs package
        let result = template;
        // Process <%= variable %> expressions
        result = result.replace(/<%=\s*([^%]+?)\s*%>/g, (_, expr) => {
            return this.evaluateExpression(expr.trim(), variables);
        });
        // Process <% code %> blocks
        result = result.replace(/<%\s*([^%]+?)\s*%>/g, (_, code) => {
            return this.executeCode(code.trim(), variables);
        });
        // Process <%- unescaped %> expressions
        result = result.replace(/<%-\s*([^%]+?)\s*-%>/g, (_, expr) => {
            return this.evaluateExpression(expr.trim(), variables);
        });
        // Process includes (simple version)
        result = result.replace(/<%-?\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*-%>/g, (_, name) => {
            return `[Include: ${name}]`;
        });
        return result;
    }
    /**
     * Evaluate expression
     */
    evaluateExpression(expr, context) {
        try {
            // Handle property access
            if (expr.includes(".")) {
                const parts = expr.split(".");
                let value = context;
                for (const part of parts) {
                    if (value && typeof value === "object") {
                        value = value[part];
                    }
                    else {
                        return "";
                    }
                }
                return String(value ?? "");
            }
            // Handle simple variable
            const value = context[expr];
            if (value === undefined) {
                return "";
            }
            // Handle arrays/objects
            if (Array.isArray(value)) {
                return value.join(", ");
            }
            if (typeof value === "object" && value !== null) {
                return JSON.stringify(value);
            }
            return String(value);
        }
        catch {
            return "";
        }
    }
    /**
     * Execute code block
     */
    executeCode(code, _context) {
        // Simple control flow support
        // In production, use the actual ejs package
        if (code.startsWith("if ")) {
            return "";
        }
        if (code.startsWith("}")) {
            return "";
        }
        if (code.startsWith("for ") || code.startsWith("while ")) {
            return "";
        }
        if (code.startsWith("/")) {
            return "";
        }
        return "";
    }
}
const DEFAULT_EJS_OPTIONS = {
    strict: false,
    debug: false,
    open: "<%",
    close: "%>",
};
//# sourceMappingURL=ejs-renderer.js.map