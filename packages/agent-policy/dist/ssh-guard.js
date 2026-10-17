/**
 * SSH Guard Tool
 *
 * Intercepts SSH commands and checks if the destination matches the local environment.
 * Combines automatic checking with a fresh reminder when the agent proposes SSH.
 */
import { execSync } from "node:child_process";
import dns from "node:dns";
import { promisify } from "node:util";
const lookupAsync = promisify(dns.lookup);
/**
 * Parse SSH destination from command line
 */
function parseSshDestination(command) {
    // Match patterns like:
    // ssh user@host
    // ssh host
    // ssh -p port user@host
    // ssh host.domain.com
    const match = command.match(/ssh\s+(?:-[a-z]+\s+)*((?:[a-zA-Z0-9_-]+\@)?[a-zA-Z0-9._-]+)/);
    return match ? match[1] : null;
}
/**
 * Get local IP addresses (cross-platform)
 */
function getLocalAddresses() {
    try {
        const isWindows = process.platform === "win32";
        let output;
        if (isWindows) {
            // Windows: use ipconfig
            output = execSync("ipconfig", { encoding: "utf8", timeout: 5000, windowsHide: true });
        }
        else {
            // Unix-like: use ip address
            output = execSync("ip -j address 2>/dev/null || ip address 2>/dev/null", {
                encoding: "utf8",
                timeout: 5000,
            });
        }
        const addresses = ["127.0.0.1", "::1", "localhost"];
        // Parse JSON output if available (Linux)
        try {
            const json = JSON.parse(output);
            for (const iface of json) {
                for (const addr of iface.addr_info || []) {
                    if (addr.local !== addr.peer) {
                        addresses.push(addr.local);
                    }
                }
            }
        }
        catch {
            // Fallback to text parsing
            if (isWindows) {
                // Windows ipconfig: parse "IPv4 Address. . . . . . . . . . : X.X.X.X"
                const windowsMatch = output.matchAll(/IPv4[^:]*:\s*([0-9.]+)/gi);
                for (const match of windowsMatch) {
                    const ip = match[1];
                    if (ip !== "127.0.0.1") {
                        addresses.push(ip);
                    }
                }
                // Also check for IPv6
                const ipv6Match = output.matchAll(/IPv6[^:]*:\s*([0-9a-f:]+)/gi);
                for (const match of ipv6Match) {
                    addresses.push(match[1]);
                }
            }
            else {
                // Unix-like: parse "inet X.X.X.X"
                const ipMatch = output.match(/inet\s+([0-9.]+)/g);
                if (ipMatch) {
                    for (const match of ipMatch) {
                        const ip = match.replace("inet ", "");
                        if (ip !== "127.0.0.1") {
                            addresses.push(ip);
                        }
                    }
                }
            }
        }
        return [...new Set(addresses)];
    }
    catch {
        return ["127.0.0.1", "::1", "localhost"];
    }
}
/**
 * Resolve hostname to IP address
 */
async function resolveHost(hostname) {
    // Skip if already an IP
    if (/^[0-9.]+$/.test(hostname))
        return hostname;
    if (/^[0-9a-f:]+$/i.test(hostname))
        return hostname;
    try {
        const result = await lookupAsync(hostname);
        return result.address;
    }
    catch {
        return null;
    }
}
/**
 * Check if destination is local
 */
export async function checkSshNecessity(command) {
    const destination = parseSshDestination(command);
    if (!destination) {
        return {
            allowed: true,
            message: "Could not parse SSH destination",
            isLocal: false,
        };
    }
    const localAddresses = getLocalAddresses();
    const resolved = await resolveHost(destination);
    if (!resolved) {
        return {
            allowed: true,
            message: `Could not resolve SSH destination: ${destination}`,
            isLocal: false,
            destinationAddress: undefined,
        };
    }
    const isLocal = localAddresses.some((addr) => addr === resolved || resolved === addr);
    if (isLocal) {
        return {
            allowed: false,
            message: `SSH destination ${destination} (${resolved}) matches this environment (local addresses: ${localAddresses.join(", ")}). Run the command locally, or explain why a separate SSH session is required.`,
            isLocal: true,
            destinationAddress: resolved,
        };
    }
    return {
        allowed: true,
        message: `SSH to ${destination} (${resolved}) appears necessary - destination differs from local addresses`,
        isLocal: false,
        destinationAddress: resolved,
    };
}
/**
 * Tool definition for SSH guard
 */
export const SshGuardTool = {
    name: "ssh_guard_check",
    description: "Check if SSH destination matches local environment before allowing SSH",
    parameters: {
        type: "object",
        properties: {
            command: {
                type: "string",
                description: "The SSH command to check",
            },
        },
        required: ["command"],
    },
};
/**
 * Execute SSH guard check
 */
export async function executeSshGuard(args, _api, _context) {
    const result = await checkSshNecessity(args.command);
    return {
        allowed: result.allowed,
        message: result.message,
        isLocal: result.isLocal,
    };
}
//# sourceMappingURL=ssh-guard.js.map