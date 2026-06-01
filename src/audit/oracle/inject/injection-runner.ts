// Drives the injector registry over a set of presumed-clean PR diffs and
// produces labeled broken variants. Pure: it takes PR inputs and returns
// rendered cases plus a per-injector tally of what it could and could not
// inject. The CLI (scripts/oracle/build-corpus.ts) owns the filesystem.
//
// Determinism: injectors are visited in registry order, PRs in id order,
// and the per-injection seed is the injector's registry index, so the same
// inputs always yield byte-identical diffs and the same drop counts.

import * as crypto from 'crypto';
import parseDiff from 'parse-diff';
import { INJECTORS } from './index';
import { renderPlan } from './diff-carrier';
import type { InjectionInput, InjectionLabel, Injector } from './injector-types';

export interface CleanPrInput {
  prId: string;
  sourcePrUrl: string;
  prTitle: string;
  cleanDiff: string;
}

export interface InjectedCase {
  category: string;
  injectorId: string;
  prId: string;
  brokenDiff: string;
  label: InjectionLabel;
}

export interface InjectorTally {
  injectorId: string;
  category: string;
  injected: number;
  refused: number;
  droppedToCap: number;
}

export interface RunResult {
  cases: InjectedCase[];
  tallies: InjectorTally[];
}

export interface RunOptions {
  /** Max injections per injector. Excess eligible PRs are dropped and
   *  counted, never silently. */
  perInjectorCap: number;
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function attempt(injector: Injector, seed: number, pr: CleanPrInput): InjectedCase | null {
  const files = parseDiff(pr.cleanDiff);
  if (files.length === 0) return null;
  const input: InjectionInput = {
    prId: pr.prId,
    sourcePrUrl: pr.sourcePrUrl,
    prTitle: pr.prTitle,
    cleanDiff: pr.cleanDiff,
    files,
    seed,
  };
  const plan = injector.plan(input);
  if (plan === null) return null;
  const rendered = renderPlan(input, plan);
  if (rendered === null) return null;
  const labelBase: Omit<InjectionLabel, 'sha256'> = {
    category: injector.category,
    injectorId: injector.id,
    file: plan.file,
    hunkIndex: rendered.hunkIndex,
    startLine: rendered.startLine,
    endLine: rendered.endLine,
    sourcePrUrl: pr.sourcePrUrl,
    prTitle: plan.claim ?? pr.prTitle,
  };
  if (plan.claim !== undefined) labelBase.claim = plan.claim;
  const label: InjectionLabel = { ...labelBase, sha256: sha256(rendered.brokenDiff) };
  return {
    category: injector.category,
    injectorId: injector.id,
    prId: pr.prId,
    brokenDiff: rendered.brokenDiff,
    label,
  };
}

export function runInjectors(prs: readonly CleanPrInput[], opts: RunOptions): RunResult {
  const sorted = [...prs].sort((a, b) => a.prId.localeCompare(b.prId));
  const cases: InjectedCase[] = [];
  const tallies: InjectorTally[] = [];
  INJECTORS.forEach((injector, index) => {
    let injected = 0;
    let refused = 0;
    let droppedToCap = 0;
    for (const pr of sorted) {
      const result = attempt(injector, index, pr);
      if (result === null) {
        refused += 1;
        continue;
      }
      if (injected >= opts.perInjectorCap) {
        droppedToCap += 1;
        continue;
      }
      cases.push(result);
      injected += 1;
    }
    tallies.push({ injectorId: injector.id, category: injector.category, injected, refused, droppedToCap });
  });
  return { cases, tallies };
}
