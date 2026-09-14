import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { conciseWorkerPrompt, legacyWorkerPrompt } from "../../src/agent-prompt.ts";
import { runAgentTask } from "../../src/agent-run.ts";
import { createSystemClock } from "../../src/cli-runtime-inputs.ts";
import { asJsonValue, digestOfBytes } from "../../src/evidence/canonical-json.ts";
import { declareGoalContract } from "../../src/evidence/goal-contract.ts";
import { createRecordingModelClient } from "../../src/evidence/model-call-recording.ts";
import { openEvidenceSession } from "../../src/evidence/session.ts";
import { harnessChildEnvironment } from "../../src/exec/child-environment.ts";
import { createFileSetRegistry } from "../../src/gates/file-set.ts";
import { verifyIndependently } from "../../src/gates/independent-verification.ts";
import { createNodeCommandRunner } from "../../src/gates/node-command-runner.ts";
import { createProviderRegistry } from "../../src/providers/registry.ts";
import { createRunContext } from "../../src/workers/run-context.ts";

const cases = [
  {
    id: "cursor-pagination",
    task: "Add cursor pagination across store.js, api.js and sdk.js, preserving existing all, add and list methods. createStore returns page({limit=2,cursor=null}={}). Return {items,nextCursor}, in insertion order; nextCursor is the last returned id only if more remain, otherwise null. Continue strictly after a known cursor id. Empty store returns an empty page. Require integer limit 1..3 and null or a known string cursor; invalid input throws TypeError. api.listPage(store,options) returns status 200 and page body, or status 400 with {error:'invalid pagination'} for TypeError. client(store).listPage(options) returns the page or throws TypeError for status 400. Add maintained tests. Use only the standard library.",
    files: {
      "store.js":
        "export function createStore(seed=[]) { const items=[...seed]; return {all:()=>[...items],add:item=>items.push(item)}; }\n",
      "api.js": "export function list(store) { return {status:200,body:store.all()}; }\n",
      "sdk.js":
        "import {list} from './api.js'; export function client(store) { return {list:()=>list(store).body}; }\n",
      "base.test.js":
        "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {createStore} from './store.js'; import {client} from './sdk.js'; test('list',()=>{const s=createStore([{id:'a'}]);s.add({id:'b'});assert.deepEqual(client(s).list(),[{id:'a'},{id:'b'}]);});\n",
    },
    check:
      "import assert from 'node:assert/strict'; import {createStore} from '../store.js'; import {listPage} from '../api.js'; import {client} from '../sdk.js'; const s=createStore([{id:'a'},{id:'b'},{id:'c'}]); assert.deepEqual(s.page(),{items:[{id:'a'},{id:'b'}],nextCursor:'b'}); assert.deepEqual(client(s).listPage({cursor:'b'}),{items:[{id:'c'}],nextCursor:null}); assert.deepEqual(createStore().page(),{items:[],nextCursor:null}); for(const input of [{limit:0},{limit:4},{limit:1.5},{cursor:'missing'},{cursor:42}]) {assert.throws(()=>s.page(input),TypeError);assert.deepEqual(listPage(s,input),{status:400,body:{error:'invalid pagination'}});assert.throws(()=>client(s).listPage(input),TypeError);} s.add({id:'d'}); assert.deepEqual(client(s).listPage({limit:1,cursor:'c'}),{items:[{id:'d'}],nextCursor:null});\n",
  },
  {
    id: "cache-invalidation",
    task: "Fix stale cached reads after writes and deletion. repository.js createRepository must expose get(key), put(key,value), remove(key), using the supplied store and cache. Reads cache any value, including undefined and null. put updates the store and invalidates only that key; remove deletes from store and invalidates only that key. Preserve unrelated cached entries and existing APIs. Add maintained tests for write/read, deletion, null, undefined, and unrelated cached keys. Standard library only.",
    files: {
      "store.js":
        "export function createStore() { const entries=new Map(); return {get:key=>entries.get(key), put:(key,value)=>entries.set(key,value), remove:key=>entries.delete(key)}; }\n",
      "cache.js":
        "export function createCache() { const entries=new Map(); return {has:key=>entries.has(key),get:key=>entries.get(key),put:(key,value)=>entries.set(key,value),remove:key=>entries.delete(key)}; }\n",
      "repository.js":
        "export function createRepository(store,cache) { return {get(key) { if(cache.has(key)) return cache.get(key); const value=store.get(key); cache.put(key,value); return value; }, put(key,value) { store.put(key,value); }, remove(key) { store.remove(key); }}; }\n",
      "base.test.js":
        "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {createStore} from './store.js'; import {createCache} from './cache.js'; import {createRepository} from './repository.js'; test('read',()=>{const s=createStore();s.put('x',1);assert.equal(createRepository(s,createCache()).get('x'),1);});\n",
    },
    check:
      "import assert from 'node:assert/strict'; import {createStore} from '../store.js'; import {createCache} from '../cache.js'; import {createRepository} from '../repository.js'; const s=createStore(), c=createCache(), r=createRepository(s,c); let reads=0; const get=s.get; s.get=k=>{reads++;return get(k);}; r.get('x');r.get('x');assert.equal(reads,1);r.put('x',null);assert.equal(r.get('x'),null);r.put('x',3);assert.equal(r.get('x'),3);r.put('y',4);r.get('y');const before=reads;r.remove('x');assert.equal(r.get('y'),4);assert.equal(reads,before);assert.equal(r.get('x'),undefined);r.get('x');assert.equal(reads,before+1);\n",
  },
  {
    id: "interface-result",
    task: "Change lookup across service.js and client.js to explicit success/failure results. service.lookup(store,id) returns {ok:true,value:record} for existing ids, including false or null values; missing ids return {ok:false,error:'not-found'}. Existing store.get/store.has stay supported. client(store).get(id) returns the value on success and throws a RangeError('not-found') on failure. Add maintained tests including null, false, missing keys, and the client/service interaction. Standard library only.",
    files: {
      "store.js": "export function createStore(entries=[]) { return new Map(entries); }\n",
      "service.js": "export function lookup(store,id) { return store.get(id); }\n",
      "client.js":
        "import {lookup} from './service.js'; export function client(store) { return {get:id=>lookup(store,id)}; }\n",
      "base.test.js":
        "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {createStore} from './store.js'; import {client} from './client.js'; test('existing',()=>assert.equal(client(createStore([['x',1]])).get('x'),1));\n",
    },
    check:
      "import assert from 'node:assert/strict'; import {createStore} from '../store.js'; import {lookup} from '../service.js'; import {client} from '../client.js'; const s=createStore([['x',1],['n',null],['f',false]]);for(const [id,value] of s) {assert.deepEqual(lookup(s,id),{ok:true,value});assert.equal(client(s).get(id),value);}assert.deepEqual(lookup(s,'missing'),{ok:false,error:'not-found'});assert.throws(()=>client(s).get('missing'),{name:'RangeError',message:'not-found'});\n",
  },
];

const root = resolve(process.argv[2] ?? "");
const modelId = process.argv[3] ?? "swarm-redesign-qwen36-32k:latest";
if (process.argv[2] === undefined || !root.startsWith("/") || /cloud/i.test(modelId))
  throw new Error(
    "Supply a new evidence directory outside the source workspace and a locally installed model.",
  );
const clock = createSystemClock();
const execute = promisify(execFile);
const sourceRoot = resolve(new URL("../..", import.meta.url).pathname);
if (root === sourceRoot || root.startsWith(`${sourceRoot}/`))
  throw new Error("Evidence must be outside the source workspace.");
const git = async (cwd, ...args) =>
  (
    await execute("git", args, {
      cwd,
      env: harnessChildEnvironment().variables,
      maxBuffer: 64000000,
    })
  ).stdout.trim();
const sourceCommit = await git(sourceRoot, "rev-parse", "HEAD");
if ((await git(sourceRoot, "status", "--porcelain")).length)
  throw new Error("Commit the measured source first.");
const inventory = await (await fetch("http://127.0.0.1:11434/api/tags")).json();
const installed = inventory.models.find((entry) => entry.name === modelId);
if (!installed || installed.remote_host || installed.remote_model)
  throw new Error("Requested local weights are unavailable; no remote fallback is allowed.");
await mkdir(root, { mode: 0o700 });
const evidence = await openEvidenceSession({
  root: join(root, "sessions"),
  sessionId: "comparison",
  clock,
});
const profiles = ["legacy", "concise"];
const schedule = cases.flatMap((goal, index) =>
  (index % 2 === 0 ? profiles : [...profiles].reverse()).map((profile) => ({
    caseId: goal.id,
    profile,
  })),
);
const protocol = {
  version: 1,
  population: "maintainer synthetic prompt development",
  sourceCommit,
  driverDigest: digestOfBytes(await readFile(new URL(import.meta.url))),
  model: installed,
  localThinking: false,
  prompts: {
    legacy: digestOfBytes(legacyWorkerPrompt),
    concise: digestOfBytes(conciseWorkerPrompt),
  },
  cases,
  schedule,
  tokens: 250000,
  wallMs: 180000,
  maxSteps: 20,
  repairAttempts: 2,
  modelConcurrency: 1,
  testConcurrency: 1,
  exposure: "development, maintained fixture code and model-authored hidden checks",
  repeats: 1,
  stopping: "fixed schedule; retain failures and unknown usage",
  includesPlanning: false,
  includesVerification: true,
};
await evidence.record({
  type: "campaign-protocol",
  actor: "harness",
  provenance: ["user", "model"],
  payload: asJsonValue(protocol),
});
await writeFile(join(root, "protocol.json"), JSON.stringify(protocol, null, 2), {
  mode: 0o600,
  flag: "wx",
});
const observations = [];
for (const scheduled of schedule) {
  const goal = cases.find((entry) => entry.id === scheduled.caseId);
  const id = `${goal.id}-${scheduled.profile}`;
  const started = clock.now();
  await evidence.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: { phase: "launch", id, started },
  });
  console.log(JSON.stringify({ phase: "launch", id }));
  const workspace = join(root, id);
  let context;
  let outcome;
  try {
    await mkdir(workspace, { mode: 0o700 });
    for (const [path, content] of Object.entries({
      ...goal.files,
      "package.json": `${JSON.stringify({ type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
    }))
      await writeFile(join(workspace, path), content);
    await git(workspace, "init", "--quiet");
    await git(workspace, "add", ".");
    await git(
      workspace,
      "-c",
      "user.name=Swarm development",
      "-c",
      "user.email=development@example.com",
      "commit",
      "--quiet",
      "-m",
      "pinned synthetic fixture",
    );
    const baseCommit = await git(workspace, "rev-parse", "HEAD");
    const workerEvidence = await openEvidenceSession({
      root: join(root, "sessions"),
      sessionId: id,
      clock,
    });
    const contract = await declareGoalContract(workerEvidence, {
      version: 1,
      goal: goal.task,
      requirements: [{ id: goal.id, description: goal.task, checks: ["combined"] }],
      checks: [
        {
          id: "combined",
          command: "node .acceptance/check.mjs",
          author: "model",
          exposure: "withheld",
          artifacts: [{ path: ".acceptance/check.mjs", content: goal.check }],
        },
      ],
      immutablePaths: ["package.json", "base.test.js"],
    });
    context = await createRunContext({
      evidence: workerEvidence,
      clock,
      runId: id,
      maxTokens: protocol.tokens,
      maxWallMs: protocol.wallMs,
      modelConcurrency: 1,
      testConcurrency: 1,
      signal: new AbortController().signal,
    });
    const registry = createProviderRegistry({
      localBaseUrl: "http://127.0.0.1:11434/v1",
      localThinking: false,
    });
    const produced = await runAgentTask({
      promptProfile: scheduled.profile,
      task: goal.task,
      workspace,
      baseRef: baseCommit,
      maxSteps: protocol.maxSteps,
      attempts: protocol.repairAttempts,
      maxTokens: protocol.tokens,
      maxWallTimeMs: context.remainingWallMs(),
      model: context.model(
        id,
        createRecordingModelClient(registry.create({ provider: "local", modelId }), workerEvidence),
      ),
      evidence: workerEvidence,
      fileSet: createFileSetRegistry(workerEvidence),
      clock,
      random: { next: () => 0.5 },
      emit: () => {},
      confirm: async () => false,
      abortSignal: context.signal,
      homeDir: root,
      commandPool: context.tests,
    });
    await git(workspace, "add", ".");
    await git(
      workspace,
      "-c",
      "user.name=Swarm development",
      "-c",
      "user.email=development@example.com",
      "commit",
      "--allow-empty",
      "--quiet",
      "-m",
      "retained worker candidate",
    );
    const commit = await git(workspace, "rev-parse", "HEAD");
    const tree = await git(workspace, "rev-parse", "HEAD^{tree}");
    const patch = await git(workspace, "diff", "--binary", baseCommit, commit);
    const verification = await verifyIndependently({
      repositoryRoot: workspace,
      baseCommit,
      patch,
      clock,
      signal: context.signal,
      timeoutMs: Math.max(1, Math.min(120000, context.remainingWallMs())),
      commands: createNodeCommandRunner(
        clock,
        harnessChildEnvironment(),
        undefined,
        context.signal,
        context.tests,
      ),
      immutablePaths: contract.immutablePaths,
      goal: { contract, evidence: workerEvidence, tree },
    });
    outcome = {
      id,
      workerGreen: produced.green,
      accepted: produced.green && verification.verified,
      verification,
      steps: produced.loop.steps,
      stopReason: produced.loop.stopReason,
      commit,
      usage: context.accounting(),
      evidence: workerEvidence.directory,
      head: workerEvidence.head(),
    };
  } catch (cause) {
    outcome = {
      id,
      accepted: false,
      error: cause instanceof Error ? cause.message : String(cause),
      usage: context?.accounting() ?? null,
    };
  } finally {
    context?.dispose();
  }
  outcome.elapsedMs = clock.now() - started;
  observations.push(outcome);
  await evidence.record({
    type: "campaign-observation",
    actor: "harness",
    provenance: ["tool-output"],
    payload: asJsonValue({ phase: "settled", ...outcome }),
  });
  console.log(JSON.stringify(outcome));
}
await writeFile(join(root, "observations.json"), JSON.stringify(observations, null, 2), {
  mode: 0o600,
  flag: "wx",
});
console.log(
  JSON.stringify({
    phase: "finished",
    evidence: evidence.directory,
    head: evidence.head(),
    accepted: observations.filter((entry) => entry.accepted).length,
    scheduled: schedule.length,
  }),
);
