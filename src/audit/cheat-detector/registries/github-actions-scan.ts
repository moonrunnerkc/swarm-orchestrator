// Extracts `uses: <action>@<ref>` references from added lines of
// GitHub Actions workflow YAML files. The output is fed to the
// registry probe so `actions/checkout@v6` (a real v10.1 miss) lands
// as `unknown-version-of-known-package`.
//
// We accept both quoted and unquoted forms, since the YAML linters
// disagree on which is canonical:
//
//   uses: actions/checkout@v4
//   uses: "actions/checkout@v4"
//   uses: 'actions/checkout@v4'
//
// Local action references (`uses: ./local-action`) and Docker
// references (`uses: docker://...`) are skipped: those are not
// marketplace lookups and the probe has no opinion on them.

import type { AddedLine } from '../diff-walker';

export interface UsesRef {
  file: string;
  line: number;
  action: string;
  version: string | undefined;
  raw: string;
}

// Allow an optional YAML list marker (`- `) before the key, since
// `uses:` typically lives under a `- ` step entry.
const USES_RE = /^\s*-?\s*uses\s*:\s*(?:["']?)([^"'\s]+)(?:["']?)\s*(?:#.*)?$/;

export function extractUsesRefs(added: readonly AddedLine[]): UsesRef[] {
  const out: UsesRef[] = [];
  for (const a of added) {
    if (!isWorkflowFile(a.file)) continue;
    const m = a.content.match(USES_RE);
    if (m === null) continue;
    const ref = m[1] ?? '';
    if (ref.length === 0) continue;
    if (ref.startsWith('./') || ref.startsWith('../') || ref.startsWith('docker://')) continue;
    const at = ref.indexOf('@');
    if (at === -1) {
      // No version: still a marketplace reference; probe with
      // version=undefined.
      out.push({ file: a.file, line: a.lineNumber, action: ref, version: undefined, raw: a.content.trim() });
      continue;
    }
    const action = ref.slice(0, at);
    const version = ref.slice(at + 1);
    if (action.length === 0 || version.length === 0) continue;
    out.push({ file: a.file, line: a.lineNumber, action, version, raw: a.content.trim() });
  }
  return out;
}

function isWorkflowFile(file: string): boolean {
  return /(^|\/)\.github\/(workflows|actions)\/.+\.(yml|yaml)$/i.test(file);
}
