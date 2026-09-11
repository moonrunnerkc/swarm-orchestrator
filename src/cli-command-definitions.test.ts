import { expect, it } from "vitest";
import { commandDefinitions } from "./cli-command-definitions.ts";
import { parseCommandLine, usage } from "./cli-options.ts";

it("every documented command has an explicit packaged behavior contract", () => {
  expect(new Set(commandDefinitions.map((command) => command.name)).size).toBe(
    commandDefinitions.length,
  );
  for (const command of commandDefinitions) {
    expect(usage).toContain(`swarm ${command.syntax}`);
    expect(command.smoke.output.length).toBeGreaterThan(0);
    expect(command.smoke.exits.length).toBeGreaterThan(0);
  }
  expect(
    parseCommandLine(
      ["ci", "--patch", "p.diff", "--contract", "checks.json", "--isolation", "docker"],
      { currentDirectory: "/repo" },
    ),
  ).toMatchObject({ command: "ci", acceptanceContract: "/repo/checks.json", isolation: "docker" });
});
