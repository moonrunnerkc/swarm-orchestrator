/**
 * The candidate walk: what the search returned, in the order the criteria fix, judged one at
 * a time until every quota is filled. Every decision is kept, accepted or rejected, with the
 * rule that made it, because the point of sealed criteria is that a reader can check the rule
 * did the choosing.
 */
import { quotas } from "./criteria.mjs";

/**
 * One candidate as the search reported it. Only the fields the rules read are kept, so the
 * committed candidate list is what was judged and nothing more.
 */
export function candidateFrom(searchItem) {
  return {
    fullName: searchItem.full_name,
    owner: searchItem.owner?.login ?? searchItem.full_name.split("/")[0],
    language: searchItem.language,
    stars: searchItem.stargazers_count,
    license: searchItem.license?.spdx_id ?? null,
    defaultBranch: searchItem.default_branch,
    sizeKilobytes: searchItem.size,
    archived: searchItem.archived === true,
    fork: searchItem.fork === true,
    template: searchItem.is_template === true,
    mirror: typeof searchItem.mirror_url === "string" && searchItem.mirror_url.length > 0,
    pushedAt: searchItem.pushed_at,
    cloneUrl: searchItem.clone_url,
  };
}

/**
 * Stars descending, then full name ascending, one entry per repository however many license
 * queries returned it. The order is the whole of what decides which candidates are seen
 * first, so it is a pure function of the saved search results and nothing else.
 */
export function orderCandidates(items) {
  const byName = new Map();
  for (const item of items) {
    if (!byName.has(item.fullName)) {
      byName.set(item.fullName, item);
    }
  }
  return [...byName.values()].sort(
    (left, right) => right.stars - left.stars || left.fullName.localeCompare(right.fullName),
  );
}

/**
 * Walks each language's candidates in order, asking `judge` about each until the quota is
 * met or the candidates run out. `judge` answers { accepted: true, ... } or
 * { accepted: false, reason }, and every answer is recorded. A language whose candidates run
 * out short of its quota is reported as short rather than topped up from another language:
 * the quota is the rule, and a shortfall is a fact about the pool.
 */
export async function walkCandidates(candidatesByLanguage, judge, options = {}) {
  const targets = options.quotas ?? quotas;
  const accepted = [];
  const decisions = [];
  const shortfalls = {};

  for (const [language, quota] of Object.entries(targets)) {
    let taken = 0;
    for (const candidate of candidatesByLanguage[language] ?? []) {
      if (taken >= quota) {
        break;
      }
      const verdict = await judge(candidate);
      decisions.push({ fullName: candidate.fullName, language, ...verdict });
      if (verdict.accepted) {
        accepted.push({ ...candidate, ...verdict });
        taken += 1;
      }
    }
    if (taken < quota) {
      shortfalls[language] = quota - taken;
    }
  }

  return { accepted, decisions, shortfalls };
}

/**
 * The recorded decisions a later judgement may supersede: rejections whose reason starts
 * with `reasonPrefix`, in the order they were recorded. A superseding decision is appended,
 * never written over the first, so the record shows both the rule as it stood and the rule
 * as amended; the walk reads the last decision for a repository as the one that stands.
 */
export function supersedable(decisions, reasonPrefix) {
  const latest = new Map();
  for (const decision of decisions) {
    latest.set(decision.fullName, decision);
  }
  return [...latest.values()].filter(
    (decision) => decision.accepted !== true && typeof decision.reason === "string" && decision.reason.startsWith(reasonPrefix),
  );
}

/** The rules whose verdict depends on a container run, and so on the machine's state. */
const containerDependent = /^(install failed|suite at base|no seed within|clone failed)/;

/**
 * The standing rejections a container could have caused between two instants, whatever
 * they printed. A machine fault that does not always announce itself, a disk that filled,
 * is bounded by when it held rather than by the text it left, so every container-dependent
 * rejection in the window is judged again, and one that was genuine is rejected again with
 * a later decision saying so.
 */
export function supersedableBetween(decisions, from, to) {
  return supersedable(decisions, "").filter(
    (decision) =>
      typeof decision.judgedAt === "string" &&
      decision.judgedAt >= from &&
      decision.judgedAt <= to &&
      containerDependent.test(decision.reason),
  );
}
