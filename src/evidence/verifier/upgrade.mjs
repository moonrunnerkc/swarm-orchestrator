import { createHash } from "node:crypto";

const digest = (text) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
const regexLiteral = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function maskPython(text, dependency, candidate) {
  const pattern = candidate
    ? `${regexLiteral(dependency.name)}==${regexLiteral(dependency.version)}`
    : `${regexLiteral(dependency.name)}[^'"\\r\\n]*`;
  const matches = [...text.matchAll(new RegExp(`(['"])${pattern}\\1`, "g"))];
  if (matches.length !== 1) throw Error("ambiguous dependency literal");
  const match = matches[0];
  return (
    text.slice(0, match.index) +
    JSON.stringify(`<authorized ${dependency.name}>`) +
    text.slice(match.index + match[0].length)
  );
}

/** Independently compare authorized manifest changes and captured installed versions. */
export function upgradeControlPasses(preset, authorization, resolution) {
  try {
    if (
      preset?.kind !== "upgrade" ||
      authorization?.rule !== "upgrade-authorization-v1" ||
      resolution?.rule !== "upgrade-resolution-v1" ||
      resolution.matched !== true ||
      authorization.presetDigest !== digest(canonical(preset)) ||
      authorization.manifest !== preset.manifest ||
      authorization.lockfile !== preset.lockfile ||
      !Array.isArray(preset.dependencies) ||
      !preset.dependencies.length ||
      !Array.isArray(authorization.touched) ||
      !Array.isArray(preset.sourcePaths) ||
      authorization.manifestDigest !== digest(authorization.candidate) ||
      authorization.manifestDigest !== resolution.manifestDigest ||
      authorization.lockDigest !== resolution.lockDigest ||
      resolution.manager !== preset.manager
    )
      return false;
    const allowed = [preset.manifest, preset.lockfile, ...preset.sourcePaths];
    if (authorization.touched.some((path) => !allowed.includes(path))) return false;
    if (preset.dependencies.some(({ name, version }) => resolution.versions?.[name] !== version))
      return false;
    if (preset.manager === "uv") {
      let before = authorization.base,
        after = authorization.candidate;
      for (const dependency of preset.dependencies) {
        before = maskPython(before, dependency, false);
        after = maskPython(after, dependency, true);
      }
      return before === after;
    }
    if (!["npm", "pnpm"].includes(preset.manager)) return false;
    const before = JSON.parse(authorization.base),
      after = JSON.parse(authorization.candidate);
    for (const { name, section, version } of preset.dependencies) {
      if (
        !["dependencies", "devDependencies"].includes(section) ||
        typeof before[section]?.[name] !== "string" ||
        after[section]?.[name] !== version
      )
        return false;
      delete before[section][name];
      delete after[section][name];
    }
    return canonical(before) === canonical(after);
  } catch {
    return false;
  }
}
