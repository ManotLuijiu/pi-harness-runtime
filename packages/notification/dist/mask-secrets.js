/**
 * Secret Masking Utility
 *
 * Masks sensitive values in strings before sending to Telegram/other channels.
 * Shows first 4 + last 4 characters for identification.
 */
/**
 * Patterns that match sensitive values
 */
const SENSITIVE_PATTERNS = [
    // Generic API keys, tokens, secrets
    /[a-zA-Z0-9_-]{32,}/g, // Long alphanumeric strings (likely keys)
    /[A-Fa-f0-9]{32,}/g, // Hex strings (likely hashes/keys)
    /sk-[a-zA-Z0-9]{20,}/g, // OpenAI-style keys
    /Bearer\s+[a-zA-Z0-9_-]{20,}/gi, // Bearer tokens
    /token[=:]\s*[a-zA-Z0-9_-]{20,}/gi, // token=xxx patterns
    /secret[=:]\s*[a-zA-Z0-9_-]{20,}/gi, // secret=xxx patterns
    /key[=:]\s*[a-zA-Z0-9_-]{20,}/gi, // key=xxx patterns
    /password[=:]\s*[^\s,}]+/gi, // password=xxx patterns
    /client[_-]?secret[=:]\s*[^\s,}]+/gi, // client_secret=xxx
    /client[_-]?id[=:]\s*[a-zA-Z0-9_-]{20,}/gi, // client_id=xxx
    /infisical[_-]?(client[_-])?(secret|id)[=:]\s*[a-zA-Z0-9_-]{20,}/gi,
];
// Specific Infisical field names to mask
const INFISICAL_FIELDS = [
    "infisical_client_secret",
    "infisical_client_id",
    "infisical_project_id",
    "INFISICAL_CLIENT_SECRET",
    "INFISICAL_CLIENT_ID",
    "INFISICAL_PROJECT_ID",
];
// General sensitive field patterns
const SENSITIVE_FIELD_PATTERNS = [
    /_api_key$/i,
    /_secret$/i,
    /_token$/i,
    /_password$/i,
    /_credential$/i,
    /_auth$/i,
];
/**
 * Mask a value showing first and last characters
 */
export function maskValue(value) {
    if (!value || value.length <= 8) {
        return "****";
    }
    return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
/**
 * Check if a field name is sensitive
 */
export function isSensitiveField(fieldName) {
    const lower = fieldName.toLowerCase();
    // Check specific Infisical fields
    if (INFISICAL_FIELDS.some(f => lower === f.toLowerCase())) {
        return true;
    }
    // Check general patterns
    return SENSITIVE_FIELD_PATTERNS.some(pattern => pattern.test(lower));
}
/**
 * Mask a string value
 */
function maskStringValue(input) {
    let result = input;
    // First, mask any field=value patterns for sensitive fields
    for (const field of INFISICAL_FIELDS) {
        const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const pattern = new RegExp(`(${escapedField})\\s*[=:]\\s*([a-zA-Z0-9_-]+)`, "gi");
        result = result.replace(pattern, (_match, _field, value) => `${field}: ${maskValue(value)}`);
    }
    // Then mask generic patterns
    for (const pattern of SENSITIVE_PATTERNS) {
        result = result.replace(pattern, (match) => maskValue(match));
    }
    return result;
}
/**
 * Mask sensitive patterns in a string
 */
export function maskString(input) {
    return maskStringValue(input);
}
/**
 * Mask JSON object fields that are sensitive
 */
export function maskObject(obj, depth = 0) {
    // Prevent infinite recursion
    if (depth > 10 || obj === null || obj === undefined) {
        return obj;
    }
    if (typeof obj === "string") {
        return maskStringValue(obj);
    }
    if (typeof obj === "number" || typeof obj === "boolean") {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => maskObject(item, depth + 1));
    }
    if (typeof obj === "object") {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            if (isSensitiveField(key)) {
                result[key] = typeof value === "string" ? maskValue(value) : value;
            }
            else {
                result[key] = maskObject(value, depth + 1);
            }
        }
        return result;
    }
    return obj;
}
/**
 * Mask a message/notification payload
 */
export function maskPayload(obj) {
    return maskObject(obj);
}
/**
 * Format a value for display, masking if sensitive
 */
export function formatValue(key, value) {
    if (isSensitiveField(key) && typeof value === "string") {
        return `${key}: ${maskValue(value)}`;
    }
    return `${key}: ${value}`;
}
//# sourceMappingURL=mask-secrets.js.map