/**
 * The reported scenario: the explanation of the Honcho registration and the
 * final question.
 *
 * The caveat of the second alternative stands behind the two thousandth
 * character on purpose: a truncation policy that keeps the beginning of the
 * message loses it.
 */

export const HONCHO_CHOICE_MESSAGE = `Short answer: the API usage is correct, the success criterion is one step short.

Docs check (extensions.md, MCP Servers, and mcp.md):

| Doc statement | Our code | Verdict |
| --- | --- | --- |
| Extensions can add servers for the current session with pi.registerMcpServer(name, config) | harness/honcho-init.ts registers the honcho server | correct |
| Registrations are not saved: register again on every load | the registration happens in the session_start handler | correct |
| A server in mcp.json with the same name takes precedence | we do not shadow honcho in mcp.json | correct |
| The built-in MCP support connects registered servers | we treat the registration as the success | gap |
| Other MCP extensions can connect registered servers too | we do neither | missing |

The registration is only a declaration, and the connection is someone else's job. The harness therefore reports ready and ok while the model has no Honcho tools at all, and the only truthful signal was Pi's own diagnostic. The label of an option does not carry its meaning either, so an evaluation that only sees "implement A" and "A+B" decides about two letters and not about two scopes of work.

## Two ways to close it

**A. Truthful reporting only (small).** Keep the registration, but split the two facts: report registered with Pi, and add that the tools reach the model only while an MCP connector is active. Pi's diagnostic already names the exact cause, so this is about our own message not lying.

**B. Become the connector (the documented path, and it makes the app self-sufficient).** Implement what the docs describe for a non-built-in MCP extension: read pi.getMcpServers() on session_start, handle mcp_servers_change, and connect the registered servers ourselves. We already ship a native client, so the connector is mostly reusing existing code. Then the Honcho tools work regardless of whether the built-in is enabled or replaced.

Caveat for B: handling mcp_servers_change marks us as the extension that connects registered servers, so we must actually connect, not just listen. Doing B half-way would suppress Pi's diagnostic while keeping the tools unavailable, which is worse than today.

The settings fix you approved resolves the current instance; A or B is what makes the app not depend on the user's MCP configuration.

Want me to implement A, or A+B?`;

/** The question at the end of the message. */
export const HONCHO_CHOICE_QUESTION = "Want me to implement A, or A+B?";

/** The alternatives the detection layer extracts from the question. */
export const HONCHO_CHOICE_ALTERNATIVES = ["implement A", "A+B"];
