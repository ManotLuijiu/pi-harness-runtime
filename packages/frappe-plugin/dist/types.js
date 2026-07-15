/**
 * Frappe Plugin — Types (RFC-0061)
 */
// ─── Errors ───────────────────────────────────────────────────────────────────
export class FrappeWorkspaceError extends Error {
    code;
    constructor(message, code = "INVALID_WORKSPACE") {
        super(message);
        this.name = "FrappeWorkspaceError";
        this.code = code;
    }
}
//# sourceMappingURL=types.js.map