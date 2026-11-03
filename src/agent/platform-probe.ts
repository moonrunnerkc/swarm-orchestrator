import { readdir } from "node:fs/promises";
import { runProcessGroup } from "swarm-verify/execution";

/**
 * What the probe asks the machine, as `key=value` lines. It runs the way the model's commands
 * run, `/bin/sh -c` with the child environment, so it finds the programs they will find. A
 * tool's flavor is read from its version line and, for the three whose BSD forms print none,
 * from a behavior only one flavor has: `sed -i` with no suffix, `find -printf`, `xargs -J`.
 */
export const probeScript = `
first() { "$@" 2>&1 </dev/null | head -n 1; }
echo "uname=$(uname -s) $(uname -r) $(uname -m)"
command -v sw_vers >/dev/null 2>&1 && echo "macos=$(sw_vers -productVersion)"
[ -r /etc/os-release ] && echo "linux=$(. /etc/os-release && echo "$PRETTY_NAME")"
echo "sh.bash=\${BASH_VERSION:-}"
echo "sh.zsh=\${ZSH_VERSION:-}"
echo "sh.link=$(readlink /bin/sh 2>/dev/null)"
for t in sed grep find awk xargs; do
  command -v "$t" >/dev/null 2>&1 || { echo "tool.$t.path="; continue; }
  echo "tool.$t.path=$(command -v "$t")"
  echo "tool.$t.version=$(first "$t" --version)"
done
command -v awk >/dev/null 2>&1 && echo "tool.awk.w=$(first awk -W version)"
d=$(mktemp -d "\${TMPDIR:-/tmp}/swarm-probe.XXXXXX") || exit 0
printf 'a\\n' > "$d/f"; printf 'a\\n' > "$d/g"
if sed -i 's/a/b/' "$d/f" >/dev/null 2>&1 && [ "$(cat "$d/f")" = b ]; then echo "sed.inplace=bare"
elif sed -i '' 's/a/b/' "$d/g" >/dev/null 2>&1 && [ "$(cat "$d/g")" = b ]; then echo "sed.inplace=suffix"
else echo "sed.inplace=none"; fi
[ "$(echo a | grep -P 'a' 2>/dev/null)" = a ] && echo "grep.P=yes" || echo "grep.P=no"
[ "$(find "$d" -maxdepth 0 -printf x 2>/dev/null)" = x ] && echo "find.printf=yes" || echo "find.printf=no"
[ "$(echo a | xargs -J % echo % 2>/dev/null)" = a ] && echo "xargs.J=yes" || echo "xargs.J=no"
rm -rf "$d"
for t in node npm npx pnpm yarn bun deno python3 python pip3 uv poetry go cargo rustc java ruby git make; do
  command -v "$t" >/dev/null 2>&1 || continue
  case $t in go) args=version ;; java) args=-version ;; *) args=--version ;; esac
  if out=$(COREPACK_ENABLE_NETWORK=0 "$t" $args 2>&1 </dev/null); then
    echo "have.$t=$(printf '%s\\n' "$out" | head -n 1)"
  else
    echo "broken.$t=$(printf '%s\\n' "$out" | head -n 1)"
  fi
done
for t in docker podman nerdctl; do command -v "$t" >/dev/null 2>&1 && echo "container.$t=$(command -v "$t")"; done
exit 0
`;

export interface PlatformProbe {
  /** Every key the probe printed, with its value as printed. */
  readonly facts: Readonly<Record<string, string>>;
  /** The repository root's entries, sorted, a directory ending in "/". */
  readonly layout: readonly string[];
  /** The probe ran past its time and what it printed is a prefix. */
  readonly cut: boolean;
}

export function parseProbe(output: string): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) facts[line.slice(0, at)] = line.slice(at + 1).trim();
  }
  return facts;
}

/** The probe, run once at session start in the workspace, with the model's environment. */
export async function probePlatform(input: {
  readonly workspace: string;
  readonly env: Record<string, string>;
  readonly signal?: AbortSignal | undefined;
}): Promise<PlatformProbe & { readonly output: string }> {
  const ran = await runProcessGroup("/bin/sh", ["-c", probeScript], {
    cwd: input.workspace,
    env: input.env,
    timeoutMs: 30_000,
    maxOutputBytes: 64 * 1024,
    signal: input.signal,
  });
  const entries = await readdir(input.workspace, { withFileTypes: true });
  const layout = entries
    .filter((entry) => entry.name !== ".git" && entry.name !== ".swarm")
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((a, b) => a.localeCompare(b));
  return {
    facts: parseProbe(ran.stdout),
    layout,
    cut: ran.timedOut || ran.truncated,
    output: ran.stdout,
  };
}
