/**
 * Subscription Engine — Subscriptions (self-contained)
 */

export interface Sub {
	id: string;
	topic: string;
	predicate?: (data: unknown) => boolean;
	priority: number;
	subscriberId: string;
	active: boolean;
}

export class SubscriptionRegistry {
	private subs: Map<string, Sub> = new Map();

	register(
		topic: string,
		subscriberId: string,
		predicate?: (data: unknown) => boolean,
		priority = 0,
	): string {
		const id = Math.random().toString(36).slice(2);
		this.subs.set(id, {
			id,
			topic,
			predicate,
			priority,
			subscriberId,
			active: true,
		});
		return id;
	}

	unregister(id: string): void {
		this.subs.delete(id);
	}

	unregisterAll(agentId?: string): void {
		if (agentId) {
			for (const [id, s] of this.subs) {
				if (s.subscriberId === agentId) this.subs.delete(id);
			}
		} else {
			this.subs.clear();
		}
	}

	find(topic: string, data: unknown): Sub[] {
		return [...this.subs.values()]
			.filter((s) => s.topic === topic && s.active)
			.filter((s) => !s.predicate || s.predicate(data))
			.sort((a, b) => b.priority - a.priority);
	}
}
