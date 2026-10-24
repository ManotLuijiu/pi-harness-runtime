/**
 * Keys that never leave the machine.
 *
 * A key name is a strong hint about its content: "prompt", "output" or
 * "transcript" carry private text, "path" and "url" carry the shape of the
 * user's workspace. The list is shared by the client side classifier and the
 * server side sanitizer, so both sides agree on what is private.
 */

export const LOCAL_ONLY_FIELD_KEYS = [
	"prompt",
	"response",
	"message",
	"content",
	"transcript",
	"output",
	"stdout",
	"stderr",
	"command",
	"text",
	"body",
	"payload",
	"code",
	"diff",
	"file",
	"path",
	"url",
	"uri",
	"email",
	"user",
	"chat",
	"question",
	"answer",
];

/** True when the key is one that must not be shipped. */
export function isLocalOnlyFieldKey(key: string): boolean {
	const lower = key.toLowerCase();
	return LOCAL_ONLY_FIELD_KEYS.some((needle) => lower.includes(needle));
}
