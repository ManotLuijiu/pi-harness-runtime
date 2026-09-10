/**
 * CLI runner for the LangChain write-review loop.
 *
 * Usage:
 *   bun harness/langchain/run.ts --mode graph --request "implement X" [--max-iterations 3]
 *   bun harness/langchain/run.ts --mode graph --request "implement X" --dry-run
 *   bun harness/langchain/run.ts --mode supervisor --request "implement X"
 *
 * --dry-run uses deterministic stubs — no API keys needed. Use it to verify
 * the whole loop machinery (plan → write → review → fix → approve).
 *
 * Wiki: wiki/multi-agent-langchain.md
 */
export {};
//# sourceMappingURL=run.d.ts.map