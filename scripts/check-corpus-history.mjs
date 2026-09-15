import { execFileSync } from "node:child_process";

const corpus = "v12-final:benchmarks/falsification-corpus/v10-synthetic-corpus";
try {
  execFileSync("git", ["cat-file", "-e", corpus], { stdio: "pipe" });
  process.stdout.write("historical falsification corpus is reachable at v12-final\n");
} catch {
  process.stderr.write(
    "required corpus history is unavailable. Run git fetch origin tag v12-final, then rerun npm run gates.\n",
  );
  process.exitCode = 1;
}
