/**
 * A launch that starts from a retained candidate (starting-candidate-v1).
 *
 * The product runs unmodified from its ordinary command line. Its model endpoint is a proxy: the
 * first chat completions are answered by the repository's scripted endpoint as a worker that
 * declares the candidate's files, writes each one's exact bytes through the real chokepoint and
 * finishes; every chat completion after that goes to the pinned endpoint. So the gates, the
 * review, the repair loop and the final verification all run on the candidate as the product's
 * own first attempt, and both arms of a cell start from the same bytes.
 *
 * Only the first worker loop is scripted. The model never sees the candidate's provenance, the
 * hidden evaluator or a reference: what it reads is the workspace, as in any run.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { startScriptedEndpoint } from "../../src/providers/scripted-endpoint.ts";

export const startingCandidateRule = "starting-candidate-v1";

/**
 * The candidate's files after its patch is applied to the workspace, which is put back as it
 * was. A candidate that deletes or renames a file is refused: the scripted worker writes files,
 * and a deletion would need a shell command the replay does not make.
 */
export function candidateFiles(workspace, patchBytes, scratch) {
  const patchPath = join(scratch, "starting-candidate.patch");
  writeFileSync(patchPath, patchBytes);
  const names = spawnSync("git", ["apply", "--numstat", "--summary", patchPath], {
    cwd: workspace,
    encoding: "utf8",
  });
  if (names.status !== 0)
    throw new Error(`the candidate does not read as a patch: ${names.stderr}`);
  if (/\b(delete mode|rename)\b/.test(names.stdout))
    throw new Error("the candidate deletes or renames a file, which the replay cannot write");
  const paths = names.stdout
    .split("\n")
    .map((line) => /^\S+\t\S+\t(.+)$/.exec(line)?.[1])
    .filter((path) => path !== undefined);
  const applied = spawnSync("git", ["apply", "--whitespace=nowarn", patchPath], { cwd: workspace });
  if (applied.status !== 0)
    throw new Error(`the candidate does not apply to the base: ${applied.stderr}`);
  const files = Object.fromEntries(
    paths.map((path) => [path, readFileSync(join(workspace, path), "utf8")]),
  );
  const reverted = spawnSync("git", ["apply", "-R", "--whitespace=nowarn", patchPath], {
    cwd: workspace,
  });
  if (reverted.status !== 0)
    throw new Error(`the candidate could not be taken back out: ${reverted.stderr}`);
  rmSync(patchPath, { force: true });
  return files;
}

/** The scripted worker's turns: declare the files, write each, and finish. */
export function replayTurns(files) {
  return [
    { toolCalls: [{ name: "declare_file_set", input: { files: Object.keys(files) } }] },
    ...Object.entries(files).map(([path, content]) => ({
      toolCalls: [{ name: "write", input: { path, content } }],
    })),
    { text: "The change is in place." },
  ];
}

/**
 * The proxy the launch's endpoint points at. The first `turns.length` chat completions are the
 * replay; every other request (listings, later completions) goes to `upstream`, streamed back as
 * it arrives. `routed()` is the record of where each request went.
 */
export async function startCandidateProxy({ files, upstream, model }) {
  const turns = replayTurns(files);
  const scripted = await startScriptedEndpoint({ modelId: model, turns });
  const routed = [];
  let chats = 0;
  const server = createServer((request, response) => {
    const path = (request.url ?? "").split("?")[0];
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", async () => {
      const isChat = request.method === "POST" && /\/chat\/completions$/.test(path);
      if (isChat) chats += 1;
      const replayed = isChat && chats <= turns.length;
      const target = replayed ? scripted.url : upstream;
      const entry = { chat: isChat ? chats : null, path, route: replayed ? "replay" : "upstream" };
      routed.push(entry);
      const abort = new AbortController();
      response.on("close", () => {
        if (!response.writableFinished) abort.abort();
      });
      try {
        const forwarded = await fetch(`${target.replace(/\/$/, "")}${path.replace(/^\/v1/, "")}`, {
          method: request.method,
          headers: { "content-type": request.headers["content-type"] ?? "application/json" },
          body: request.method === "POST" ? Buffer.concat(chunks) : undefined,
          signal: abort.signal,
        });
        entry.status = forwarded.status;
        response.writeHead(forwarded.status, {
          "content-type": forwarded.headers.get("content-type") ?? "application/json",
          "cache-control": "no-cache",
        });
        if (forwarded.body) for await (const chunk of forwarded.body) response.write(chunk);
        response.end();
      } catch (error) {
        entry.error = String(error?.message ?? error);
        if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: entry.error } }));
      }
    });
  });
  await new Promise((ready) => server.listen(0, "127.0.0.1", ready));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    replayTurns: turns.length,
    routed: () => routed.map((one) => ({ ...one })),
    close: async () => {
      await new Promise((done) => server.close(() => done()));
      await scripted.close();
    },
  };
}
