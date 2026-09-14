export function readControllerHistory(
  records: readonly { type: string; actor: string; sequence: number; payloadDigest: string }[],
  payloads: ReadonlyMap<string, unknown>,
): {
  graph: {
    revision: string;
    ordinal: number;
    obligations: readonly string[];
    nodes: readonly { id: string; obligations: readonly string[] }[];
  } | null;
  states: Map<string, string>;
  accepted: Map<string, { workerId: string; commit: string; graphRevision: string }>;
  head: string | null;
  problems: string[];
};
