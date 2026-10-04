/**
 * Event Bus — pub/sub implementation
 */
import type { Subscriber, Subscription, EventPayload } from "./types.js";
export declare class EventBus {
    private readonly subs;
    private readonly byTopic;
    publish<T>(topic: string, data: T, source?: string): string;
    subscribe<T>(topic: string, subscriber: Subscriber<T>, filter?: (data: T) => boolean, priority?: number): string;
    unsubscribe(subscriptionId: string): void;
    unsubscribeAll(topic?: string): void;
    replay(topic: string, events: EventPayload<unknown>[]): void;
    getSubscribers(topic?: string): Subscription[];
}
//# sourceMappingURL=bus.d.ts.map