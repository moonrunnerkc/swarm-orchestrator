// Render the agent-corpus incidence report: of the merged PRs the shipped
// fingerprinter attributes to an AI coding agent, what share carries at
// least one finding both arbiters classify as a true cheat. The headline
// is a Wilson 95% interval, not a point estimate, and every layer of
// uncertainty (search selection, AI arbiters, splits) is stated in the
// report rather than footnoted away.
//
// Usage: node dist/scripts/real-prs/build-agent-incidence-report.js

import * as fs from 'fs';
import * as path from 'path';
import { getLogger } from '../../src/logger';
import { wilsonLowerBound } from '../../src/audit/gate/wilson';
import { agentAuditResultsDir, agentIncidenceReportFile, agentLabelsFile, agentSourcesFile } from './lib/paths';
import type { AuditResultRecord, DualArbiterLabel } from './lib/types';
import type { AgentSourcesFile } from './lib/agent-types';

const log = getLogger('real-prs:agent-report');

function wilsonInterval(successes: number, trials: number): { lower: number; upper: number } {
  return {
    lower: wilsonLowerBound(successes, trials),
    upper: trials === 0 ? 0 : 1 - wilsonLowerBound(trials - successes, trials),
  };
}

function pct(x: number): string {
  return `${(100 * x).toFixed(1)}%`;
}

function loadRecords(): AuditResultRecord[] {
  const dir = agentAuditResultsDir();
  if (!fs.existsSync(dir)) return [];
  const out: AuditResultRecord[] = [];
  for (const repoDir of fs.readdirSync(dir)) {
    const full = path.join(dir, repoDir);
    if (!fs.statSync(full).isDirectory()) continue;
    for (const file of fs.readdirSync(full)) {
      if (file.endsWith('.json')) out.push(JSON.parse(fs.readFileSync(path.join(full, file), 'utf8')) as AuditResultRecord);
    }
  }
  return out;
}

function main(): void {
  const sources = JSON.parse(fs.readFileSync(agentSourcesFile(), 'utf8')) as AgentSourcesFile;
  const records = loadRecords();
  const labels: DualArbiterLabel[] = fs.existsSync(agentLabelsFile())
    ? (JSON.parse(fs.readFileSync(agentLabelsFile(), 'utf8')) as DualArbiterLabel[])
    : [];

  // No labels yet (the arbiter stage needs an LLM and may run on another
  // machine): report the corpus and audit state honestly instead of a
  // fake 0% incidence.
  if (labels.length === 0) {
    const audited0 = records.length;
    const findings0 = records.reduce((n, r) => n + r.post.length, 0);
    const vendorCounts = new Map<string, number>();
    for (const p of sources.prs) vendorCounts.set(p.agent.vendor, (vendorCounts.get(p.agent.vendor) ?? 0) + 1);
    const md = `# Agent-PR cheat incidence (pilot): classification pending

The corpus and audit stages are complete; the dual-arbiter classification
has not run yet (it needs two LLM arbiters), so **no incidence number is
claimed here**. Run \`npm run agent-incidence:arbiter\` then
\`npm run agent-incidence:report\` to produce the measured headline.

- **Corpus:** ${sources.prs.length} merged agent-attributed PRs fetched at ${sources.fetchedAt} (${[...vendorCounts.entries()].map(([v, n]) => `${v}: ${n}`).join(', ')}).
- **Audit:** ${audited0} PRs audited with the default product configuration; ${findings0} unclassified findings.
- Queries, caps, and drop counts are in \`sources.json\`; per-PR findings in \`audit-results/\`.
`;
    fs.writeFileSync(agentIncidenceReportFile(), md);
    log.info(`wrote ${agentIncidenceReportFile()}: classification pending (${findings0} findings unclassified)`);
    return;
  }

  const byPr = new Map<string, DualArbiterLabel[]>();
  for (const l of labels) {
    const k = `${l.repo}#${l.prNumber}`;
    byPr.set(k, [...(byPr.get(k) ?? []), l]);
  }

  const vendorOf = new Map(sources.prs.map((p) => [`${p.repo}#${p.prNumber}`, p.agent.vendor]));
  const audited = records.length;
  const totalFindings = records.reduce((n, r) => n + r.post.length, 0);
  const classified = labels.length;
  const splits = labels.filter((l) => !l.agreed).length;
  const trueCheats = labels.filter((l) => l.verdict === 'true-cheat').length;
  const falseAlarms = labels.filter((l) => l.verdict === 'false-alarm').length;

  const flaggedPrs = new Set<string>();
  for (const [k, ls] of byPr) if (ls.some((l) => l.verdict === 'true-cheat')) flaggedPrs.add(k);
  const ci = wilsonInterval(flaggedPrs.size, audited);

  const vendorRows: string[] = [];
  const vendors = [...new Set(sources.prs.map((p) => p.agent.vendor))].sort();
  for (const v of vendors) {
    const prs = records.filter((r) => vendorOf.get(`${r.repo}#${r.prNumber}`) === v);
    const flagged = prs.filter((r) => flaggedPrs.has(`${r.repo}#${r.prNumber}`)).length;
    const findings = prs.reduce((n, r) => n + r.post.length, 0);
    vendorRows.push(`| ${v} | ${prs.length} | ${findings} | ${flagged} |`);
  }

  const catCounts = new Map<string, { tc: number; fa: number; split: number }>();
  for (const l of labels) {
    const c = catCounts.get(l.category) ?? { tc: 0, fa: 0, split: 0 };
    if (!l.agreed) c.split += 1;
    else if (l.verdict === 'true-cheat') c.tc += 1;
    else if (l.verdict === 'false-alarm') c.fa += 1;
    catCounts.set(l.category, c);
  }
  const catRows = [...catCounts.entries()]
    .sort((a, b) => b[1].tc - a[1].tc)
    .map(([cat, c]) => `| ${cat} | ${c.tc} | ${c.fa} | ${c.split} |`);

  const models = labels[0] !== undefined ? `${labels[0].primary.model} + ${labels[0].secondary.model}` : 'n/a';

  const md = `# Agent-PR cheat incidence (pilot)

Of the merged PRs the shipped fingerprinter attributes to an AI coding
agent at medium-or-high confidence, the share carrying at least one
finding that two independent arbiter model families both classify as a
true cheat. Regenerate with \`npm run agent-incidence:full\`.

Lab measurements of agent reward hacking exist (METR measured o3 gaming
30.4% of RE-Bench runs); a field counterpart for merged agent PRs does
not. This is that measurement, at pilot scale, with its uncertainty
stated.

## Headline

- **Corpus:** ${audited} merged agent-attributed PRs (${sources.prs.length} fetched; selection below).
- **Audit:** ${totalFindings} findings from the default product configuration.
- **Dual-arbiter labels:** ${classified} of ${totalFindings} findings classified (${models}); ${splits} arbiter-splits excluded from the headline.${classified < totalFindings ? ` **Classification is partial**; the incidence below can only grow as the remaining ${totalFindings - classified} findings are classified.` : ''}
- **Incidence:** ${flaggedPrs.size}/${audited} PRs carry at least one agreed true-cheat finding = **${pct(audited > 0 ? flaggedPrs.size / audited : 0)}** (Wilson 95%: ${pct(ci.lower)} to ${pct(ci.upper)}).
- Agreed false-alarms: ${falseAlarms}; agreed true-cheats: ${trueCheats}.

## By vendor

| vendor | PRs audited | findings | PRs with agreed true-cheat |
|---|---|---|---|
${vendorRows.join('\n')}

## By category (classified findings)

| category | true-cheat | false-alarm | split |
|---|---|---|---|
${catRows.join('\n')}

## Selection

${sources.prs.length} PRs fetched at ${sources.fetchedAt}, capped at ${sources.perVendorCap}/vendor, changed-line band ${sources.lineBand.min}-${sources.lineBand.max}. Queries:

${sources.queries.map((q) => `- \`${q}\``).join('\n')}

Every candidate was confirmed by \`detectAgent\` (src/audit/pr-source) on
the PR's real metadata before inclusion; search hits the fingerprinter
did not confirm were dropped and counted in \`sources.json\`.

## Honest caveats

- **Pilot scale.** The Wilson interval above is wide; treat the headline
  as a first field estimate, not a settled rate.
- **Selection bias.** The corpus is search-discoverable agent PRs
  (bot authors and explicit body markers). Agents run without attribution
  markers are invisible to this method, and repos that ban agent PRs are
  absent by construction. The true population rate could differ in either
  direction.
- **AI arbiters, not human labels.** A finding counts only when two
  independent model families agree, and splits are excluded, but model
  consensus is not ground truth. The adjudication loop
  (scripts/labeling/adjudicate.ts) is the path to human verification.
- **Merged PRs only.** Cheats caught in review and never merged do not
  appear; this measures what survives review.
`;

  fs.writeFileSync(agentIncidenceReportFile(), md);
  log.info(`wrote ${agentIncidenceReportFile()}: incidence ${flaggedPrs.size}/${audited} (Wilson ${pct(ci.lower)}-${pct(ci.upper)})`);
}

main();
