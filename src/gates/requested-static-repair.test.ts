import { expect, it } from "vitest";
import { staticRepairRequested } from "./requested-static-repair.ts";

const lint = { id: "lint", command: "npm run --loglevel=error lint" };
const ufoLint = { id: "lint", command: "eslint . && prettier -c src test" };
const typecheck = { id: "typecheck", command: "npx tsc --noEmit" };

it("finds a sentence that asks for a static check's failure fixed", () => {
  expect(
    staticRepairRequested("Fix the ESLint error in src/legacy.mjs. Then add the option.", lint),
  ).toBe("Fix the ESLint error in src/legacy.mjs.");
  expect(
    staticRepairRequested("Make `npm run lint` pass again; the base fails it.", lint),
  ).not.toBeNull();
  expect(staticRepairRequested("Resolve the type errors in src/a.ts.", typecheck)).not.toBeNull();
  // A tool the gate's command runs names the gate as well as its id does.
  expect(staticRepairRequested("Clean up the Prettier warnings in src/.", ufoLint)).not.toBeNull();
});

it("leaves the default where the task mentions a static check without asking for it fixed", () => {
  // The October 23 ufo tasks name lint and Prettier only to say they already fail.
  expect(
    staticRepairRequested(
      "Fix both functions so that the base counts as present only at a boundary. The project's tests run with npx vitest run --typecheck (npm test runs pnpm lint first; on the unchanged base under this install, prettier already reports src/punycode.ts, so lint is not part of the required test command).",
      ufoLint,
    ),
  ).toBeNull();
  expect(
    staticRepairRequested("Do not fix the existing lint warnings; add the option.", lint),
  ).toBeNull();
  expect(staticRepairRequested("Fix the parser.", lint)).toBeNull();
  // A tool's name elsewhere in a sentence with a repair verb is not that verb's object.
  expect(
    staticRepairRequested(
      'What must not change: require("nanoid") and every subpath (format, random, generate, url) still resolve, now to the moved modules.',
      ufoLint,
    ),
  ).toBeNull();
  expect(staticRepairRequested(undefined, lint)).toBeNull();
  // A gate that is no static check of these kinds is never matched.
  expect(staticRepairRequested("Fix the lint error.", { id: "tests", command: "npm test" })).toBe(
    null,
  );
});
