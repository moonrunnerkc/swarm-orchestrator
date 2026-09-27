import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

it("provisions the pinned runner's browser before clean-runner gates", () => {
  for (const name of ["gates", "nightly-proof", "publish", "publish-verify"]) {
    const workflow = readFileSync(
      new URL(`../.github/workflows/${name}.yml`, import.meta.url),
      "utf8",
    );
    expect(workflow).toContain("npx playwright install --with-deps chromium");
    expect(workflow).toContain("docker build -t swarm-upgrade-browser:20260927");
    const gate = workflow.indexOf("run: npm run gates");
    if (gate !== -1)
      expect(workflow.indexOf("npx playwright install --with-deps chromium")).toBeLessThan(gate);
  }
});
it("does not make scheduled failure notification depend on a repository label", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/nightly-proof.yml", import.meta.url),
    "utf8",
  );
  expect(workflow).toContain("gh issue create");
  expect(workflow).not.toContain("--label");
  expect(workflow).toContain("if: failure() && github.event_name == 'schedule'");
});
