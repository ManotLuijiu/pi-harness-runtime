/**
 * Subscription Engine
 */

import type { Predicate, TopicSubscription, SubscriptionResult } from "./types.js";

export class SubscriptionEngine {
	private subs: Map<string, TopicSubscription> = new Map();

	subscribe<T>(
		agentId: string,
		topic: string,
		predicate?: Predicate<T>,
		priority = 0,
	): SubscriptionResult {
		const id = Math.random().toString(36).slice(2);
		const sub: TopicSubscription<T> = {
			id,
			topic,
			predicate: predicate as Predicate<T>,
			priority,
			subscriberId: agentId,
			active: true,
		};
		this.subs.set(id, sub as TopicSubscription);
		return { subscribed: true, subscriptionId: id };
	}

	unsubscribe(subscriptionId: string): void {
		this.subs.delete(subscriptionId);
	}

	unsubscribeAgent(agentId: string): void {
		for (const [id, sub] of this.subs) {
			if (sub.subscriberId === agentId) this.subs.delete(id);
		}
	}

	getSubscriptions(agentId?: string): TopicSubscription[] {
		if (agentId) return [...this.subs.values()].filter((s) => s.subscriberId === agentId);
		return [...this.subs.values()];
	}

	match<T>(topic: string, event: T): TopicSubscription<T>[] {
		return [...this.subs.values()]
			.filter((s) => s.topic === topic && s.active)
			.filter((s) => !s.predicate || (s.predicate as Predicate<T>)(event))
			.sort((a, b) => b.priority - a.priority) as TopicSubscription<T>[];
	}
}
