import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { platformBlockBytes, probedTools, renderPlatform, toolFlavor } from "./platform-facts.ts";
import { parseProbe } from "./platform-probe.ts";

/** The probe's output as recorded on 2026-11-03: this Mac, and swarm-verify's node:24 image. */
const recorded = (name: string) =>
  parseProbe(readFileSync(join(import.meta.dirname, "fixtures", "platform", name), "utf8"));
const darwin = recorded("darwin-probe.txt");
const linux = recorded("linux-node24-probe.txt");

const block = (facts: Record<string, string>, layout: readonly string[] = ["src/"]) =>
  renderPlatform({ probe: { facts, layout, cut: false }, root: "/work/repo", checks: "isolated" });

describe("tool flavors read from the probe", () => {
  it("reads BSD for every probed tool on macOS 26.6.2", () => {
    expect(probedTools.map((tool) => [tool, toolFlavor(tool, darwin).flavor])).toEqual([
      ["sed", "BSD"],
      ["grep", "BSD"],
      ["find", "BSD"],
      ["awk", "BSD"],
      ["xargs", "BSD"],
    ]);
  });

  it("reads GNU in the node:24 container, whose awk is mawk", () => {
    expect(probedTools.map((tool) => [tool, toolFlavor(tool, linux).flavor])).toEqual([
      ["sed", "GNU"],
      ["grep", "GNU"],
      ["find", "GNU"],
      ["awk", "mawk"],
      ["xargs", "GNU"],
    ]);
  });

  it("decides a tool that prints no version only by a behavior the probe saw", () => {
    const silent = {
      "tool.sed.path": "/usr/bin/sed",
      "tool.sed.version": "sed: illegal option -- -",
    };
    expect(toolFlavor("sed", silent).flavor).toBe("unidentified");
    expect(toolFlavor("sed", { ...silent, "sed.inplace": "suffix" })).toMatchObject({
      flavor: "BSD",
      byBehavior: true,
    });
    expect(toolFlavor("sed", { ...silent, "sed.inplace": "bare" }).flavor).toBe("unidentified");
  });

  it("names BusyBox, and a tool missing from PATH", () => {
    const busybox = { "tool.grep.path": "/bin/grep", "tool.grep.version": "BusyBox v1.36.1" };
    expect(toolFlavor("grep", busybox).flavor).toBe("BusyBox");
    expect(toolFlavor("find", { "tool.find.path": "" }).flavor).toBe("missing");
  });
});

describe("the platform block", () => {
  it("tells the model how sed -i behaves here, on macOS", () => {
    const text = block(darwin);
    expect(text).toContain("- System: macOS 26.6.2 (Darwin 25.6.0 arm64). /bin/sh is bash 3.2.57.");
    expect(text).toContain(
      "- sed: BSD; sed -i needs a suffix argument here: sed -i '' 's/a/b/' file.",
    );
    expect(text).toContain("- grep: BSD (grep (BSD grep, GNU compatible) 2.6.0-FreeBSD); no -P.");
    expect(text).toContain("- On PATH but failing to start: java.");
    expect(text).toContain("Change a file's text with an edit or write block");
  });

  it("says GNU and no sed note in the container", () => {
    const text = block(linux);
    expect(text).toContain("- System: Debian GNU/Linux 12 (bookworm)");
    expect(text).toContain("/bin/sh is dash.");
    expect(text).toContain("- sed: GNU (sed (GNU sed) 4.9).");
    expect(text).not.toContain("sed -i needs");
    expect(text).toContain("- Container runtimes on PATH: none.");
  });

  it("stays within its byte bound however large the repository root is", () => {
    const layout = Array.from({ length: 5_000 }, (_, at) => `${"d".repeat(120)}-${at}/`);
    const text = block(darwin, layout);
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(platformBlockBytes);
    expect(text).toMatch(/\(and \d+ more\)\./);
  });

  it("is the same text for the same probe, so its digest names it", () => {
    expect(block(darwin)).toBe(block(darwin));
  });
});
