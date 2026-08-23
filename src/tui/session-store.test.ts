import { describe, expect, it } from "vitest";
import type { LoopEvent } from "../core/loop-events.ts";
import { createSessionStore } from "./session-store.ts";

const planned: LoopEvent = { type: "plan", text: "read, then edit" };

describe("the session store", () => {
  it("starts empty and applies events into the projection", () => {
    const store = createSessionStore();
    expect(store.getView().plan).toBe("");

    store.apply(planned);
    expect(store.getView().plan).toBe("read, then edit");
  });

  it("tells every subscriber, with the view as it now stands", () => {
    const store = createSessionStore();
    const seen: string[] = [];
    const alsoSeen: string[] = [];
    store.subscribe((view) => seen.push(view.status));
    store.subscribe((view) => alsoSeen.push(view.status));

    store.apply(planned);
    store.apply({ type: "model-call", step: 1, modelId: "fixture:a" });

    expect(seen).toEqual(["planning", "thinking (step 1)"]);
    expect(alsoSeen).toEqual(seen);
  });

  it("stops telling a subscriber that has unsubscribed", () => {
    const store = createSessionStore();
    const seen: string[] = [];
    const stop = store.subscribe((view) => seen.push(view.status));

    store.apply(planned);
    stop();
    store.apply({ type: "model-call", step: 1, modelId: "fixture:a" });

    expect(seen).toEqual(["planning"]);
    expect(store.getView().status).toBe("thinking (step 1)");
  });

  it("replaces the view rather than mutating it, so a held reference stays what it was", () => {
    const store = createSessionStore();
    const before = store.getView();
    store.apply(planned);

    expect(before.plan).toBe("");
    expect(store.getView()).not.toBe(before);
  });
});
