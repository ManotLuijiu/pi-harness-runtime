/**
 * Keys that never leave the machine.
 *
 * A key name is a strong hint about its content: "prompt", "output" or
 * "transcript" carry private text, "path" and "url" carry the shape of the
 * user's workspace. The list is shared by the client side classifier and the
 * server side sanitizer, so both sides agree on what is private.
 */
export declare const LOCAL_ONLY_FIELD_KEYS: string[];
/** True when the key is one that must not be shipped. */
export declare function isLocalOnlyFieldKey(key: string): boolean;
//# sourceMappingURL=sensitive-keys.d.ts.map