/**
 * Token Estimation
 *
 * Rough token counting for messages and text.
 * Used for context window management before API calls.
 */

/**
 * Rough token count estimation — conservative (overestimates slightly).
 * Based on average ~3.8 chars/token for English text.
 */
export function roughTokenCount(text: string): number {
	if (!text || text.length === 0) return 0;

	// Count words as proxy for tokens (more accurate for mixed content)
	const words = text.trim().split(/\s+/).length;
	// Average English token ~1.3 words, overhead for JSON structure
	return Math.ceil(text.length / 3.5) + Math.ceil(words * 0.3);
}

/**
 * Rough token count for a structured message.
 * Handles role, content, tool_calls, tool_results, thinking blocks.
 */
export function roughMessageTokens(msg: {
	role?: string;
	content?:
		| string
		| {
				type: string;
				text?: string;
				name?: string;
				input?: unknown;
				thinking?: string;
		  }[]
		| null;
	tool_calls?: { id: string; name: string; input: unknown }[];
	thinking?: string;
}): number {
	if (!msg) return 0;

	let tokens = 0;

	// Role overhead: ~4 tokens per message
	tokens += 4;

	// Content
	if (typeof msg.content === "string") {
		tokens += roughTokenCount(msg.content);
	} else if (Array.isArray(msg.content)) {
		for (const block of msg.content) {
			if (block.type === "text" && block.text) {
				tokens += roughTokenCount(block.text);
			} else if (block.type === "tool_use" && block.name) {
				// Tool name + JSON input
				tokens += roughTokenCount(block.name);
				if (block.input) {
					tokens += roughTokenCount(JSON.stringify(block.input));
				}
			} else if (block.type === "tool_result") {
				// Tool result: estimate 50 tokens overhead + content
				tokens += 50;
			} else if (block.type === "image") {
				// Image blocks: ~2000 tokens (Anthropic convention)
				tokens += 2000;
			} else if (block.type === "thinking" && block.thinking) {
				tokens += roughTokenCount(block.thinking);
			}
		}
	}

	// Tool calls (separate from content blocks)
	if (msg.tool_calls && Array.isArray(msg.tool_calls)) {
		for (const tc of msg.tool_calls) {
			tokens += roughTokenCount(tc.name);
			if (tc.input) {
				tokens += roughTokenCount(JSON.stringify(tc.input));
			}
		}
	}

	// Thinking blocks
	if (msg.thinking) {
		tokens += roughTokenCount(msg.thinking);
	}

	return tokens;
}

/**
 * Rough token count for a full message array (API request format).
 */
export function roughMessagesTokens(
	messages: Array<{
		role?: string;
		content?:
			| string
			| {
					type: string;
					text?: string;
					name?: string;
					input?: unknown;
					thinking?: string;
			  }[]
			| null;
		tool_calls?: { id: string; name: string; input: unknown }[];
		thinking?: string;
	}>,
): number {
	return messages.reduce((sum, msg) => sum + roughMessageTokens(msg), 0);
}

/**
 * Estimate tokens for a system prompt string.
 * System prompts typically have overhead from role markers.
 */
export function roughSystemPromptTokens(systemPrompt: string): number {
	// System message overhead (~15 tokens for role markers) + content
	return 15 + roughTokenCount(systemPrompt);
}

/**
 * Estimate tokens for tool definitions (schema).
 */
export function roughToolDefinitionTokens(tool: {
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
}): number {
	let tokens = roughTokenCount(tool.name);
	if (tool.description) {
		tokens += roughTokenCount(tool.description);
	}
	if (tool.input_schema) {
		tokens += roughTokenCount(JSON.stringify(tool.input_schema));
	}
	return tokens;
}

/**
 * Estimate total request tokens (input to API).
 */
export interface RequestTokenEstimate {
	systemPrompt: number;
	messages: number;
	tools: number;
	total: number;
	maxOutputTokens: number;
	availableForContext: number;
}

export function estimateRequestTokens(
	systemPrompt: string,
	messages: Array<{
		role?: string;
		content?:
			| string
			| {
					type: string;
					text?: string;
					name?: string;
					input?: unknown;
					thinking?: string;
			  }[]
			| null;
		tool_calls?: { id: string; name: string; input: unknown }[];
	}>,
	tools: Array<{
		name: string;
		description?: string;
		input_schema?: Record<string, unknown>;
	}>,
	maxOutputTokens: number,
): RequestTokenEstimate {
	const systemPromptTokens = roughSystemPromptTokens(systemPrompt);
	const messagesTokens = roughMessagesTokens(messages);
	const toolsTokens = tools.reduce(
		(sum, tool) => sum + roughToolDefinitionTokens(tool),
		0,
	);
	const total = systemPromptTokens + messagesTokens + toolsTokens;
	const availableForContext = maxOutputTokens > 0 ? maxOutputTokens - total : 0;

	return {
		systemPrompt: systemPromptTokens,
		messages: messagesTokens,
		tools: toolsTokens,
		total,
		maxOutputTokens,
		availableForContext,
	};
}
