/**
 * Requirement Compiler - Types
 *
 * Type definitions for raw and compiled requirements.
 */
// ─── SDK Version ────────────────────────────────────────────────────────────
export const SDK_VERSION = "1.0.0";
export const DEFAULT_COMPILER_CONFIG = {
    projectLanguage: "en",
    autoPromotePreferences: false,
    allowReversibleAssumptions: true,
    riskKeywords: {
        financial: [
            "payment",
            "cost",
            "price",
            "fee",
            "charge",
            "invoice",
            "tax",
            "VAT",
            "value added tax",
            "ภาษี",
            "ภาษีมูลค่าเพิ่ม",
            "เงิน",
            "บาท",
        ],
        privacy: [
            "personal",
            "data",
            "privacy",
            "GDPR",
            "PDPA",
            "consent",
            "ข้อมูลส่วนบุคคล",
            "consent",
        ],
        authentication: [
            "auth",
            "login",
            "password",
            "token",
            "JWT",
            "OAuth",
            "session",
            "เข้าสู่ระบบ",
        ],
        authorization: [
            "permission",
            "role",
            "access control",
            "ACL",
            "authorize",
            "สิทธิ์",
        ],
        data_migration: [
            "migration",
            "import",
            "export",
            "convert",
            "migrate",
            "ย้ายข้อมูล",
        ],
        regulatory: [
            "compliance",
            "regulation",
            "audit",
            "log",
            "report",
            "กฎหมาย",
            "ระเบียบ",
        ],
        destructive_operation: [
            "delete",
            "drop",
            "truncate",
            "remove",
            "purge",
            "destroy",
            "ลบ",
        ],
    },
    mandatoryKeywords: [
        "must",
        "shall",
        "required",
        "need to",
        "have to",
        "จะต้อง",
        "ต้อง",
        "required",
    ],
    preferenceKeywords: [
        "prefer",
        "should",
        "could",
        "might",
        "suggest",
        "recommend",
        "nice to have",
        "ควร",
    ],
};
// ─── Compiler Errors ──────────────────────────────────────────────────────
/**
 * Error codes for requirement compilation failures.
 * Use this enum-like object for programmatic error checking.
 */
export const RequirementCompileErrorCodes = {
    EMPTY_REQUIREMENT: "EMPTY_REQUIREMENT",
    IMPOSSIBLE_REQUIREMENT: "IMPOSSIBLE_REQUIREMENT",
    POLICY_VIOLATION: "POLICY_VIOLATION",
    UNSUPPORTED_ATTACHMENT: "UNSUPPORTED_ATTACHMENT",
    UNRESOLVABLE_CONTRADICTION: "UNRESOLVABLE_CONTRADICTION",
};
/**
 * Error thrown during requirement compilation.
 */
export class RequirementCompileError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "RequirementCompileError";
    }
}
//# sourceMappingURL=types.js.map