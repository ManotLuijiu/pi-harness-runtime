/**
 * Event Bus — pub/sub implementation
 */
import { randomUUID } from "node:crypto";
export class EventBus {
    subs = new Map();
    byTopic = new Map();
    publish(topic, data, source = "system") {
        const eventId = randomUUID();
        const timestamp = new Date().toISOString();
        const payload = { topic, data, timestamp, eventId, source };
        const topicIds = this.byTopic.get(topic) ?? new Set();
        const wildcardIds = this.byTopic.get("*") ?? new Set();
        const matches = [];
        for (const sid of [...topicIds, ...wildcardIds]) {
            const sub = this.subs.get(sid);
            if (!sub || !sub.active)
                continue;
            if (sub.filter && !sub.filter(data))
                continue;
            matches.push({ sub, payload });
        }
        matches.sort((a, b) => b.sub.priority - a.sub.priority);
        for (const { sub } of matches) {
            try {
                sub.subscriber(payload);
            }
            catch {
                sub.active = false;
                this.subs.delete(sub.id);
                this.byTopic.get(sub.topic)?.delete(sub.id);
            }
        }
        return eventId;
    }
    subscribe(topic, subscriber, filter, priority = 0) {
        const id = randomUUID();
        const sub = {
            id,
            topic,
            subscriber: subscriber,
            filter: filter,
            priority,
            active: true,
        };
        this.subs.set(id, sub);
        if (!this.byTopic.has(topic))
            this.byTopic.set(topic, new Set());
        this.byTopic.get(topic).add(id);
        return id;
    }
    unsubscribe(subscriptionId) {
        const sub = this.subs.get(subscriptionId);
        if (!sub)
            return;
        sub.active = false;
        this.subs.delete(subscriptionId);
        this.byTopic.get(sub.topic)?.delete(subscriptionId);
    }
    unsubscribeAll(topic) {
        if (topic) {
            const ids = this.byTopic.get(topic);
            if (ids) {
                for (const id of ids)
                    this.unsubscribe(id);
                this.byTopic.delete(topic);
            }
        }
        else {
            for (const id of this.subs.keys())
                this.unsubscribe(id);
            this.byTopic.clear();
        }
    }
    replay(topic, events) {
        for (const event of events) {
            if (event.topic === topic || topic === "*") {
                this.publish(event.topic, event.data, event.source);
            }
        }
    }
    getSubscribers(topic) {
        if (topic) {
            const ids = this.byTopic.get(topic) ?? new Set();
            return [...ids].map((id) => this.subs.get(id)).filter((s) => s !== undefined);
        }
        return [...this.subs.values()].filter((s) => s.active);
    }
}
//# sourceMappingURL=bus.js.map