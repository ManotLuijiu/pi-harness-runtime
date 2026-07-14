/**
 * Codex Adapter — Types (RFC-0070)
 */
// Default Codex tools
export const DEFAULT_TOOLS = [
    {
        type: "function",
        name: "Read",
        description: "Read the complete contents of a file from the filesystem",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to the file" },
            },
            required: ["path"],
        },
    },
    {
        type: "function",
        name: "Write",
        description: "Write content to a file, creating directories if needed",
        parameters: {
            type: "object",
            properties: {
                path: { type: "string", description: "Absolute path to write to" },
                content: { type: "string", description: "Content to write" },
            },
            required: ["path", "content"],
        },
    },
    {
        type: "function",
        name: "Bash",
        description: "Execute a shell command in a sandboxed environment",
        parameters: {
            type: "object",
            properties: {
                command: { type: "string", description: "Shell command to execute" },
                timeout: {
                    type: "number",
                    description: "Max execution time in seconds",
                },
            },
            required: ["command"],
        },
    },
    {
        type: "function",
        name: "WebSearch",
        description: "Search the web for information",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "Search query" },
                max_results: {
                    type: "number",
                    description: "Max results (default: 5)",
                },
            },
            required: ["query"],
        },
    },
];
//# sourceMappingURL=types.js.map