import { describe, expect, it } from "vitest";
import { drainRenderTimings } from "./render-timings.ts";

describe("draining what a render leaves behind", () => {
  it("clears the user-timing entries a render wrote", () => {
    performance.clearMeasures();
    for (let entry = 0; entry < 6; entry += 1) {
      performance.measure("render", { start: 0, end: 1 });
    }
    expect(performance.getEntriesByType("measure")).toHaveLength(6);

    drainRenderTimings();

    expect(performance.getEntriesByType("measure")).toHaveLength(0);
  });

  it("holds the buffer flat across more frames than a long run draws", () => {
    // The property that matters is not that one call empties the buffer once, it is that
    // draining every frame keeps the buffer off the bound Node warns at. A run that redraws
    // eight times a second for twelve hours draws about 375,000 frames; this walks enough of
    // them to show the high-water mark is one frame rather than the sum of them.
    performance.clearMeasures();
    let highWaterMark = 0;

    for (let frame = 0; frame < 5_000; frame += 1) {
      drainRenderTimings();
      for (let entry = 0; entry < 6; entry += 1) {
        performance.measure("render", { start: 0, end: 1 });
      }
      highWaterMark = Math.max(highWaterMark, performance.getEntriesByType("measure").length);
    }
    drainRenderTimings();

    expect(highWaterMark).toBe(6);
  });
});
