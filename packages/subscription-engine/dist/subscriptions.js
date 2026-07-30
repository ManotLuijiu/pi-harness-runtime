/**
 * Subscription Engine — Subscriptions (self-contained)
 */
export class SubscriptionRegistry {
    subs = new Map();
    register(topic, subscriberId, predicate, priority = 0) {
        const id = Math.random().toString(36).slice(2);
        this.subs.set(id, { id, topic, predicate, priority, subscriberId, active: true });
        return id;
    }
    unregister(id) {
        this.subs.delete(id);
    }
    unregisterAll(agentId) {
        if (agentId) {
            for (const [id, s] of this.subs) {
                if (s.subscriberId === agentId)
                    this.subs.delete(id);
            }
        }
        else {
            this.subs.clear();
        }
    }
    find(topic, data) {
        return [...this.subs.values()]
            .filter((s) => s.topic === topic && s.active)
            .filter((s) => !s.predicate || s.predicate(data))
            .sort((a, b) => b.priority - a.priority);
    }
}
//# sourceMappingURL=subscriptions.js.map