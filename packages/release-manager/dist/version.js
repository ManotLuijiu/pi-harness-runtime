/**
 * Release Manager — Version Operations (RFC-0078)
 */
export function parseVersion(str) {
    const cleaned = str.replace(/^v/, "");
    const [main, minor, rest] = cleaned.split(".");
    const patchPart = rest?.split("-")[0] ?? "0";
    return {
        major: parseInt(main ?? "0", 10),
        minor: parseInt(minor ?? "0", 10),
        patch: parseInt(patchPart ?? "0", 10),
        prerelease: rest?.includes("-")
            ? rest.split("-").slice(1).join("-")
            : undefined,
    };
}
export function formatVersion(v) {
    let str = `${v.major}.${v.minor}.${v.patch}`;
    if (v.prerelease)
        str += `-${v.prerelease}`;
    if (v.build)
        str += `+${v.build}`;
    return str;
}
export function bumpVersion(v, part) {
    switch (part) {
        case "major":
            return { major: v.major + 1, minor: 0, patch: 0 };
        case "minor":
            return { major: v.major, minor: v.minor + 1, patch: 0 };
        case "patch":
            return { major: v.major, minor: v.minor, patch: v.patch + 1 };
    }
}
export function compareVersions(a, b) {
    if (a.major !== b.major)
        return a.major - b.major;
    if (a.minor !== b.minor)
        return a.minor - b.minor;
    if (a.patch !== b.patch)
        return a.patch - b.patch;
    if (a.prerelease && !b.prerelease)
        return -1;
    if (!a.prerelease && b.prerelease)
        return 1;
    if (a.prerelease && b.prerelease)
        return a.prerelease.localeCompare(b.prerelease);
    return 0;
}
export function isPrerelease(v) {
    return !!v.prerelease;
}
//# sourceMappingURL=version.js.map