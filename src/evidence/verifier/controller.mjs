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

/** Independent interpretation of controller graph v1 and effect events, with no producer imports. */
export function readControllerHistory(records, payloads) {
  let graph = null;
  let head = null;
  const graphs = [];
  const states = new Map();
  const accepted = new Map();
  const dispatches = new Map();
  const candidates = new Map();
  const integrations = new Map();
  const completed = new Set();
  const stale = new Set();
  const cleanup = new Set();
  const cleaned = new Set();
  const problems = [];
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
        require(observed.version === 1 &&
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
          require(observed.parent === graph.revision &&
            observed.ordinal === graph.ordinal + 1 &&
            observed.limit === graph.limit &&
            equal(observed.obligations, graph.obligations) &&
            equal(
              observed.requirements,
              graph.requirements,
            ), "revision erased obligations, changed the ceiling or has the wrong parent");
          const operation = observed.operation;
          require(operation &&
            ["add-prerequisite", "split", "combine", "reroute"].includes(
              operation.kind,
            ), "unknown controller revision operation");
          const removed = operation.kind === "combine" ? operation.tasks : [operation.taskId];
          require(unique(removed) &&
            removed.every((id) =>
              graph.nodes.some((node) => node.id === id),
            ), "revision references an undeclared task");
          const originals = graph.nodes.filter((node) => removed.includes(node.id));
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
              const contract = node.contract;
              const allowed = originals.flatMap((prior) => prior.contract.allowedPaths);
              const immutable = originals.flatMap((prior) => prior.contract.immutablePaths);
              const checks = originals.flatMap((prior) => prior.contract.requiredChecks);
              require(originals.some((prior) => prior.contract.scopeKind === "workspace") ||
                containsAll(allowed, contract.allowedPaths), "revision broadened authorized paths");
              require(containsAll(contract.immutablePaths, immutable) &&
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
          head = observed.baseCommit;
          break;
        }
        case "integration-completed": {
          const intent = integrations.get(observed.effectId);
          const capture = records.find(
            (record) =>
              record.sequence < entry.sequence &&
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
        case "candidate-stale": {
          const candidate = candidates.get(observed.workerId);
          require(candidate &&
            graph.revision ===
              observed.currentRevision, "stale candidate observation lacks its candidate");
          stale.add(observed.workerId);
          if (!accepted.has(candidate.taskId)) states.set(candidate.taskId, "pending");
          break;
        }
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
        case "dispatch-reconciled":
          require(dispatches.has(observed.workerId), "reconciliation lacks dispatch intent");
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
