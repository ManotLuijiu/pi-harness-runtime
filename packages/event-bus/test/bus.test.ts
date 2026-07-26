import { describe, it } from "node:test";
import { equal, deepEqual } from "node:assert";
import { EventBus } from "../src/bus.js";

describe("EventBus", () => {
	const bus = new EventBus();

	it("publish returns eventId", () => {
		const id = bus.publish("test.topic", { msg: "hello" });
		equal(typeof id, "string");
		equal(id.length > 0, true);
	});

	it("subscriber receives event", () => {
		let received: unknown = null;
		bus.subscribe("test.1", (p) => { received = p; });
		bus.publish("test.1", { data: "hello" });
		equal((received as { data: string }).data, "hello");
	});

	it("multiple subscribers all called", () => {
		const calls: number[] = [];
		bus.subscribe("test.2", () => { calls.push(1); });
		bus.subscribe("test.2", () => { calls.push(2); });
		bus.publish("test.2", { x: 1 });
		deepEqual(calls, [1, 2]);
	});

	it("unsubscribe stops notifications", () => {
		let called = false;
		const id = bus.subscribe("test.3", () => { called = true; });
		bus.unsubscribe(id);
		bus.publish("test.3", {});
		equal(called, false);
	});

	it("filter predicates work", () => {
		let called = false;
		bus.subscribe("test.4", () => { called = true; }, (d) => (d as { ok: boolean }).ok === true);
		bus.publish("test.4", { ok: false });
		equal(called, false);
		bus.publish("test.4", { ok: true });
		equal(called, true);
	});

	it("priority ordering respected", () => {
		const order: number[] = [];
		bus.subscribe("test.5", () => { order.push(1); }, undefined, 1);
		bus.subscribe("test.5", () => { order.push(2); }, undefined, 2);
		bus.publish("test.5", {});
		deepEqual(order, [2, 1]); // higher priority first
	});

	it("unsubscribeAll(topic) removes all for topic", () => {
		bus.subscribe("test.6", () => {});
		bus.subscribe("test.6", () => {});
		bus.unsubscribeAll("test.6");
		equal(bus.getSubscribers("test.6").length, 0);
	});
});
