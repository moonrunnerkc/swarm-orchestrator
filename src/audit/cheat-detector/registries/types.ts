// Registry probe abstraction. The mock-of-hallucination v2.0 detector
// asks a probe whether an external dependency (a npm/PyPI/crates.io
// package, or a GitHub Actions marketplace entry) exists; the probe
// answers from an offline allowlist by default and can be wrapped in
// a caching layer so 200 PR audits do not generate 2000 lookups.
//
// The interface is deliberately small: a probe answers one query at
// a time, returns one of three verdicts (known, unknown, or
// unknown-version-of-known-package), and exposes the
// allowlist-snapshot-date so consumers can tell how stale the data
// is. The caching layer is generic over the probe.

export type RegistryName = 'npm' | 'pypi' | 'crates' | 'github-actions';

export type ProbeVerdict =
  | 'known'
  | 'unknown'
  | 'unknown-version-of-known-package';

export interface ProbeQuery {
  registry: RegistryName;
  /**
   * Package or action identifier:
   *   - npm: `lodash` or `@scope/pkg`
   *   - pypi: `requests`
   *   - crates: `serde`
   *   - github-actions: `actions/checkout`
   */
  name: string;
  /**
   * Optional version. For github-actions this is the ref after `@`
   * (typically `v4` or a commit sha). For npm/pypi/crates this is the
   * exact version string. Unspecified means "any version".
   */
  version?: string;
}

export interface ProbeResult {
  verdict: ProbeVerdict;
  /**
   * Human-readable diagnostic, e.g. "max known version is v4". Used
   * to enrich the finding message in the detector.
   */
  diagnostic: string;
  /**
   * ISO date of the allowlist snapshot the probe was built against.
   * Older snapshots produce more false-positives on packages that
   * shipped after the snapshot; the date lets the renderer hedge.
   */
  snapshotDate: string;
  /**
   * `true` when the probe answered from a network query. `false`
   * when the answer came from an offline allowlist or a local cache
   * miss. Used by tests and the AIBOM to mark non-deterministic
   * lookups.
   */
  fromNetwork: boolean;
}

export interface RegistryProbe {
  query(q: ProbeQuery): Promise<ProbeResult> | ProbeResult;
  snapshotDate(): string;
}
