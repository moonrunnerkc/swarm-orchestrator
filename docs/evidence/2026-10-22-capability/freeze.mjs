import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { harnessDigest } from "../../../scripts/comparison/harness-identity.mjs";
const directory = import.meta.dirname;
const source = JSON.parse(readFileSync(join(directory, "../2026-10-22/control-amended/manifest.json")));
const digest = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const cli = join(homedir(), ".cache/swarm-comparison/tools/swarm-f07cd0861/dist/cli.js");
for (const treatment of [false, true]) {
  const manifest = {...source, frozenAt: new Date().toISOString(),
    protocolDigest: digest(readFileSync(join(directory, "protocol.md"))),
    pins: {...source.pins, swarmRevision: "f07cd0861c3be79087baffabbb1238b38e3e37eb", swarmCli: cli,
      swarmCliDigest: digest(readFileSync(cli)), swarmFlags: treatment ? ["--repair-finish"] : [],
      opencode: "1.19.4", harnessDigest: harnessDigest()},
    tasks: source.tasks.filter(t => t.id === "entities-bugfix-restore-get-code-point"),
    launches: treatment
      ? [{task: "entities-bugfix-restore-get-code-point", arm: "swarm", order: 6}]
      : [{task: "entities-bugfix-restore-get-code-point", arm: "opencode", order: 1},
          {task: "entities-bugfix-restore-get-code-point", arm: "swarm", order: 5}],
  };
  writeFileSync(join(directory, `${treatment ? "treatment" : "control"}.json`), JSON.stringify(manifest, null, 2));
}
