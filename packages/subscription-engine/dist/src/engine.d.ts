/**
 * Subscription Engine
 */
import type { Predicate, TopicSubscription, SubscriptionResult } from "./types.js";
export declare class SubscriptionEngine {
    private subs;
    subscribe<T>(agentId: string, topic: string, predicate?: Predicate<T>, priority?: number): SubscriptionResult;
    unsubscribe(subscriptionId: string): void;
    unsubscribeAgent(agentId: string): void;
    getSubscriptions(agentId?: string): TopicSubscription[];
    match<T>(topic: string, event: T): TopicSubscription<T>[];
}
//# sourceMappingURL=engine.d.ts.map