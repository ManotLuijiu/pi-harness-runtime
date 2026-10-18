/**
 * Permission Mode Types
 */
/**
 * Default permission modes
 */
export const DEFAULT_PERMISSION_MODES = {
    supervised: {
        type: 'supervised',
    },
    'auto-accept-edits': {
        type: 'auto-accept-edits',
        autoAcceptTools: ['write', 'edit', 'create'],
    },
    auto: {
        type: 'auto',
        autoAcceptTools: ['read', 'search', 'list'],
    },
    'full-access': {
        type: 'full-access',
    },
};
/**
 * Get default mode for new sessions
 */
export function getDefaultMode() {
    return { ...DEFAULT_PERMISSION_MODES['full-access'] };
}
/**
 * Check if mode requires approval for tool
 */
export function requiresApproval(mode, tool) {
    if (mode.blockedTools?.includes(tool)) {
        return true;
    }
    switch (mode.type) {
        case 'full-access':
            return false;
        case 'auto-accept-edits':
            return !mode.autoAcceptTools?.includes(tool);
        case 'auto':
            return !mode.autoAcceptTools?.includes(tool);
        case 'supervised':
        default:
            return true;
    }
}
