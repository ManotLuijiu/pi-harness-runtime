/**
 * Notification Base Adapter — RFC-0022
 *
 * Abstract base class for all notification channel adapters.
 */
export class BaseChannelAdapter {
    config;
    _healthy = false;
    _diagnostic = null;
    constructor(config) {
        this.config = config;
    }
    isConfigured() {
        return this.config.enabled;
    }
    /**
     * Default health check - subclasses should override for actual health verification
     */
    isHealthy() {
        return this._healthy;
    }
    /**
     * Mark adapter as healthy (called after successful initialize)
     */
    markHealthy() {
        this._healthy = true;
        this._diagnostic = null;
    }
    /**
     * Record why the adapter is not healthy.
     *
     * The reason is what the startup summary shows, so it must be short and
     * must never contain a credential.
     */
    setDiagnostic(reason) {
        this._diagnostic = reason;
    }
    /**
     * Why the adapter is not healthy (null when healthy).
     */
    getDiagnostic() {
        return this._healthy ? null : this._diagnostic;
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
//# sourceMappingURL=base-adapter.js.map