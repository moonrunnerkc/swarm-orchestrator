import type { BundleManifest } from "./bundle-manifest.ts";
import { canonicalJson } from "./canonical-json.ts";
import type { ClaimNode, EvidenceDag, EvidenceNode } from "./dag.ts";

/**
 * The reviewer's view: claims on the left, the records they cite on the right, anything
 * not harness-verified in red. Static and self-contained by design, since a review page
 * that needs a server is a review page nobody opens.
 */
export function renderReviewPage(manifest: BundleManifest, dag: EvidenceDag): string {
  const evidenceBySequence = new Map(dag.evidence.map((node) => [node.sequence, node]));
  const evidenceByDigest = new Map(dag.evidence.map((node) => [node.digest, node]));

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>swarm evidence bundle ${escapeHtml(manifest.sessionId)}</title>`,
    `<style>${styles}</style>`,
    "</head>",
    "<body>",
    renderHeader(manifest, dag),
    // Above the two columns, because a reader wants the verdict of the run and the change it
    // made before they want the chain it was recorded on. Both were terminal-only before.
    renderGates(dag),
    renderDiff(dag),
    '<main class="columns">',
    '<section class="claims"><h2>Claims</h2>',
    dag.claims.length === 0
      ? '<p class="empty">This run made no structured claims.</p>'
      : dag.claims.map((claim) => renderClaim(claim, evidenceByDigest)).join("\n"),
    "</section>",
    '<section class="evidence"><h2>Evidence</h2>',
    renderEvidenceIndex(dag),
    renderEvidenceColumn(dag),
    "</section>",
    "</main>",
    renderFooter(manifest, evidenceBySequence.size),
    "</body>",
    "</html>",
  ].join("\n");
}

function renderHeader(manifest: BundleManifest, dag: EvidenceDag): string {
  const keyCaveat =
    manifest.signature.keySource === "ephemeral"
      ? "The signing key was generated for this run only, so it links nothing to a durable identity."
      : "The signing key is held in the OS keychain of the machine that produced this bundle.";

  return [
    "<header>",
    `<h1>swarm evidence bundle</h1>`,
    ...renderWhatHappened(dag),
    '<dl class="facts">',
    field("session", manifest.sessionId),
    field("exported", isoTime(manifest.exportedAt)),
    field("records", String(manifest.recordCount)),
    field("chain head", manifest.chainHead),
    field("claims verified", `${dag.verifiedCount} of ${dag.claims.length}`),
    field("coverage of changed lines", describeChangedLineCoverage(dag)),
    "</dl>",
    '<p class="note">',
    "Green is computed by the harness: it means a machine-checkable predicate was evaluated ",
    "against the cited record and held. Model prose is never green. ",
    escapeHtml(keyCaveat),
    " A signature proves the bundle was not altered after it left that machine; it does not ",
    "prove the machine was honest while producing it.",
    "</p>",
    "</header>",
  ].join("");
}

/**
 * The ratchet abstains when no run measured coverage of the changed lines, and an abstention
 * that is only visible inside a payload reads as a pass. This says which of the two happened
 * on the face of the page: a ratio the harness measured, or nothing measured at all.
 */
function describeChangedLineCoverage(dag: EvidenceDag): string {
  const decisions = dag.evidence.filter((node) => node.type === "ratchet-decision");
  const last = decisions[decisions.length - 1]?.payload;
  const after =
    last !== null && last !== undefined && typeof last === "object" && !Array.isArray(last)
      ? (
          last as {
            readonly measures?: { readonly after?: { readonly changedLineCoverage?: unknown } };
          }
        ).measures?.after?.changedLineCoverage
      : undefined;

  return typeof after === "number" ? `${(after * 100).toFixed(1)}%` : "not measured";
}

/** Payload of the first record of a type, or null. Payloads are plain JSON by the time they get here. */
function payloadOf(dag: EvidenceDag, type: string): Record<string, unknown> | null {
  for (const node of dag.evidence) {
    if (node.type !== type) {
      continue;
    }
    const payload = node.payload;
    if (payload !== null && typeof payload === "object" && !Array.isArray(payload)) {
      return payload as Record<string, unknown>;
    }
  }
  return null;
}

function lastPayloadOf(dag: EvidenceDag, type: string): Record<string, unknown> | null {
  const matches = dag.evidence.filter((node) => node.type === type);
  const payload = matches[matches.length - 1]?.payload;
  return payload !== null && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : null;
}

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * The questions a person has before any identifier matters: what was asked for, what answered
 * it, how it ended, how long it took and what it cost. Every one of these was already in the
 * ledger and none of them was on the page, whose header opened with the chain head.
 */
function renderWhatHappened(dag: EvidenceDag): readonly string[] {
  // A session records one of these per turn. Showing the first task beside the last turn's
  // gates would describe two different pieces of work as though they were one.
  const turns = dag.evidence
    .filter((node) => node.type === "session-started")
    .map((node) =>
      node.payload !== null && typeof node.payload === "object" && !Array.isArray(node.payload)
        ? (node.payload as Record<string, unknown>)
        : null,
    )
    .filter((payload): payload is Record<string, unknown> => payload !== null);
  const started = turns[turns.length - 1] ?? null;
  const stopped = lastPayloadOf(dag, "session-stopped");
  const reward = lastPayloadOf(dag, "reward");

  const task = textOf(started?.task);
  const model = textOf(started?.modelSpec);
  const stopReason = textOf(stopped?.stopReason);
  const cost = typeof reward?.costUsd === "number" ? reward.costUsd : null;
  const latency = typeof reward?.latencyMs === "number" ? reward.latencyMs : null;

  if (task === null && model === null && stopReason === null) {
    return [];
  }

  const rows: string[] = ['<dl class="what">'];
  if (turns.length > 1) {
    // Every task in order, because the gates and the diff below belong to the last one and a
    // reader has to be able to see that this bundle covers more than a single piece of work.
    rows.push(
      field(
        `${turns.length} turns`,
        turns.map((turn, index) => `${index + 1}. ${textOf(turn.task) ?? "(no task)"}`).join("  "),
      ),
    );
    rows.push(field("shown below", "the last turn"));
  }
  if (task !== null) {
    rows.push(field(turns.length > 1 ? "last task" : "task", task));
  }
  if (model !== null) {
    rows.push(field("model", model));
  }
  if (stopReason !== null) {
    rows.push(
      field(
        "outcome",
        stopReason === "completed"
          ? "the loop completed, and the gates decided the rest"
          : `the loop stopped: ${stopReason}`,
      ),
    );
  }
  if (latency !== null) {
    rows.push(field("took", `${Math.round(latency / 1000)}s`));
  }
  if (cost !== null) {
    // Zero is a real answer and worth printing: it is what a local model costs.
    rows.push(field("cost", cost === 0 ? "$0.00, a local model" : `$${cost.toFixed(4)}`));
  }
  rows.push("</dl>");
  return rows;
}

/**
 * The gate table, which until now existed only in the terminal, printed through the interface
 * and never written into the bundle. On the page the gates were a run of indistinguishable
 * `gate-run` cards among the model calls, so the one thing that decides the outcome was the
 * hardest thing on the page to find.
 */
function renderGates(dag: EvidenceDag): string {
  const latest = new Map<string, Record<string, unknown>>();
  for (const node of dag.evidence) {
    if (node.type !== "gate-run") {
      continue;
    }
    const payload = node.payload;
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      continue;
    }
    const record = payload as Record<string, unknown>;
    const id = textOf(record.gateId);
    if (id !== null) {
      latest.set(id, record);
    }
  }
  if (latest.size === 0) {
    return "";
  }

  const rows = [...latest.entries()].map(([id, record]) => {
    const status = textOf(record.status) ?? "unknown";
    const blocking = record.blocking === true;
    return [
      `<tr class="gate-${escapeHtml(status)}">`,
      `<td class="gate-status">${escapeHtml(status)}</td>`,
      `<td class="gate-id">${escapeHtml(id)}${blocking ? "" : ' <span class="advisory">advisory</span>'}</td>`,
      `<td class="gate-detail">${escapeHtml(textOf(record.detail) ?? "")}</td>`,
      "</tr>",
    ].join("");
  });

  return [
    '<section class="gates">',
    "<h2>Gates</h2>",
    '<p class="note">A gate with nothing to run reports that it had nothing to run. It does not report a pass.</p>',
    "<table>",
    ...rows,
    "</table>",
    "</section>",
  ].join("");
}

/**
 * What the run did to the tree. Nothing in the ledger answered that before: the file-set record
 * names files, the diff budget counts lines, and the tool calls hold fragments of edits, so a
 * reviewer had to leave the evidence and run git to see the change they were reviewing.
 */
function renderDiff(dag: EvidenceDag): string {
  const record = lastPayloadOf(dag, "workspace-diff");
  const patch = textOf(record?.patch);
  if (record === null) {
    return "";
  }
  if (patch === null) {
    return [
      '<section class="diff">',
      "<h2>What changed</h2>",
      '<p class="empty">Nothing changed in the workspace.</p>',
      "</section>",
    ].join("");
  }

  const truncated = record.truncated === true;
  return [
    '<section class="diff">',
    "<h2>What changed</h2>",
    truncated
      ? `<p class="note">Shown to the first ${escapeHtml(String(record.characters ?? ""))} characters. The whole patch is in the record below.</p>`
      : "",
    `<pre class="patch">${renderPatch(patch)}</pre>`,
    "</section>",
  ].join("");
}

/** Added and removed lines coloured, which is the whole reason to render a patch rather than link one. */
function renderPatch(patch: string): string {
  return patch
    .split("\n")
    .map((line) => {
      const escaped = escapeHtml(line);
      if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ")) {
        return `<span class="patch-file">${escaped}</span>`;
      }
      if (line.startsWith("@@")) {
        return `<span class="patch-hunk">${escaped}</span>`;
      }
      if (line.startsWith("+")) {
        return `<span class="patch-add">${escaped}</span>`;
      }
      if (line.startsWith("-")) {
        return `<span class="patch-remove">${escaped}</span>`;
      }
      return escaped;
    })
    .join("\n");
}

function renderClaim(claim: ClaimNode, evidenceByDigest: Map<string, EvidenceNode>): string {
  const verified = claim.evaluation.verdict === "verified";
  const cited = claim.record === null ? undefined : evidenceByDigest.get(claim.record);

  return [
    `<article class="claim ${verified ? "verified" : "unverified"}">`,
    `<p class="verdict">${verified ? "VERIFIED" : "UNVERIFIED"}`,
    verified ? "" : `<span class="reason">${escapeHtml(claim.evaluation.reason ?? "")}</span>`,
    "</p>",
    `<pre class="predicate">${escapeHtml(claim.predicate || "(no predicate)")}</pre>`,
    '<p class="citation">',
    cited === undefined
      ? claim.record === null
        ? "cites no record"
        : `cites ${escapeHtml(claim.record)}, which is in no record of this chain`
      : `cites <a href="#record-${cited.sequence}">record ${cited.sequence}, ${escapeHtml(cited.type)}</a>`,
    claim.recordKind.length === 0 ? "" : `, asserted against ${escapeHtml(claim.recordKind)}`,
    "</p>",
    `<p class="detail">${escapeHtml(claim.evaluation.detail)}</p>`,
    claim.narrative.length === 0
      ? ""
      : `<blockquote class="prose"><span class="prose-label">unverified prose</span>${escapeHtml(claim.narrative)}</blockquote>`,
    "</article>",
  ].join("");
}

/**
 * Where a turn's records begin, by the `session-started` that opens it. A session records one
 * of these per turn, so the boundaries come off the chain rather than off a guess about time.
 */
interface TurnGroup {
  readonly index: number;
  readonly task: string;
  readonly records: readonly EvidenceNode[];
}

function groupByTurn(dag: EvidenceDag): readonly TurnGroup[] {
  const groups: TurnGroup[] = [];
  let current: EvidenceNode[] = [];
  let task = "before the first turn";
  let index = 0;

  const close = (): void => {
    if (current.length > 0) {
      groups.push({ index, task, records: current });
    }
  };

  for (const node of dag.evidence) {
    if (node.type === "session-started") {
      close();
      current = [];
      index += 1;
      task = textOf(objectPayload(node)?.task) ?? "(no task recorded)";
    }
    current.push(node);
  }
  close();
  return groups;
}

/** One record's payload as an object, or null where it is not one. */
function objectPayload(node: EvidenceNode): Record<string, unknown> | null {
  return node.payload !== null && typeof node.payload === "object" && !Array.isArray(node.payload)
    ? (node.payload as Record<string, unknown>)
    : null;
}

/**
 * What the evidence column opens with, and the whole of what "indexed" means here: how many
 * records there are, which turn each belongs to, and how many of each kind.
 *
 * The 08-23 calibration bundle is 3,716 records in an 11.6 MB page, and until now the only way
 * to find anything in it was to scroll. There is no search box because there is no script: a
 * review page that needs one to show its evidence is a review page that can stop working.
 * What is here instead is a list a reader can read and click.
 */
function renderEvidenceIndex(dag: EvidenceDag): string {
  const groups = groupByTurn(dag);
  const counts = new Map<string, number>();
  const firstOfType = new Map<string, number>();
  for (const node of dag.evidence) {
    counts.set(node.type, (counts.get(node.type) ?? 0) + 1);
    if (!firstOfType.has(node.type)) {
      firstOfType.set(node.type, node.sequence);
    }
  }

  const byType = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || (left[0] < right[0] ? -1 : 1))
    .map(
      ([type, count]) =>
        `<li><a href="#record-${firstOfType.get(type) ?? 0}">${escapeHtml(type)}</a>` +
        `<span class="index-count">${count}</span></li>`,
    );

  const byTurn = groups.map(
    (group) =>
      `<li><a href="#turn-${group.index}">` +
      (group.index === 0 ? "before the first turn" : `turn ${group.index}`) +
      `</a><span class="index-count">${group.records.length}</span>` +
      `<span class="index-task">${escapeHtml(group.task)}</span></li>`,
  );

  return [
    '<nav class="evidence-index">',
    `<p class="index-total">${dag.evidence.length} record(s), in ${groups.length} group(s).</p>`,
    groups.length < 2 ? "" : `<ul class="index-list">${byTurn.join("")}</ul>`,
    `<ul class="index-list">${byType.join("")}</ul>`,
    "</nav>",
  ].join("");
}

function renderEvidenceColumn(dag: EvidenceDag): string {
  const groups = groupByTurn(dag);
  const heading = (group: TurnGroup): string =>
    groups.length < 2
      ? ""
      : `<h3 class="turn" id="turn-${group.index}">` +
        (group.index === 0 ? "before the first turn" : `turn ${group.index}: `) +
        `${escapeHtml(group.index === 0 ? "" : group.task)}` +
        `<span class="index-count">${group.records.length}</span></h3>`;

  return groups
    .map((group) => heading(group) + group.records.map((node) => renderEvidence(node)).join(""))
    .join("\n");
}

/**
 * One record, collapsed to its head line.
 *
 * A `details` rather than an `article`, and the record itself rather than only its payload: the
 * column was every record fully expanded, which is what made a calibration bundle unreadable
 * rather than merely long. The head line stays visible either way, so a claim's link into a
 * record still lands somewhere a reader can see, with no script and no reliance on a browser
 * expanding a collapsed ancestor for a fragment.
 *
 * The digest moved inside for the same reason it was noise outside: a `sha256:` line under
 * every card, wanted by the person who is already opening the payload.
 */
function renderEvidence(node: EvidenceNode): string {
  return [
    `<details class="record" id="record-${node.sequence}">`,
    '<summary class="record-head">',
    `<span class="sequence">${node.sequence}</span>`,
    `<span class="type">${escapeHtml(node.type)}</span>`,
    `<span class="actor">${escapeHtml(node.actor)}</span>`,
    `<span class="time">${isoTime(node.timestamp)}</span>`,
    `<span class="summary">${escapeHtml(node.summary)}</span>`,
    "</summary>",
    `<p class="tags">provenance: ${node.provenance.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join(" ") || "none"}</p>`,
    `<p class="digest">${escapeHtml(node.digest)}</p>`,
    node.payload === null
      ? '<p class="detail">the payload blob is absent from this bundle</p>'
      : `<pre>${escapeHtml(prettyJson(node.payload))}</pre>`,
    "</details>",
  ].join("");
}

function renderFooter(manifest: BundleManifest, recordCount: number): string {
  return [
    "<footer>",
    "<p>Each tool-call record carries a derivation score: how much its arguments overlapped ",
    "content the model had recently read. That is a text-overlap heuristic with a ",
    "false-positive rate, not an information-flow guarantee, and a flagged call means ",
    "plausible influence rather than proven influence.</p>",
    `<p>${recordCount} evidence records. Verify this bundle without installing anything: `,
    "<code>node verify.mjs .</code> from this directory.</p>",
    `<p class="digest">signature ${escapeHtml(manifest.signature.algorithm)} over the chain head, `,
    `public key ${escapeHtml(manifest.signature.publicKey)}</p>`,
    "</footer>",
  ].join("");
}

function field(label: string, value: string): string {
  return `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
}

function isoTime(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function prettyJson(value: Parameters<typeof canonicalJson>[0]): string {
  return JSON.stringify(JSON.parse(canonicalJson(value)), null, 2);
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const styles = `
.what { margin: 0 0 1.2rem; }
.what dt { color: var(--muted); }
.what dd { font-weight: 600; }
section.gates, section.diff { margin: 0 0 1.5rem; }
section.gates table { border-collapse: collapse; width: 100%; font-size: .9rem; }
section.gates td { padding: .35rem .6rem; border-top: 1px solid var(--line); vertical-align: top; }
.gate-status { font-weight: 600; text-transform: uppercase; font-size: .72rem; white-space: nowrap; }
.gate-passed .gate-status { color: var(--green); }
.gate-failed .gate-status { color: var(--red); }
.gate-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: nowrap; }
.advisory { color: var(--muted); font-weight: 400; }
.gate-detail { color: var(--muted); }
.patch { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .8rem;
  line-height: 1.45; overflow-x: auto; border: 1px solid var(--line); border-radius: 6px;
  padding: .8rem; white-space: pre; }
.patch-add { color: var(--green); }
.patch-remove { color: var(--red); }
.patch-file { font-weight: 600; }
.patch-hunk { color: var(--muted); }
:root { color-scheme: light dark; --ink: #16181d; --paper: #fbfbfa; --line: #d8d8d4;
  --green: #17683a; --red: #b3261e; --muted: #5f6368; }
@media (prefers-color-scheme: dark) { :root { --ink: #e8e8e6; --paper: #16181d; --line: #33363d;
  --green: #6fd08c; --red: #ff8a80; --muted: #a0a4ab; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 2rem; background: var(--paper); color: var(--ink);
  font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
h1 { font-size: 1.4rem; margin: 0 0 .75rem; }
h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted);
  margin: 0 0 .75rem; }
header { border-bottom: 1px solid var(--line); padding-bottom: 1rem; margin-bottom: 1.5rem; }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: .15rem 1rem; margin: 0 0 .75rem; }
.facts dt { color: var(--muted); }
.facts dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem;
  overflow-wrap: anywhere; }
.note { max-width: 78ch; color: var(--muted); margin: 0; }
.columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 2rem; align-items: start; }
@media (max-width: 900px) { .columns { grid-template-columns: 1fr; } }
article { border: 1px solid var(--line); border-radius: 6px; padding: .8rem 1rem; margin-bottom: .75rem;
  background: color-mix(in srgb, var(--paper) 92%, var(--ink) 8%); }
.claim.unverified { border-left: 4px solid var(--red); }
.claim.verified { border-left: 4px solid var(--green); }
.verdict { font-weight: 700; letter-spacing: .04em; margin: 0 0 .5rem; }
.claim.unverified .verdict { color: var(--red); }
.claim.verified .verdict { color: var(--green); }
.reason { font-weight: 400; color: var(--muted); margin-left: .5rem; font-size: .85rem; }
.predicate, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .82rem;
  white-space: pre-wrap; overflow-wrap: anywhere; margin: 0 0 .5rem; }
.citation, .detail, .summary, .tags, .digest { margin: 0 0 .4rem; font-size: .85rem; }
.digest { color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: .72rem; overflow-wrap: anywhere; }
.detail { color: var(--muted); }
.prose { margin: .5rem 0 0; padding: .5rem .75rem; border-left: 3px dashed var(--line);
  color: var(--muted); font-style: italic; }
.prose-label { display: block; font-style: normal; font-size: .68rem; text-transform: uppercase;
  letter-spacing: .08em; }
details.record { border: 1px solid var(--line); border-radius: 6px; padding: .5rem .8rem;
  margin-bottom: .4rem; background: color-mix(in srgb, var(--paper) 92%, var(--ink) 8%); }
details.record > pre, details.record > .tags, details.record > .digest { margin-top: .5rem; }
h3.turn { font-size: .78rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted);
  margin: 1.2rem 0 .5rem; border-top: 1px solid var(--line); padding-top: .6rem; }
.evidence-index { margin: 0 0 1rem; font-size: .82rem; }
.index-total { margin: 0 0 .4rem; color: var(--muted); }
.index-list { list-style: none; margin: 0 0 .6rem; padding: 0; display: grid;
  grid-template-columns: max-content max-content 1fr; gap: .1rem .6rem; }
.index-list li { display: contents; }
.index-count { color: var(--muted); font-variant-numeric: tabular-nums; }
.index-task { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.record-head { margin: 0; display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap;
  cursor: pointer; }
.record-head .summary { flex: 1 1 12rem; }
.sequence { font-weight: 700; }
.type { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; }
.actor, .time { color: var(--muted); font-size: .78rem; }
.tag { border: 1px solid var(--line); border-radius: 999px; padding: 0 .5rem; font-size: .72rem; }
a { color: inherit; }
footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted);
  font-size: .85rem; }
.empty { color: var(--muted); }
`;
