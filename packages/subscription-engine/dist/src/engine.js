/**
 * Subscription Engine
 */
export class SubscriptionEngine {
    subs = new Map();
    subscribe(agentId, topic, predicate, priority = 0) {
        const id = Math.random().toString(36).slice(2);
        const sub = {
            id,
            topic,
            predicate: predicate,
            priority,
            subscriberId: agentId,
            active: true,
        };
        this.subs.set(id, sub);
        return { subscribed: true, subscriptionId: id };
    }
    unsubscribe(subscriptionId) {
        this.subs.delete(subscriptionId);
    }
    unsubscribeAgent(agentId) {
        for (const [id, sub] of this.subs) {
            if (sub.subscriberId === agentId)
                this.subs.delete(id);
        }
    }
    getSubscriptions(agentId) {
        if (agentId)
            return [...this.subs.values()].filter((s) => s.subscriberId === agentId);
        return [...this.subs.values()];
    }
    match(topic, event) {
        return [...this.subs.values()]
            .filter((s) => s.topic === topic && s.active)
            .filter((s) => !s.predicate || s.predicate(event))
            .sort((a, b) => b.priority - a.priority);
    }
}
//# sourceMappingURL=engine.js.map