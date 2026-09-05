import { describe, expect, it } from "vitest";
import { parseCommandLine } from "./cli-options.ts";

const context = { currentDirectory: "/repo", environment: {} };

describe("swarm verify", () => {
  it("takes a bundle directory", () => {
    const parsed = parseCommandLine(["verify", "./out"], context);

    expect(parsed).toMatchObject({ command: "verify", bundleDirectory: "/repo/out" });
  });

  it("takes the signers a reader expects, from outside the bundle", () => {
    const fingerprint = `sha256:${"ab".repeat(32)}`;
    const parsed = parseCommandLine(["verify", "./out", "--signer", fingerprint], context);

    expect(parsed).toMatchObject({ command: "verify", expectedSigners: [fingerprint] });
  });

  it("takes more than one, because a team has more than one machine", () => {
    const first = `sha256:${"ab".repeat(32)}`;
    const second = `sha256:${"cd".repeat(32)}`;
    const parsed = parseCommandLine(["verify", "./out", "--signer", `${first},${second}`], context);

    expect(parsed).toMatchObject({ expectedSigners: [first, second] });
  });

  it("refuses a bundle directory it was not given", () => {
    expect(() => parseCommandLine(["verify"], context)).toThrow(/bundle directory/);
  });
});
