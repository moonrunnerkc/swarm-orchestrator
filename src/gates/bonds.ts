import type { ProjectType } from "./project-type.ts";

/**
 * A falsification bond: one change the harness makes to the tree that a working check has
 * to refuse. A check that passed on the run's tree and still passes with the bond in place
 * has not been shown capable of failing, and a pass that cannot fail is not a pass.
 *
 * Every bond is an added file and never an edit, so removing it restores the tree exactly.
 * Bonds are data, keyed by gate id and by the project type that decides what a runner
 * discovers, and the engine runs whichever one a gate has without knowing what any gate is
 * for (invariant 6). A gate with no bond here is recorded as not bonded rather than as
 * bonded and held.
 */
export interface BondDefinition {
  /** What the bond does, in one sentence, for the record and the review page. */
  readonly description: string;
  readonly files: readonly { readonly path: string; readonly content: string }[];
  /**
   * Whether the harness knows the bond reached the check. An inspection reads a change set
   * the harness computed, so a bond file in that set was seen and a pass over it is vacuous.
   * A command decides for itself which files it reads, and a pass may mean the bond was
   * never opened; the tests gate can tell the two apart by the count it collected, and the
   * rest cannot, which the verdict says.
   */
  readonly provable: boolean;
}

/** The name every bond file carries, so nothing a project already has is ever overwritten. */
const bondStem = "swarm-falsification-bond";

const failingTestByType: Readonly<Record<ProjectType, { path: string; content: string }>> = {
  node: {
    // A throw at module scope fails under every runner that loads the file, rather than
    // under the one runner whose test API this could name.
    path: `${bondStem}.test.js`,
    content: `throw new Error("swarm falsification bond: a test file that must fail");\n`,
  },
  python: {
    path: `test_${bondStem.replaceAll("-", "_")}.py`,
    content: "def test_swarm_falsification_bond():\n    assert False, 'swarm falsification bond'\n",
  },
  go: {
    path: `${bondStem.replaceAll("-", "")}/bond_test.go`,
    content:
      'package swarmfalsificationbond\n\nimport "testing"\n\nfunc TestSwarmFalsificationBond(t *testing.T) {\n\tt.Fatal("swarm falsification bond")\n}\n',
  },
  rust: {
    path: `tests/${bondStem.replaceAll("-", "_")}.rs`,
    content:
      '#[test]\nfn swarm_falsification_bond() {\n    panic!("swarm falsification bond");\n}\n',
  },
};

const typeErrorByType: Partial<Record<ProjectType, { path: string; content: string }>> = {
  python: { path: `${bondStem.replaceAll("-", "_")}.py`, content: 'bond: int = "not an int"\n' },
  go: {
    path: `${bondStem.replaceAll("-", "")}/bond.go`,
    content: 'package swarmfalsificationbond\n\nvar bond int = "not an int"\n',
  },
};

const lintOffenceByType: Partial<Record<ProjectType, { path: string; content: string }>> = {
  python: { path: `${bondStem.replaceAll("-", "_")}.py`, content: "import os\n" },
  go: {
    path: `${bondStem.replaceAll("-", "")}/bond.go`,
    content:
      'package swarmfalsificationbond\n\nimport "fmt"\n\nfunc bond() {\n\tfmt.Printf("%d", "not a number")\n}\n',
  },
};

const formatOffenceByType: Partial<Record<ProjectType, { path: string; content: string }>> = {
  python: { path: `${bondStem.replaceAll("-", "_")}.py`, content: "x=1\n" },
  go: {
    path: `${bondStem.replaceAll("-", "")}/bond.go`,
    content: "package swarmfalsificationbond\n\nfunc   bond()   {   }\n",
  },
};

/** The four inspections read a change set the harness computed, so one file each is enough. */
const inspectionBonds: Readonly<Record<string, (budget: number) => BondDefinition>> = {
  placeholder: () => ({
    description: "adds a file whose only line carries a TODO marker",
    files: [{ path: `${bondStem}.js`, content: "// TODO: swarm falsification bond\n" }],
    provable: true,
  }),
  "secret-scan": () => ({
    description: "adds a file assigning a credential-shaped token to a credential-bearing name",
    files: [
      {
        path: `${bondStem}.env.example.js`,
        content: 'const github_token = "ghp_SwarmFalsificationBond0000000000000000";\n',
      },
    ],
    provable: true,
  }),
  "file-set": () => ({
    description: "adds a file no declaration named",
    files: [{ path: `${bondStem}.txt`, content: "swarm falsification bond\n" }],
    provable: true,
  }),
  "diff-budget": (maxAddedLines) => ({
    description: `adds a file of ${maxAddedLines + 1} lines, one over the added-line budget`,
    files: [
      {
        path: `${bondStem}.txt`,
        content: `${Array.from({ length: maxAddedLines + 1 }, (_, index) => `bond line ${index + 1}`).join("\n")}\n`,
      },
    ],
    provable: true,
  }),
};

export interface BondLookupInput {
  readonly gateId: string;
  readonly detectedTypes: readonly ProjectType[];
  readonly maxAddedLines: number;
}

/**
 * The bond for one gate, or null where none is defined. A polyglot gate id carries its type
 * after a colon; a plain id on a single-type project takes that type.
 */
export function bondFor(input: BondLookupInput): BondDefinition | null {
  const [base = "", suffix] = input.gateId.split(":");
  const inspection = inspectionBonds[base];
  if (inspection !== undefined) {
    return inspection(input.maxAddedLines);
  }
  const type = (suffix ?? input.detectedTypes[0]) as ProjectType | undefined;
  if (type === undefined) {
    return null;
  }
  switch (base) {
    case "tests":
      return {
        description: "adds a test file that must fail",
        files: [failingTestByType[type]],
        provable: false,
      };
    case "typecheck":
      return fromTable(typeErrorByType[type], "adds a file carrying a type error");
    case "lint":
      return fromTable(lintOffenceByType[type], "adds a file the linter has to refuse");
    case "format":
      return fromTable(formatOffenceByType[type], "adds a file the formatter has to refuse");
    default:
      return null;
  }
}

function fromTable(
  file: { path: string; content: string } | undefined,
  description: string,
): BondDefinition | null {
  return file === undefined ? null : { description, files: [file], provable: false };
}

export type BondVerdict = "held" | "vacuous" | "unshown" | "not-measured";

/**
 * What the bond showed. Held: the check refused the bond. Vacuous: the check passed over a
 * bond it demonstrably saw, so it cannot fail. Unshown: the check passed and nothing shows
 * whether it saw the bond. Not measured: the check could not run at all.
 */
export function bondVerdict(input: {
  readonly observed: "passed" | "failed" | "not-applicable";
  readonly provable: boolean;
  readonly collectedBefore: number | null;
  readonly collectedAfter: number | null;
}): BondVerdict {
  if (input.observed === "not-applicable") {
    return "not-measured";
  }
  if (input.observed === "failed") {
    return "held";
  }
  if (input.provable) {
    return "vacuous";
  }
  if (
    input.collectedBefore !== null &&
    input.collectedAfter !== null &&
    input.collectedAfter > input.collectedBefore
  ) {
    return "vacuous";
  }
  return "unshown";
}
