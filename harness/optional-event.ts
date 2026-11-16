/**
 * The registration of an event that the compiled API does not declare.
 *
 * The harness compiles against the declarations of one version of the
 * extension API of Pi, and it runs in the core that the user installed.
 * A core that is newer knows events that the declarations do not name
 * yet.
 *
 * The core dispatches the events by name: the handler of an event that
 * the core does not know is never called, and nothing breaks. The helper
 * therefore registers the handler under its name, and the shape of the
 * event is described by the caller instead of being borrowed from a
 * declaration that does not exist yet.
 *
 * The cast lives in this helper and nowhere else: the caller stays typed
 * by the shape of the event it reads.
 */
export function onOptionalEvent<TEvent>(
	api: unknown,
	eventName: string,
	handler: (event: TEvent) => void,
): void {
	const register = api as {
		on(event: string, handler: (event: TEvent) => void): void;
	};
	register.on(eventName, handler);
}
