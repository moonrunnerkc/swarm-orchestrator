import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultPickPath, readCalibrationPick, writeCalibrationPick } from "./pick-store.ts";

let directory = "";
let path = "";

const pick = {
  model: "local:qwen2.5-coder:14b",
  candidates: ["local:qwen2.5-coder:14b", "local:qwen2.5-coder:7b"],
  goldenSetVersion: `sha256:${"ab".repeat(32)}`,
  recordedAt: 1_700_000_000_000,
};

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "swarm-pick-"));
  path = join(directory, "calibration-pick.json");
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("the calibration pick store", () => {
  it("reads nothing before anything has been calibrated", async () => {
    expect(await readCalibrationPick(path)).toBeNull();
  });

  it("keeps what calibration decided, and which models it was deciding between", async () => {
    await writeCalibrationPick(path, pick);

    expect(await readCalibrationPick(path)).toEqual(pick);
  });

  it("replaces the previous pick, because only the latest measurement routes", async () => {
    await writeCalibrationPick(path, pick);

    await writeCalibrationPick(path, { ...pick, model: "local:qwen2.5-coder:7b" });

    expect((await readCalibrationPick(path))?.model).toBe("local:qwen2.5-coder:7b");
  });

  it("reads a damaged file as nothing, so a bad file costs routing rather than the run", async () => {
    await writeFile(path, "{not json}", "utf8");

    expect(await readCalibrationPick(path)).toBeNull();
  });

  it("sits beside the routing log it feeds", () => {
    expect(defaultPickPath("/home/dev")).toBe("/home/dev/.swarm/routing/calibration-pick.json");
  });
});
