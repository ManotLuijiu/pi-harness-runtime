/**
 * Notification Base Adapter — RFC-0022
 *
 * Abstract base class for all notification channel adapters.
 */
export class BaseChannelAdapter {
    config;
    constructor(config) {
        this.config = config;
    }
    isConfigured() {
        return this.config.enabled;
    }
    /**
     * Redact sensitive data from payload before sending
     */
    redact(payload, patterns) {
        if (patterns.length === 0)
            return payload;
        const redacted = [];
        const details = payload.details ? { ...payload.details } : {};
        for (const [key, value] of Object.entries(details)) {
            const valStr = String(value);
            for (const pattern of patterns) {
                if (pattern.test(valStr)) {
                    redacted.push(key);
                    details[key] = "[REDACTED]";
                    break;
                }
            }
        }
        return {
            ...payload,
            details,
            redacted: redacted.length > 0 ? redacted : undefined,
        };
    }
}
