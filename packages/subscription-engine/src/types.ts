/**
 * Subscription Engine — Types
 */

export type Predicate<T> = (event: T) => boolean;

export interface TopicSubscription<T = unknown> {
	id: string;
	topic: string;
	predicate: Predicate<T>;
	priority: number;
	subscriberId: string;
	active: boolean;
}

export interface SubscriptionResult {
	subscribed: boolean;
	subscriptionId?: string;
	error?: string;
}

export interface SubscriberInfo {
	id: string;
	agentId: string;
	topics: string[];
	createdAt: string;
}
