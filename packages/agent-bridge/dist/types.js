/**
 * The shapes of the reverse bridge.
 *
 * The bridge lets a worker of another vendor address a live Pi session.
 * Every message of the bridge names the instance it is for: the agent id,
 * the session id, the generation and the workspace. A message that names
 * an instance that is not live any more is refused: a session that ended
 * does not receive the message of its successor.
 */
export {};
//# sourceMappingURL=types.js.map