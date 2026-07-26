/**
 * Event Bus — pub/sub implementation
 */

import { randomUUID } from "node:crypto";
import type { Subscriber, Subscription, EventPayload } from "./types.js";

export class EventBus {
	private readonly subs: Map<string, Subscription> = new Map();
	private readonly byTopic: Map<string, Set<string>> = new Map();

	publish<T>(topic: string, data: T, source = "system"): string {
		const eventId = randomUUID();
		const timestamp = new Date().toISOString();
		const payload: EventPayload<T> = { topic, data, timestamp, eventId, source };

		const topicIds = this.byTopic.get(topic) ?? new Set();
		const wildcardIds = this.byTopic.get("*") ?? new Set();

		const matches: Array<{ sub: Subscription; payload: EventPayload<unknown> }> = [];
		for (const sid of [...topicIds, ...wildcardIds]) {
			const sub = this.subs.get(sid);
			if (!sub || !sub.active) continue;
			if (sub.filter && !sub.filter(data)) continue;
			matches.push({ sub, payload });
		}

		matches.sort((a, b) => b.sub.priority - a.sub.priority);

		for (const { sub } of matches) {
			try {
				(sub.subscriber as Subscriber)(payload);
			} catch {
				sub.active = false;
				this.subs.delete(sub.id);
				this.byTopic.get(sub.topic)?.delete(sub.id);
			}
		}

		return eventId;
	}

	subscribe<T>(
		topic: string,
		subscriber: Subscriber<T>,
		filter?: (data: T) => boolean,
		priority = 0,
	): string {
		const id = randomUUID();
		const sub: Subscription = {
			id,
			topic,
			subscriber: subscriber as Subscriber<unknown>,
			filter: filter as (data: unknown) => boolean,
			priority,
			active: true,
		};
		this.subs.set(id, sub);
		if (!this.byTopic.has(topic)) this.byTopic.set(topic, new Set());
		this.byTopic.get(topic)!.add(id);
		return id;
	}

	unsubscribe(subscriptionId: string): void {
		const sub = this.subs.get(subscriptionId);
		if (!sub) return;
		sub.active = false;
		this.subs.delete(subscriptionId);
		this.byTopic.get(sub.topic)?.delete(subscriptionId);
	}

	unsubscribeAll(topic?: string): void {
		if (topic) {
			const ids = this.byTopic.get(topic);
			if (ids) {
				for (const id of ids) this.unsubscribe(id);
				this.byTopic.delete(topic);
			}
		} else {
			for (const id of this.subs.keys()) this.unsubscribe(id);
			this.byTopic.clear();
		}
	}

	replay(topic: string, events: EventPayload<unknown>[]): void {
		for (const event of events) {
			if (event.topic === topic || topic === "*") {
				this.publish(event.topic, event.data, event.source);
			}
		}
	}

	getSubscribers(topic?: string): Subscription[] {
		if (topic) {
			const ids = this.byTopic.get(topic) ?? new Set();
			return [...ids].map((id) => this.subs.get(id)!).filter((s): s is Subscription => s !== undefined);
		}
		return [...this.subs.values()].filter((s) => s.active);
	}
}
