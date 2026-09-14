import { createHash } from "node:crypto";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const equal = (left, right) => canonical(left) === canonical(right);
const hash = (value) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
const containsAll = (haystack, needles) => needles.every((item) => haystack.includes(item));
const unique = (items) => new Set(items).size === items.length;
const protectedPath = (immutable, path) => {
  const root = immutable.replace(/\/\*\*$/, "");
  return path === root || path.startsWith(`${root}/`);
};
const canonicalPath = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  !/^[a-zA-Z]:|^[/~]|[\\*?{}[\]]/.test(path) &&
  ![...path].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
  !path.split("/").some((part) => part === "" || part === "." || part === "..");

/** Independent interpretation of controller graph v1/v2 and effect events, with no producer imports. */
export function readControllerHistory(records, payloads) {
  let graph = null;
  let head = null;
  let resource = null;
  const graphs = [];
  const states = new Map();
  const accepted = new Map();
  const dispatches = new Map();
  const candidates = new Map();
  const integrations = new Map();
  const integrationOrder = new Map();
  const completed = new Set();
  const stale = new Set();
  const cleanup = new Set();
  const cleaned = new Set();
  const reconciled = new Set();
  const problems = bootstrapProblems(records, payloads);
  const require = (condition, description) => {
    if (!condition) throw new Error(description);
  };
  const current = (candidate) => {
    const origin = graphs.find((revision) => revision.revision === candidate.graphRevision);
    return (
      origin !== undefined &&
      graph.nodes.some((node) => node.id === candidate.taskId) &&
      graphs.every(
        (revision) =>
          revision.ordinal <= origin.ordinal || !revision.affected.includes(candidate.taskId),
      )
    );
  };
  try {
    for (const entry of records) {
      if (
        !["controller-graph", "controller-transition", "controller-candidate"].includes(entry.type)
      )
        continue;
      require(entry.actor === "harness", "model text cannot authorize controller effects");
      const observed = payloads.get(entry.payloadDigest);
      require(observed !== null && typeof observed === "object", "controller payload is missing");
      if (entry.type === "controller-graph") {
        const { revision, ...content } = observed;
        require([1, 2].includes(observed.version) &&
          hash(content) === revision, "controller revision digest or version is invalid");
        require(Number.isInteger(observed.ordinal) &&
          Number.isInteger(observed.limit) &&
          observed.limit >= 0 &&
          observed.limit <= 16 &&
          observed.ordinal <= observed.limit, "graph revision budget is invalid");
        require(observed.nodes.length > 0 &&
          observed.nodes.length <= 128 &&
          unique(observed.nodes.map((node) => node.id)) &&
          unique(observed.nodes.map((node) => node.contract.taskId)) &&
          unique(observed.retired), "controller task identities are invalid");
        require((observed.version === 2) ===
          (observed.scope !== undefined), "controller scope authority requires graph version two");
        if (observed.scope !== undefined) {
          const scope = observed.scope;
          require(["files", "workspace"].includes(scope.kind) &&
            Array.isArray(scope.allowedPaths) &&
            scope.allowedPaths.every(canonicalPath) &&
            (scope.kind === "workspace"
              ? scope.allowedPaths.length === 0
              : scope.allowedPaths.length > 0), "controller scope authority is malformed");
          require(Array.isArray(scope.immutablePaths) &&
            scope.immutablePaths.every((path) =>
              canonicalPath(path.replace(/\/\*\*$/, "")),
            ), "controller immutable scope is malformed");
          for (const node of observed.nodes)
            require(containsAll(node.contract.immutablePaths, scope.immutablePaths) &&
              (scope.kind === "workspace" ||
                (node.contract.scopeKind !== "workspace" &&
                  containsAll(
                    scope.allowedPaths,
                    node.contract.allowedPaths,
                  ))), "task exceeds the pinned controller scope");
        }
        const ids = observed.nodes.map((node) => node.id);
        require(!observed.retired.some((id) =>
          ids.includes(id),
        ), "a retired task identity was reused");
        const obligations = [...new Set(observed.nodes.flatMap((node) => node.obligations))].sort();
        require(unique(observed.obligations) &&
          equal(
            [...observed.obligations].sort(),
            obligations,
          ), "a declared obligation disappeared or was invented");
        const visiting = new Set();
        const visited = new Set();
        const visit = (id) => {
          require(!visiting.has(id), `controller dependency cycle at ${id}`);
          if (visited.has(id)) return;
          const node = observed.nodes.find((node) => node.id === id);
          require(node !== undefined, `controller dependency ${id} is missing`);
          require(/^[a-z0-9][a-z0-9-]{0,99}$/.test(node.id), "task identity is not slug-shaped");
          visiting.add(id);
          for (const dependency of node.dependsOn) visit(dependency);
          visiting.delete(id);
          visited.add(id);
        };
        ids.forEach(visit);
        if (graph === null) {
          require(observed.parent === null &&
            observed.ordinal === 0 &&
            observed.operation === null &&
            observed.retired.length === 0 &&
            observed.affected.length === 0, "initial controller declaration is invalid");
          require(equal(observed.obligations, ids) &&
            observed.nodes.every((node) =>
              equal(node.obligations, [node.id]),
            ), "initial task obligations do not match the declaration");
          const configuration = records
            .filter(
              (record) =>
                record.sequence < entry.sequence &&
                record.type === "controller-configuration" &&
                record.actor === "harness",
            )
            .at(-1);
          if (configuration !== undefined)
            require(equal(
              observed.scope ?? null,
              payloads.get(configuration.payloadDigest)?.spec?.controllerScope ?? null,
            ), "initial graph changed the pinned controller scope");
          const goal = records
            .filter((record) => record.sequence < entry.sequence && record.type === "goal-contract")
            .at(-1);
          if (goal !== undefined)
            require(equal(
              observed.requirements,
              payloads
                .get(goal.payloadDigest)
                ?.contract?.requirements.map((requirement) => requirement.id),
            ), "controller graph does not cover the pinned goal requirements");
        } else {
          require(observed.version === graph.version &&
            equal(observed.scope ?? null, graph.scope ?? null) &&
            observed.parent === graph.revision &&
            observed.ordinal === graph.ordinal + 1 &&
            observed.limit === graph.limit &&
            equal(observed.obligations, graph.obligations) &&
            equal(
              observed.requirements,
              graph.requirements,
            ), "revision erased obligations, changed the ceiling or has the wrong parent");
          const operation = observed.operation;
          require(operation &&
            [
              "add-prerequisite",
              "amend-scope",
              "insert-prerequisite",
              "split",
              "combine",
              "reroute",
            ].includes(operation.kind), "unknown controller revision operation");
          const removed = operation.kind === "combine" ? operation.tasks : [operation.taskId];
          require(unique(removed) &&
            removed.every((id) =>
              graph.nodes.some((node) => node.id === id),
            ), "revision references an undeclared task");
          const originals = graph.nodes.filter((node) => removed.includes(node.id));
          const within = (contract, originals) => {
            require(!originals.some((prior) => prior.contract.scopeAuthority === "human") ||
              contract.scopeAuthority === "human", "revision delegated human scope authority");
            const allowed = originals.flatMap((prior) => prior.contract.allowedPaths);
            const immutable = originals.flatMap((prior) => prior.contract.immutablePaths);
            const checks = originals.flatMap((prior) => prior.contract.requiredChecks);
            require(originals.some((prior) => prior.contract.scopeKind === "workspace") ||
              containsAll(allowed, contract.allowedPaths), "revision broadened authorized paths");
            require(!contract.allowedPaths.some((path) =>
              immutable.some((protectedFile) => protectedPath(protectedFile, path)),
            ) &&
              containsAll(contract.immutablePaths, immutable) &&
              containsAll(
                contract.requiredChecks,
                checks,
              ), "revision weakened immutable paths or required checks");
            require(originals.every(
              (prior) =>
                containsAll(prior.contract.allowedTools, contract.allowedTools) &&
                prior.contract.network === contract.network &&
                prior.contract.execution === contract.execution &&
                prior.contract.riskTier === contract.riskTier,
            ), "revision broadened execution or tool authority");
            for (const key of ["maxSteps", "maxWallMs", "maxTokens"])
              require((contract.budget[key] ?? 200000) <=
                Math.max(
                  ...originals.map((prior) => prior.contract.budget[key] ?? 200000),
                ), "revision broadened task budget");
          };
          let expected;
          let retired = graph.retired;
          if (operation.kind === "add-prerequisite") {
            require(!originals[0].dependsOn.includes(
              operation.prerequisite,
            ), "unchanged dependency revision");
            expected = graph.nodes.map((node) =>
              node.id === operation.taskId
                ? { ...node, dependsOn: [...new Set([...node.dependsOn, operation.prerequisite])] }
                : node,
            );
          } else if (operation.kind === "amend-scope") {
            const owner = originals[0];
            const scope = graph.scope;
            require(scope &&
              owner.contract.scopeAuthority === "controller" &&
              owner.contract.scopeKind !==
                "workspace", "task scope has no controller amendment authority");
            require(Array.isArray(operation.paths) &&
              operation.paths.length > 0 &&
              operation.paths.length <= 128 &&
              unique(operation.paths) &&
              operation.paths.every(canonicalPath) &&
              operation.paths.some(
                (path) => !owner.contract.allowedPaths.includes(path),
              ), "scope amendment is malformed or unchanged");
            require(operation.paths.every(
              (path) =>
                (scope.kind === "workspace" || scope.allowedPaths.includes(path)) &&
                ![...scope.immutablePaths, ...owner.contract.immutablePaths].some((immutable) =>
                  protectedPath(immutable, path),
                ),
            ), "scope amendment exceeds pinned authority");
            expected = graph.nodes.map((node) =>
              node.id === operation.taskId
                ? {
                    ...node,
                    contract: {
                      ...node.contract,
                      allowedPaths: [
                        ...new Set([...node.contract.allowedPaths, ...operation.paths]),
                      ].sort(),
                    },
                  }
                : node,
            );
          } else if (operation.kind === "insert-prerequisite") {
            const owner = originals[0];
            const node = operation.node;
            require(node &&
              !graph.nodes.some((prior) => prior.id === node.id) &&
              !graph.retired.includes(node.id), "prerequisite identity was reused");
            require(equal(
              [...node.obligations].sort(),
              [...owner.obligations].sort(),
            ), "new prerequisite erased the requesting task's obligations");
            within(node.contract, originals);
            expected = [
              ...graph.nodes.map((prior) =>
                prior.id === operation.taskId
                  ? { ...prior, dependsOn: [...prior.dependsOn, node.id] }
                  : prior,
              ),
              { ...node, dependsOn: [...new Set([...owner.dependsOn, ...node.dependsOn])] },
            ];
          } else {
            require(originals.every(
              (node) => !["running", "candidate"].includes(states.get(node.id)),
            ), "revision replaced active ownership");
            require(operation.kind !== "split" ||
              states.get(operation.taskId) === "pending", "only pending work may be split");
            const replacements =
              operation.kind === "split"
                ? operation.parts
                : operation.kind === "combine"
                  ? [operation.combined]
                  : [operation.replacement];
            require(replacements.length >= (operation.kind === "split" ? 2 : 1) &&
              replacements.length <= 8, "replacement count is invalid");
            require(equal(
              [...new Set(replacements.flatMap((node) => node.obligations))].sort(),
              [...new Set(originals.flatMap((node) => node.obligations))].sort(),
            ), "replacement erased task obligations");
            for (const node of replacements) {
              require(!graph.retired.includes(node.id) &&
                !graph.nodes.some(
                  (prior) => prior.id === node.id,
                ), "replacement reused an identity");
              within(node.contract, originals);
            }
            const inherited = [
              ...new Set(
                originals.flatMap((node) => node.dependsOn).filter((id) => !removed.includes(id)),
              ),
            ];
            expected = [
              ...graph.nodes
                .filter((node) => !removed.includes(node.id))
                .map((node) => ({
                  ...node,
                  dependsOn: [
                    ...new Set(
                      node.dependsOn.flatMap((id) =>
                        removed.includes(id)
                          ? replacements.map((replacement) => replacement.id)
                          : [id],
                      ),
                    ),
                  ],
                })),
              ...replacements.map((node) => ({
                ...node,
                dependsOn: [...new Set([...node.dependsOn, ...inherited])],
              })),
            ];
            retired = [...retired, ...removed];
          }
          expected = expected.map((node) => ({
            ...node,
            contract: {
              ...node.contract,
              dependsOn: node.dependsOn.map(
                (id) => expected.find((dependency) => dependency.id === id)?.contract.taskId ?? id,
              ),
            },
          }));
          const affected = new Set([
            ...removed,
            ...expected
              .filter((node) => !graph.nodes.some((prior) => prior.id === node.id))
              .map((node) => node.id),
          ]);
          let width;
          do {
            width = affected.size;
            for (const node of expected)
              if (node.dependsOn.some((id) => affected.has(id))) affected.add(node.id);
          } while (width !== affected.size);
          require(equal(observed.nodes, expected) &&
            equal(observed.retired, retired) &&
            equal(
              observed.affected,
              [...affected].sort(),
            ), "revision content does not follow from its declared operation");
        }
        for (const id of observed.affected) {
          accepted.delete(id);
          if (!["running", "candidate"].includes(states.get(id))) states.set(id, "pending");
        }
        for (const node of observed.nodes) if (!states.has(node.id)) states.set(node.id, "pending");
        for (const id of observed.retired) states.set(id, "blocked");
        graph = observed;
        graphs.push(observed);
        continue;
      }
      require(graph !== null, "controller effect precedes graph declaration");
      if (entry.type === "controller-candidate") {
        const intent = dispatches.get(observed.workerId);
        require(intent &&
          !candidates.has(observed.workerId) &&
          ["taskId", "baseCommit", "graphRevision", "branch", "sessionId"].every(
            (key) => intent[key] === observed[key],
          ), "candidate is not bound to one dispatch");
        candidates.set(observed.workerId, observed);
        if (current(observed))
          states.set(
            observed.taskId,
            observed.green && observed.commit !== null ? "candidate" : "failed",
          );
        continue;
      }
      switch (observed.kind) {
        case "integration-resource":
          require(resource === null ||
            (resource.path === observed.path &&
              resource.branch === observed.branch), "integration resource identity changed");
          require(observed.phase !== "created" ||
            resource?.phase === "create-intent", "integration resource lacks creation intent");
          require(observed.phase !== "removed" ||
            resource?.phase === "cleanup-intent", "integration resource lacks cleanup intent");
          resource = observed;
          break;
        case "integration-abandoned": {
          const intent = integrations.get(observed.effectId);
          require(intent &&
            !completed.has(observed.effectId), "abandoned integration lacks its unresolved intent");
          completed.add(observed.effectId);
          states.set(intent.taskId, "candidate");
          head = intent.baseCommit;
          break;
        }
        case "dispatch-intent": {
          const node = graph.nodes.find((node) => node.id === observed.taskId);
          require(node &&
            !dispatches.has(observed.workerId) &&
            graph.revision === observed.graphRevision &&
            states.get(node.id) !== "accepted" &&
            node.dependsOn.every(
              (id) => states.get(id) === "accepted",
            ), "dispatch is duplicate, stale or lacks accepted prerequisites");
          dispatches.set(observed.workerId, observed);
          states.set(node.id, "running");
          break;
        }
        case "integration-intent": {
          const candidate = candidates.get(observed.workerId);
          require(candidate?.green &&
            current(candidate) &&
            candidate.taskId === observed.taskId &&
            candidate.commit === observed.candidateCommit &&
            candidate.branch === observed.branch &&
            !stale.has(observed.workerId) &&
            !accepted.has(observed.taskId) &&
            observed.graphRevision === graph.revision &&
            !integrations.has(observed.effectId) &&
            [...integrations.keys()].every((id) =>
              completed.has(id),
            ), "integration lacks a current eligible candidate");
          require(head === null ||
            head === observed.baseCommit, "integration skipped the actual accepted head");
          integrations.set(observed.effectId, observed);
          integrationOrder.set(observed.effectId, entry.sequence);
          head = observed.baseCommit;
          break;
        }
        case "integration-completed": {
          const intent = integrations.get(observed.effectId);
          const capture = records.find(
            (record) =>
              record.sequence < entry.sequence &&
              record.sequence > (integrationOrder.get(observed.effectId) ?? Infinity) &&
              record.actor === "harness" &&
              record.type === "merge-attempt" &&
              record.payloadDigest === observed.observation,
          );
          const merge = payloads.get(capture?.payloadDigest);
          require(intent &&
            !completed.has(observed.effectId) &&
            merge?.workerId === intent.workerId &&
            merge?.landed === observed.landed &&
            merge?.commit ===
              observed.commit, "integration completion lacks a unique captured merge");
          completed.add(observed.effectId);
          if (observed.landed) {
            require(observed.commit !== null &&
              intent.graphRevision ===
                graph.revision, "accepted integration is stale or has no commit");
            accepted.set(intent.taskId, {
              workerId: intent.workerId,
              commit: observed.commit,
              graphRevision: intent.graphRevision,
            });
            states.set(intent.taskId, "accepted");
            head = observed.commit;
          } else states.set(intent.taskId, "failed");
          break;
        }
        case "candidate-refused": {
          const candidate = candidates.get(observed.workerId);
          const capture = records.find(
            (record) =>
              record.sequence < entry.sequence &&
              record.actor === "harness" &&
              record.type === "goal-candidate-verification" &&
              record.payloadDigest === observed.observation,
          );
          const reading = payloads.get(capture?.payloadDigest);
          require(candidate &&
            reading?.workerId === candidate.workerId &&
            (reading.verification?.verified === false ||
              reading.verification?.checks?.some((check) => check.status === "failed")) &&
            !accepted.has(candidate.taskId), "candidate refusal lacks independent failure");
          states.set(candidate.taskId, "failed");
          break;
        }
        case "candidate-stale": {
          const candidate = candidates.get(observed.workerId);
          require(candidate &&
            graph.revision ===
              observed.currentRevision, "stale candidate observation lacks its candidate");
          stale.add(observed.workerId);
          if (!accepted.has(candidate.taskId)) states.set(candidate.taskId, "pending");
          break;
        }
        case "task-reopened":
          require(states.has(observed.taskId) &&
            !accepted.has(observed.taskId), "reopening duplicates accepted work");
          states.set(observed.taskId, "pending");
          break;
        case "task-blocked":
          require(states.has(observed.taskId) &&
            !accepted.has(observed.taskId), "blocking cannot erase acceptance");
          states.set(observed.taskId, "blocked");
          break;
        case "cleanup-intent":
        case "cleanup-completed":
        case "worktree-created": {
          const intent = dispatches.get(observed.workerId);
          require(intent &&
            intent.path === observed.path &&
            intent.branch ===
              observed.branch, "cleanup or worktree observation names an unowned resource");
          if (observed.kind === "worktree-created")
            require(intent.baseCommit === observed.baseCommit, "worktree base changed");
          if (observed.kind === "cleanup-intent") cleanup.add(observed.workerId);
          if (observed.kind === "cleanup-completed") {
            require(cleanup.has(observed.workerId) &&
              !cleaned.has(observed.workerId), "cleanup completion lacks one prior intent");
            cleaned.add(observed.workerId);
          }
          break;
        }
        case "coordination-consumed":
          break;
        case "recovery-commit-intent":
          require(dispatches.get(observed.workerId)?.branch ===
            observed.branch, "recovery commit is not owned");
          break;
        case "recovery-reset-intent":
          require(integrations.get(observed.effectId)?.baseCommit === observed.targetCommit &&
            !completed.has(
              observed.effectId,
            ), "recovery reset lacks its unresolved integration and original base");
          break;
        case "recovery-ref-intent":
          require(integrations.has(observed.effectId) &&
            !completed.has(
              observed.effectId,
            ), "recovery reference lacks an unresolved integration");
          break;
        case "dispatch-reconciled":
          require(dispatches.has(observed.workerId) &&
            !reconciled.has(
              observed.workerId,
            ), "reconciliation lacks one unreconciled dispatch intent");
          reconciled.add(observed.workerId);
          if (
            observed.disposition === "not-started" &&
            !accepted.has(dispatches.get(observed.workerId).taskId)
          )
            states.set(dispatches.get(observed.workerId).taskId, "pending");
          break;
        default:
          throw new Error(`unknown controller transition ${observed.kind}`);
      }
    }
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
  }
  return { graph, states, accepted, head, problems };
}

/** Bootstrap observations are interpreted here independently of the producer's schema and rule. */
function bootstrapProblems(records, payloads) {
  const problems = [];
  try {
    const insist = (holds, reason) => {
      if (!holds) throw new Error(`bootstrap: ${reason}`);
    };
    const launches = records.filter((record) => record.type === "controller-launch");
    const launch = payloads.get(launches[0]?.payloadDigest)?.spec;
    const stages = records.filter((record) => record.type === "bootstrap-stage");
    if (launch?.bootstrap === undefined && stages.length === 0) return [];
    insist(
      launches.length === 1 &&
        launches[0].actor === "harness" &&
        launch.version === 3 &&
        launch.bootstrap === "node" &&
        launch.controllerScope?.kind === "workspace" &&
        launch.goal !== null,
      "requires one authorized version-three goal launch",
    );
    const expectedFiles = {
      ".gitignore": "node_modules/\ncoverage/\n",
      "package.json": `${JSON.stringify({ private: true, type: "module", engines: { node: ">=24" }, scripts: { test: "node --test" } }, null, 2)}\n`,
    };
    let intent = null;
    let ready = null;
    let cleaning = false;
    const calls = new Map();
    const observations = new Map();
    const settled = new Set();
    for (const record of records) {
      const payload = payloads.get(record.payloadDigest);
      if (record.type === "bootstrap-stage") {
        insist(
          record.actor === "harness" && payload !== undefined,
          "requires harness observations",
        );
        if (payload.phase === "intent") {
          insist(
            intent === null &&
              record.sequence > launches[0].sequence &&
              payload.version === 1 &&
              payload.language === "node" &&
              payload.baseCommit === launch.baseCommit &&
              payload.timestamp === 0 &&
              payload.ref === `refs/swarm-bootstrap/${launch.runId}` &&
              payload.workspace === `${launch.scratchRoot}/bootstrap` &&
              equal(payload.files, expectedFiles),
            "intent changed the authorized setup",
          );
          const algorithm = launch.baseCommit.length === 40 ? "sha1" : "sha256";
          const object = (kind, bytes) =>
            createHash(algorithm).update(`${kind} ${bytes.length}\0`).update(bytes).digest("hex");
          const treeBytes = Buffer.concat(
            Object.entries(expectedFiles).map(([path, bytes]) =>
              Buffer.concat([
                Buffer.from(`100644 ${path}\0`),
                Buffer.from(object("blob", Buffer.from(bytes)), "hex"),
              ]),
            ),
          );
          const tree = object("tree", treeBytes);
          const who = "Swarm Orchestrator <swarm@localhost> 0 +0000";
          const commit = object(
            "commit",
            Buffer.from(
              `tree ${tree}\nparent ${launch.baseCommit}\nauthor ${who}\ncommitter ${who}\n\nEstablish Node 24 bootstrap harness\n`,
            ),
          );
          insist(
            payload.tree === tree && payload.commit === commit,
            "setup commit does not describe its recorded objects",
          );
          intent = payload;
        } else {
          insist(intent !== null, "effect preceded its intent");
          if (payload.phase === "check-intent") {
            const attempt =
              [...calls.values()].filter((call) => call.check === payload.check).length + 1;
            insist(
              ready === null &&
                ["toolchain", "positive", "negative"].includes(payload.check) &&
                attempt <= 3 &&
                payload.id === `${payload.check}-${attempt}` &&
                !calls.has(payload.id),
              "invalid check identity, retry or order",
            );
            const backend =
              launch.isolation === null
                ? "host"
                : `${launch.isolation.runtime}:${launch.isolation.image}`;
            const fixtures =
              payload.check === "toolchain"
                ? expectedFiles
                : {
                    ...expectedFiles,
                    "control.test.js": `import {test} from 'node:test'; import assert from 'node:assert/strict'; test('bootstrap-${payload.check}',()=>assert.equal(1,${payload.check === "positive" ? 1 : 2}));\n`,
                  };
            insist(
              payload.backend === backend && equal(payload.files, fixtures),
              "check changed its backend or controls",
            );
            insist(
              payload.check === "toolchain"
                ? typeof payload.argv?.[0] === "string" &&
                    equal(payload.argv.slice(1), [
                      "-e",
                      "process.stdout.write(process.versions.node); if(Number(process.versions.node.split('.')[0])<24) process.exitCode=1",
                    ])
                : equal(payload.argv, ["npm", "test", "--", "--test-reporter=tap"]),
              "check command differs from its declared instrument",
            );
            calls.set(payload.id, payload);
          } else if (payload.phase === "check-observed") {
            const call = calls.get(payload.id);
            insist(
              call !== undefined && !settled.has(payload.id) && ready === null,
              "observation lacks its unique preceding call",
            );
            settled.add(payload.id);
            const seen = payload.observation;
            const complete =
              seen?.cancelled === false &&
              seen.timedOut === false &&
              seen.truncated === false &&
              seen.startFailure === null &&
              typeof seen.stdout === "string";
            let held = false;
            if (complete && call.check === "toolchain")
              held =
                seen.exitCode === 0 &&
                /^\d+\.\d+\.\d+$/.test(seen.stdout) &&
                Number(seen.stdout.split(".")[0]) >= 24;
            if (complete && call.check !== "toolchain") {
              const failure = call.check === "negative";
              held =
                seen.exitCode === (failure ? 1 : 0) &&
                seen.stdout
                  .split("\n")
                  .includes(`${failure ? "not ok" : "ok"} 1 - bootstrap-${call.check}`) &&
                seen.stdout.split("\n").includes("# tests 1") &&
                seen.stdout.split("\n").includes(`# fail ${failure ? 1 : 0}`);
            }
            observations.set(record.payloadDigest, { check: call.check, held });
          } else if (payload.phase === "ready") {
            insist(
              ready === null &&
                payload.commit === intent.commit &&
                payload.tree === intent.tree &&
                Array.isArray(payload.checks) &&
                payload.checks.length === 3 &&
                payload.checks.every((digest, index) => {
                  const seen = observations.get(digest);
                  return (
                    seen?.held === true &&
                    seen.check === ["toolchain", "positive", "negative"][index]
                  );
                }),
              "readiness lacks the exact toolchain and both controls",
            );
            ready = payload;
          } else if (payload.phase === "cleanup-intent") cleaning = true;
          else if (payload.phase === "cleanup-completed") {
            insist(cleaning, "cleanup has no intent");
            cleaning = false;
          } else insist(false, "unknown stage phase");
        }
      }
      if (record.type === "controller-configuration")
        insist(
          ready !== null && payload?.spec?.baseCommit === ready.commit,
          "dispatch base was not established by the setup",
        );
      if (record.type === "controller-event" && payload?.kind === "usage-reserved")
        insist(ready !== null, "model activity preceded setup acceptance");
      if (record.type === "goal-contract")
        insist(ready !== null, "goal checks were pinned before setup acceptance");
    }
  } catch (cause) {
    problems.push(cause instanceof Error ? cause.message : String(cause));
  }
  return problems;
}
