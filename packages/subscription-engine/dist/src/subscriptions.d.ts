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
export declare class SubscriptionRegistry {
    private subs;
    register(topic: string, subscriberId: string, predicate?: (data: unknown) => boolean, priority?: number): string;
    unregister(id: string): void;
    unregisterAll(agentId?: string): void;
    find(topic: string, data: unknown): Sub[];
}
//# sourceMappingURL=subscriptions.d.ts.map