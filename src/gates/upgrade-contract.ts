import { parse } from "smol-toml";
import { z } from "zod";
import { asJsonValue, canonicalJson } from "../evidence/canonical-json.ts";
import type { TaskPreset } from "../evidence/task-preset.ts";

const object = z.record(z.string(), z.unknown());
type Upgrade = Extract<TaskPreset, { kind: "upgrade" }>;

/** Only explicitly selected dependency values may differ; scripts and all other metadata stay sealed. */
export function validateUpgradeManifest(
  base: string,
  candidate: string,
  preset: Upgrade,
): string | null {
  try {
    const decode = (text: string) =>
      object.parse(preset.manager === "uv" ? parse(text) : JSON.parse(text));
    let baseBytes = base;
    let candidateBytes = candidate;
    const before = decode(base);
    const after = decode(candidate);
    for (const dependency of preset.dependencies) {
      if (preset.manager !== "uv") {
        const oldSection = object.parse(before[dependency.section] ?? {});
        const section = object.parse(after[dependency.section] ?? {});
        if (typeof oldSection[dependency.name] !== "string")
          return `dependency ${dependency.name} was not in the declared base section`;
        if (section[dependency.name] !== dependency.version)
          return `${dependency.name} must target exactly ${dependency.version}`;
        oldSection[dependency.name] = "<authorized dependency>";
        section[dependency.name] = "<authorized dependency>";
        before[dependency.section] = oldSection;
        after[dependency.section] = section;
      } else {
        const parent = dependency.section === "dependencies" ? "project" : "dependency-groups";
        const key = dependency.section === "dependencies" ? "dependencies" : "dev";
        for (const [data, isCandidate] of [
          [before, false],
          [after, true],
        ] as const) {
          const group = object.parse(data[parent]);
          const entries = z.array(z.string()).parse(group[key]);
          const matching = entries
            .map((entry, index) => ({ entry, index }))
            .filter(
              ({ entry }) =>
                entry
                  .split(/[<>=!~;[\s]/)[0]
                  ?.toLowerCase()
                  .replaceAll("_", "-") === dependency.name.toLowerCase().replaceAll("_", "-"),
            );
          if (matching.length !== 1) return `dependency ${dependency.name} must occur exactly once`;
          const found = matching[0];
          if (found === undefined) return "dependency not found";
          if (isCandidate && found.entry !== `${dependency.name}==${dependency.version}`)
            return `pin ${dependency.name}==${dependency.version}`;
          const source = isCandidate ? candidateBytes : baseBytes;
          const literals = [JSON.stringify(found.entry), `'${found.entry}'`];
          const occurrences = literals.flatMap((literal) =>
            [
              // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp - the replace on this line escapes every regex metacharacter, so the expression is a plain literal with no quantifier.
              ...source.matchAll(new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")),
            ].map((match) => ({ literal, index: match.index })),
          );
          if (occurrences.length !== 1)
            return "uv upgrade needs one plain quoted literal per authorized dependency";
          const occurrence = occurrences[0];
          if (occurrence === undefined) return "uv dependency literal is unavailable";
          const masked =
            source.slice(0, occurrence.index) +
            JSON.stringify(`<authorized ${dependency.name}>`) +
            source.slice(occurrence.index + occurrence.literal.length);
          if (isCandidate) candidateBytes = masked;
          else baseBytes = masked;
          entries[found.index] = `<authorized ${dependency.name}>`;
          group[key] = entries;
          data[parent] = group;
        }
      }
    }
    if (preset.manager === "uv" && baseBytes !== candidateBytes)
      return "uv upgrade changes bytes outside the authorized dependency literals";
    return canonicalJson(asJsonValue(before)) === canonicalJson(asJsonValue(after))
      ? null
      : "upgrade changes scripts, verification policy, or unrelated manifest metadata";
  } catch {
    return "upgrade manifest is malformed or its declared dependency section is absent";
  }
}
