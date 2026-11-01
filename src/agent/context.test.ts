import { describe, expect, it } from "vitest";
import { compacted } from "./context.ts";
import type { Message } from "./model.ts";

const turns = (count: number): Message[] => [
  { role: "system", content: "system" },
  ...Array.from(
    { length: count },
    (_, at): Message => ({ role: at % 2 === 0 ? "user" : "assistant", content: `turn ${at}` }),
  ),
];

describe("compacting old turns", () => {
  it("leaves the conversation alone below the threshold", () => {
    expect(compacted(turns(20), [], 1000, 32768)).toBeNull();
  });

  it("keeps the system prompt, the first turn and the latest turns, and states the facts between", () => {
    const facts = [
      { step: 1, command: "npm test", exitCode: 1, output: ".swarm/outputs/1.txt" },
      { step: 2, command: "cat src/a.ts", exitCode: 0, output: null },
    ];
    const result = compacted(turns(20), facts, 25_000, 32768) ?? [];
    expect(result[0]?.content).toBe("system");
    expect(result[1]?.content).toBe("turn 0");
    expect(result[2]?.content).toContain(
      "step 1: `npm test` exited 1; full output in .swarm/outputs/1.txt",
    );
    expect(result[2]?.content).toContain(
      "Commands that failed, worth not repeating as they were: `npm test`.",
    );
    expect(result.at(-1)?.content).toBe("turn 19");
    expect(result.length).toBeLessThan(21);
    // Roles still alternate after the compacted block.
    expect(result[4]?.role).toBe("user");
  });

  it("says which reads are being repeated and to read only the lines needed, not whole files again", () => {
    const facts = [
      { step: 1, command: "cat src/a.ts", exitCode: 0, output: null },
      { step: 2, command: "cat src/b.ts", exitCode: 0, output: null },
      { step: 3, command: "cat src/a.ts", exitCode: 0, output: null },
    ];
    const digest = compacted(turns(20), facts, 25_000, 32768)?.[2]?.content ?? "";
    expect(digest).toContain("Ran more than once: `cat src/a.ts` (2 times).");
    expect(digest).toContain("Read only the lines you need (grep -n, sed -n 'a,bp')");
    expect(digest).not.toContain("read files again");
  });
});
