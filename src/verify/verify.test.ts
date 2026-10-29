import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bundleOf, envelopeOf, envelopeVerifies, pae, signStatement } from "./dsse.ts";
import { globPattern } from "./held-out.ts";
import { mutateLine } from "./mutation.ts";
import { categoryOf, checkProtectedPaths } from "./protected-paths.ts";
import { keyFromText } from "./signing.ts";

describe("protected paths", () => {
  it.each([
    ["test/clamp.test.mjs", "tests"],
    ["src/clamp.spec.ts", "tests"],
    ["pkg/tests/helpers.py", "tests"],
    ["test_clamp.py", "tests"],
    ["conftest.py", "tests"],
    ["vitest.config.ts", "tests"],
    [".github/workflows/ci.yml", "ci"],
    ["package-lock.json", "lockfiles"],
    ["uv.lock", "lockfiles"],
    ["package.json", "manifests"],
    ["swarm.toml", "config"],
    [".swarm/verify/change.patch", "config"],
    // Startup hooks decide what loads before the judge of a held-out check.
    [".npmrc", "config"],
    ["sitecustomize.py", "config"],
    ["lib/site-packages/hook.pth", "config"],
  ])("puts %s in %s", (path, category) => {
    expect(categoryOf(path)).toBe(category);
  });

  it("treats ordinary source as source", () => {
    expect(categoryOf("src/clamp.mjs")).toBeNull();
    expect(categoryOf("lib/testing-utils-free.js")).toBeNull();
  });

  it("lets protected paths change on their own", () => {
    expect(checkProtectedPaths(["test/a.test.js"], []).violations).toEqual([]);
  });

  it("refuses them changed together with source unless the category is allowed", () => {
    const paths = ["src/a.js", "test/a.test.js", "package-lock.json"];
    expect(checkProtectedPaths(paths, []).violations.map((v) => v.path)).toEqual([
      "test/a.test.js",
      "package-lock.json",
    ]);
    expect(checkProtectedPaths(paths, ["tests"]).violations.map((v) => v.path)).toEqual([
      "package-lock.json",
    ]);
  });
});

describe("one mutant per line", () => {
  it("flips the first comparison it finds", () => {
    expect(mutateLine("  if (a === b) return 1;")).toEqual({
      text: "  if (a !== b) return 1;",
      operator: "=== to !==",
    });
  });

  it("leaves operators inside strings and comments alone", () => {
    expect(mutateLine('  const label = "a && b"; // x || y')).toBeNull();
  });

  it("swaps min and max, and bumps a literal", () => {
    expect(mutateLine("  return Math.min(high, value);")?.text).toBe(
      "  return Math.max(high, value);",
    );
    expect(mutateLine("  const size = 8;")?.text).toBe("  const size = 9;");
  });

  it("drops a returned value as a last resort, in the file's language", () => {
    expect(mutateLine("  return value")?.text).toBe("  return undefined;");
    expect(mutateLine("    return value", true)?.text).toBe("    return None");
  });

  it("does not mutate imports or lines without an operator", () => {
    expect(mutateLine('import { a } from "./a.js";')).toBeNull();
    expect(mutateLine("  doThing(value);")).toBeNull();
  });
});

const pem = generateKeyPairSync("ed25519")
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const key = keyFromText(pem, "environment");
const statement = { _type: "https://in-toto.io/Statement/v1", subject: [], predicate: {} };

describe("DSSE envelopes", () => {
  it("encodes the pre-authentication string as the specification spells it", () => {
    expect(pae("t", Buffer.from("ab")).toString()).toBe("DSSEv1 1 t 2 ab");
  });

  it("verifies a signed statement against the signer's public key", () => {
    const envelope = signStatement(statement, key);
    expect(envelopeVerifies(envelope, key.publicKeyPem)).toBe(true);
    expect(JSON.parse(Buffer.from(envelope.payload, "base64").toString())).toEqual(statement);
  });

  it("refuses the envelope after one byte of its payload changes", () => {
    const envelope = signStatement(statement, key);
    const bytes = Buffer.from(envelope.payload, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    expect(
      envelopeVerifies({ ...envelope, payload: bytes.toString("base64") }, key.publicKeyPem),
    ).toBe(false);
  });

  it("refuses it under another key", () => {
    const other = keyFromText(
      generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      "environment",
    );
    expect(envelopeVerifies(signStatement(statement, key), other.publicKeyPem)).toBe(false);
  });

  it("reads the envelope out of a bundle or on its own", () => {
    const envelope = signStatement(statement, key);
    expect(envelopeOf(bundleOf(envelope, key))).toEqual(envelope);
    expect(envelopeOf(envelope)).toEqual(envelope);
    expect(envelopeOf({ payload: "x" })).toBeNull();
  });
});

describe("sealing globs", () => {
  it("lets ** cross directories and * stay inside one", () => {
    expect(globPattern("tests/hidden/**").test("tests/hidden/a/b.py")).toBe(true);
    expect(globPattern("**/*.hidden.js").test("a/b/c.hidden.js")).toBe(true);
    expect(globPattern("**/*.hidden.js").test("c.hidden.js")).toBe(true);
    expect(globPattern("tests/*.py").test("tests/a/b.py")).toBe(false);
  });

  it("matches dots literally", () => {
    expect(globPattern("a.py").test("abpy")).toBe(false);
  });
});
