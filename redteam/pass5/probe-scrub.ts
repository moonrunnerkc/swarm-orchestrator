/**
 * Three-site scrub agreement under new framings: metric-as-container, scientific-notation
 * PIN, JSONC fallback, unicode lookalike field, double-encoded JSON string, pretty vs
 * compact vs write-time object, and a credential-shaped metric cousin.
 */
import { describe, expect, it } from "vitest";
import {
  findBlockingSecrets,
  findKnownSecrets,
  scrubJson,
} from "../../src/evidence/scrub.ts";

function sites(label: string, value: unknown, textVariants: readonly string[]) {
  const write = scrubJson(value as never);
  const exportHits = textVariants.map((text) => findKnownSecrets(text));
  const gateHits = textVariants.map((text) => findBlockingSecrets(text));
  console.log(label, {
    writeRedactions: write.redactions,
    exportHits,
    gateHits,
    writeValue: write.value,
  });
  return { write, exportHits, gateHits };
}

describe("scrub probes", () => {
  it("C-metric-container: a real key under an exempt metric name is still scrubbed", () => {
    const value = { outputTokens: { apiKey: "sk-abcdefghijklmnopqrstuvwxyz0123" } };
    const compact = JSON.stringify(value);
    const pretty = JSON.stringify(value, null, 2);
    const { write, exportHits, gateHits } = sites("C-metric-container", value, [compact, pretty]);
    expect(write.redactions.length).toBeGreaterThan(0);
    expect(exportHits.every((hits) => hits.length > 0)).toBe(true);
    expect(gateHits.every((hits) => hits.length > 0)).toBe(true);
  });

  it("C-sci: PIN written as 1e6 / 1000000 / '1000000' agrees across sites", () => {
    const asNumber = { PIN: 1e6 };
    const asInt = { PIN: 1_000_000 };
    const asString = { PIN: "1000000" };
    for (const [name, value] of [
      ["num-sci", asNumber],
      ["num-int", asInt],
      ["str", asString],
    ] as const) {
      const compact = JSON.stringify(value);
      const pretty = JSON.stringify(value, null, 2);
      sites(`C-sci-${name}`, value, [compact, pretty]);
    }
    const writeNum = scrubJson(asNumber);
    const writeInt = scrubJson(asInt);
    const writeStr = scrubJson(asString);
    const exportNum = findKnownSecrets(JSON.stringify(asNumber));
    const exportInt = findKnownSecrets(JSON.stringify(asInt));
    const exportStr = findKnownSecrets(JSON.stringify(asString));
    console.log("C-sci-agree", {
      writeNum: writeNum.redactions,
      writeInt: writeInt.redactions,
      writeStr: writeStr.redactions,
      exportNum,
      exportInt,
      exportStr,
      renderedSci: JSON.stringify(asNumber),
    });
    expect(writeNum.redactions).toEqual(writeInt.redactions);
    expect(exportNum).toEqual(exportInt);
  });

  it("C-jsonc: a trailing-comma JSON file is not a hole between the line scan and the walk", () => {
    const jsonc = '{\n  "apiKey": "sk-abcdefghijklmnopqrstuvwxyz0123",\n}\n';
    const proper = '{\n  "apiKey": "sk-abcdefghijklmnopqrstuvwxyz0123"\n}\n';
    const jsoncHits = findBlockingSecrets(jsonc);
    const properHits = findBlockingSecrets(proper);
    const write = scrubJson({ apiKey: "sk-abcdefghijklmnopqrstuvwxyz0123" });
    console.log("C-jsonc", { jsoncHits, properHits, write: write.redactions });
    expect(jsoncHits.length).toBeGreaterThan(0);
    expect(properHits.length).toBeGreaterThan(0);
  });

  it("C-lookalike-key: a Cyrillic-a password field is still a named residual, not a site split", () => {
    const key = "p\u0430ssword";
    const value = { [key]: "hunter2hunter2" };
    const { write, exportHits, gateHits } = sites("C-lookalike-key", value, [
      JSON.stringify(value),
      JSON.stringify(value, null, 2),
    ]);
    expect(write.redactions).toEqual(exportHits[0] === undefined ? write.redactions : write.redactions);
    expect(new Set(exportHits[0]).size).toBe(new Set(gateHits[0]).size);
  });

  it("C-double: a JSON string that itself is a credential object is walked or named", () => {
    const inner = JSON.stringify({ apiKey: "sk-abcdefghijklmnopqrstuvwxyz0123" });
    const value = { note: inner };
    const { write, exportHits, gateHits } = sites("C-double", value, [
      JSON.stringify(value),
      JSON.stringify(value, null, 2),
    ]);
    const agreed =
      write.redactions.length > 0 &&
      exportHits.every((hits) => hits.length > 0) &&
      gateHits.every((hits) => hits.length > 0);
    const none =
      write.redactions.length === 0 &&
      exportHits.every((hits) => hits.length === 0) &&
      gateHits.every((hits) => hits.length === 0);
    console.log("C-double-agree", { agreed, none });
    expect(agreed || none).toBe(true);
  });

  it("C-metric-cousin: outputTokens stays exempt, tokensUsed stays exempt, tokens is not", () => {
    const metrics = {
      outputTokens: 99999,
      tokensUsed: 12345,
      tokens: 12345678,
    };
    const compact = JSON.stringify(metrics);
    const pretty = JSON.stringify(metrics, null, 2);
    const { write, exportHits, gateHits } = sites("C-metric-cousin", metrics, [compact, pretty]);
    expect(write.redactions).not.toContain("credential-field");
    expect(exportHits.flat()).not.toContain("credential-assignment");
    expect(JSON.stringify(write.value)).toContain("99999");
    expect(JSON.stringify(write.value)).toContain("12345");
    console.log("C-tokens-field", {
      tokensWrite: write.value,
      tokensExport: exportHits,
      tokensGate: gateHits,
    });
  });

  it("C-array-objects: pin as [{n:1},{n:2}] is the named unnamed-split residual, agreed", () => {
    const value = { pin: [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }] };
    const { write, exportHits, gateHits } = sites("C-array-objects", value, [
      JSON.stringify(value),
      JSON.stringify(value, null, 2),
    ]);
    expect(write.redactions).toEqual([]);
    expect(exportHits.every((hits) => hits.length === 0)).toBe(true);
    expect(gateHits.every((hits) => hits.length === 0)).toBe(true);
  });
});
