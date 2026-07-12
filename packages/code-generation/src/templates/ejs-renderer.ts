/**
 * Code Generation Pipeline - EJS Renderer
 *
 * EJS-based template rendering.
 */

import type { TemplateRenderer } from "../generator.js";

/**
 * EJS Renderer for template rendering
 */
export class EjsRenderer implements TemplateRenderer {
	private readonly options: EjsOptions;

	constructor(options: EjsOptions = {}) {
		this.options = {
			...DEFAULT_EJS_OPTIONS,
			...options,
		};
	}

	/**
	 * Render template with variables
	 */
	async render(
		template: string,
		variables: Record<string, unknown>,
	): Promise<string> {
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
		result = result.replace(
			/<%-?\s*include\s*\(\s*['"]([^'"]+)['"]\s*\)\s*-%>/g,
			(_, name) => {
				return `[Include: ${name}]`;
			},
		);

		return result;
	}

	/**
	 * Evaluate expression
	 */
	private evaluateExpression(
		expr: string,
		context: Record<string, unknown>,
	): string {
		try {
			// Handle property access
			if (expr.includes(".")) {
				const parts = expr.split(".");
				let value: unknown = context;
				for (const part of parts) {
					if (value && typeof value === "object") {
						value = (value as Record<string, unknown>)[part];
					} else {
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
		} catch {
			return "";
		}
	}

	/**
	 * Execute code block
	 */
	private executeCode(code: string, _context: Record<string, unknown>): string {
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

interface EjsOptions {
	strict?: boolean;
	debug?: boolean;
	open?: string;
	close?: string;
}

const DEFAULT_EJS_OPTIONS: EjsOptions = {
	strict: false,
	debug: false,
	open: "<%",
	close: "%>",
};
