/**
 * Release Manager — Version Operations (RFC-0078)
 */
import type { Version, SemVerPart } from "./types.js";
export declare function parseVersion(str: string): Version;
export declare function formatVersion(v: Version): string;
export declare function bumpVersion(v: Version, part: SemVerPart): Version;
export declare function compareVersions(a: Version, b: Version): number;
export declare function isPrerelease(v: Version): boolean;
//# sourceMappingURL=version.d.ts.map