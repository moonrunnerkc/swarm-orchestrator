import { describe, expect, it } from "vitest";
import { frozenOrder, launches } from "./order.mjs";

describe("the frozen launch order", () => {
  it("is a deterministic permutation of the task ids", () => {
    const ids = ["marked-a", "fxp-b", "yaml-c", "yargs-d"];
    const once = frozenOrder(ids);
    expect(frozenOrder([...ids].reverse())).toEqual(once);
    expect([...once].sort()).toEqual([...ids].sort());
  });

  it("runs both arms of a task back to back and alternates which goes first", () => {
    const out = launches(["marked-a", "fxp-b", "yaml-c"]);
    expect(out).toHaveLength(6);
    for (let index = 0; index < out.length; index += 2) {
      expect(out[index].task).toBe(out[index + 1].task);
      expect(out[index].arm).not.toBe(out[index + 1].arm);
      expect(out[index].order).toBe(index);
    }
    expect(out[0].arm).toBe("swarm");
    expect(out[2].arm).toBe("opencode");
    expect(out[4].arm).toBe("swarm");
  });
});
