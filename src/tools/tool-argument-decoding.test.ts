import { describe, expect, it } from "vitest";
import { z } from "zod";
import { decodeStringifiedToolArguments } from "./tool-argument-decoding.ts";

const declareFileSet = z.object({ files: z.array(z.string().min(1)).min(1) });

describe("decodeStringifiedToolArguments", () => {
  it("returns well-formed arguments untouched", () => {
    const input = { files: ["README.md"] };
    const decoded = decodeStringifiedToolArguments(input, declareFileSet);

    expect(decoded.input).toBe(input);
    expect(decoded.decodedFields).toEqual([]);
  });

  it("decodes an array the model encoded as a JSON string", () => {
    const decoded = decodeStringifiedToolArguments({ files: '["README.md"]' }, declareFileSet);

    expect(decoded.input).toEqual({ files: ["README.md"] });
    expect(decoded.decodedFields).toEqual(["files"]);
  });

  it("leaves the arguments that arrived unchanged", () => {
    const input = { files: '["README.md"]' };
    decodeStringifiedToolArguments(input, declareFileSet);

    expect(input).toEqual({ files: '["README.md"]' });
  });

  it("decodes an object the model encoded as a JSON string", () => {
    const schema = z.object({ options: z.object({ recursive: z.boolean() }) });
    const decoded = decodeStringifiedToolArguments(
      { options: '{"recursive":true}' },
      schema.strict(),
    );

    expect(decoded.input).toEqual({ options: { recursive: true } });
    expect(decoded.decodedFields).toEqual(["options"]);
  });

  it("decodes a nested field and names it by its path", () => {
    const schema = z.object({ query: z.object({ globs: z.array(z.string()) }) });
    const decoded = decodeStringifiedToolArguments({ query: { globs: '["*.ts"]' } }, schema);

    expect(decoded.input).toEqual({ query: { globs: ["*.ts"] } });
    expect(decoded.decodedFields).toEqual(["query.globs"]);
  });

  it("decodes the whole argument object when that is what arrived as a string", () => {
    const decoded = decodeStringifiedToolArguments('{"files":["README.md"]}', declareFileSet);

    expect(decoded.input).toEqual({ files: ["README.md"] });
    expect(decoded.decodedFields).toEqual(["(arguments)"]);
  });

  it("decodes a second encoding layer", () => {
    const schema = z.object({ query: z.object({ globs: z.array(z.string()) }) });
    const decoded = decodeStringifiedToolArguments({ query: '{"globs":"[\\"*.ts\\"]"}' }, schema);

    expect(decoded.input).toEqual({ query: { globs: ["*.ts"] } });
    expect(decoded.decodedFields).toEqual(["query", "query.globs"]);
  });

  it("never decodes a field the schema declares as a string", () => {
    const schema = z.object({ command: z.string() });
    const input = { command: '["rm","-rf","/"]' };
    const decoded = decodeStringifiedToolArguments(input, schema);

    expect(decoded.input).toBe(input);
    expect(decoded.decodedFields).toEqual([]);
  });

  it("leaves a string that is not JSON alone, so the call still fails validation", () => {
    const input = { files: "README.md" };
    const decoded = decodeStringifiedToolArguments(input, declareFileSet);

    expect(decoded.input).toBe(input);
    expect(decoded.decodedFields).toEqual([]);
  });

  it("leaves a string whose JSON is the wrong type alone", () => {
    const input = { files: '"README.md"' };
    const decoded = decodeStringifiedToolArguments(input, declareFileSet);

    expect(decoded.input).toBe(input);
    expect(decoded.decodedFields).toEqual([]);
  });

  it("reports nothing decoded when decoding does not make the call valid", () => {
    const input = { files: "[]" };
    const decoded = decodeStringifiedToolArguments(input, declareFileSet);

    expect(decoded.input).toBe(input);
    expect(decoded.decodedFields).toEqual([]);
  });

  it("decodes an array element that arrived as a JSON string", () => {
    const schema = z.object({ edits: z.array(z.object({ path: z.string() })) });
    const decoded = decodeStringifiedToolArguments({ edits: ['{"path":"a.ts"}'] }, schema);

    expect(decoded.input).toEqual({ edits: [{ path: "a.ts" }] });
    expect(decoded.decodedFields).toEqual(["edits.0"]);
  });
});
