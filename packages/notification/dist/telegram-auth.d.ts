/**
 * The authorization rule for Telegram senders.
 *
 * ONE implementation, shared by the harness, the remote webhook server and
 * the adapter - a second, more permissive copy would let anybody in a group
 * chat write into Pi.
 *
 * The rule:
 *  - the SENDER decides, never the chat: in a group every member shares the
 *    chat id, so a chat id alone would let the whole group write in
 *  - an allow-list is authoritative when it is configured
 *  - otherwise the configured chat id identifies the sender (a direct chat)
 *  - fail closed: with neither an allow-list nor a chat id nobody may
 */
/**
 * True when the sender may write into Pi.
 *
 * @param allowedUsers the configured allow-list (may be empty)
 * @param chatId the configured chat id (may be undefined)
 * @param fromId the id of the sender (undefined -> not authorized)
 */
export declare function isAuthorizedTelegramSender(allowedUsers: ReadonlySet<number> | readonly number[], chatId: number | undefined, fromId: number | undefined): boolean;
//# sourceMappingURL=telegram-auth.d.ts.map