/**
 * Map a relay "telegram_message" payload onto a Telegram update.
 *
 * The mapping lives in a pure module so that it can be tested without the
 * harness: the relay carries the text, the adapter decides whether the
 * sender is allowed to write in.
 *
 * Rules:
 *  - the text is never put into an id field (ids are logged by the client)
 *  - the real bot flag has to survive the transport, otherwise the adapter
 *    could not refuse bot messages
 *  - a payload without text produces no update
 */

export interface TelegramMessageUpdate {
	message: {
		message_id: number;
		from: {
			id: number;
			is_bot: boolean;
			first_name: string;
			username?: string;
		};
		chat: { id: number };
		text: string;
	};
}

export interface TelegramMessagePayload {
	userId: number;
	username?: string;
	messageId?: number;
	chatId?: number;
	text?: string;
	isBot?: boolean;
}

export interface TelegramCallbackUpdate {
	callback_query: {
		id: string;
		from: {
			id: number;
			is_bot: boolean;
			first_name: string;
			username?: string;
		};
		data: string;
		message: {
			chat: { id: number };
			message_id: number;
		};
	};
}

/**
 * Build the Telegram update for a relayed button callback.
 *
 * The real bot flag has to survive the transport: the adapter refuses
 * messages and callbacks of a bot.
 */
export function buildTelegramCallbackUpdate(
	payload: TelegramMessagePayload & {
		action?: string;
		targetId?: string;
		callbackQueryId?: string;
		id?: string;
	},
): TelegramCallbackUpdate | null {
	const userId = Number(payload.userId);
	if (!Number.isFinite(userId)) return null;
	const chatId = Number(payload.chatId);
	const effectiveChatId = Number.isFinite(chatId) ? chatId : userId;
	return {
		callback_query: {
			id: payload.callbackQueryId || String(payload.id || ""),
			from: {
				id: userId,
				is_bot: payload.isBot === true,
				first_name: payload.username || "User",
				username: payload.username,
			},
			data: `${payload.action || ""}:${payload.targetId || ""}`,
			message: {
				chat: { id: effectiveChatId },
				message_id: Number(payload.messageId) || 0,
			},
		},
	};
}

/**
 * Build the Telegram update for a relayed text message.
 *
 * Returns null when the payload carries no text - there is nothing to
 * forward and the adapter must not see an empty message.
 */
export function buildTelegramMessageUpdate(
	payload: TelegramMessagePayload,
): TelegramMessageUpdate | null {
	const text = payload.text ?? "";
	if (!text) return null;

	const userId = Number(payload.userId);
	if (!Number.isFinite(userId)) return null;

	// A direct message has the chat id of the user; the remote always sends
	// the real chat id, so the fallback is only for a DM.
	const chatId = Number(payload.chatId);
	const effectiveChatId = Number.isFinite(chatId) ? chatId : userId;

	return {
		message: {
			message_id: Number(payload.messageId) || 0,
			from: {
				id: userId,
				// The real flag: the adapter refuses bot messages.
				is_bot: payload.isBot === true,
				first_name: payload.username || "User",
				username: payload.username,
			},
			chat: { id: effectiveChatId },
			text,
		},
	};
}
