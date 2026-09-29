import { describe, expect, it } from "vitest";
import { installedLauncher } from "./launcher.ts";

describe("the command an installed hook calls", () => {
  it("pins the npx invocation when this process runs from the npx cache, which npm may clear", () => {
    expect(
      installedLauncher({
        execPath: "/usr/local/bin/node",
        entry: "/home/a/.npm/_npx/5d3c1e/node_modules/swarm-verify/dist/swarm-verify.js",
        version: "1.1.1",
      }),
    ).toBe("npx --yes swarm-verify@1.1.1");
    expect(
      installedLauncher({
        execPath: "C:\\node\\node.exe",
        entry:
          "C:\\Users\\a\\AppData\\Local\\npm-cache\\_npx\\9f\\node_modules\\swarm-verify\\dist\\swarm-verify.js",
        version: "1.1.1",
      }),
    ).toBe("npx --yes swarm-verify@1.1.1");
  });

  it("calls a stable install directly, quoting what needs it", () => {
    expect(
      installedLauncher({
        execPath: "/usr/local/bin/node",
        entry: "/repo/node_modules/swarm-verify/dist/swarm-verify.js",
        version: "1.1.1",
      }),
    ).toBe("/usr/local/bin/node /repo/node_modules/swarm-verify/dist/swarm-verify.js");
    expect(
      installedLauncher({
        execPath: "/opt/my node/bin/node",
        entry: "/repo/_npx-like/swarm-verify.js",
        version: "1.1.1",
      }),
    ).toBe('"/opt/my node/bin/node" /repo/_npx-like/swarm-verify.js');
  });
});
