/**
 * A shell command reduced to what it does, so two spellings of one command compare equal.
 *
 * The derivation heuristic matches text, and text is what a rephrase changes: a command copied
 * out of a file with flags inserted and `sh` swapped for `bash` shares too few tokens with the
 * original to reach an n-gram threshold, and lowering that threshold flags every command that
 * happens to mention a filename the model read. Canonicalizing instead adds an exact channel
 * beside the fuzzy one: the whole command has to reduce to the same thing, which is far
 * narrower than partial overlap and catches the rephrase the overlap misses.
 *
 * What is normalized is what a rephrase varies and a shell does not care about: the order of
 * operands, the quoting around them, the leading environment assignments, and which member of
 * an interpreter family was named. Flags are dropped rather than sorted, because inserting
 * flags is the rephrase itself and `curl -fsSL URL` fetches what `curl URL` fetches.
 *
 * Null wherever the text does not settle into a command, which is most prose. Null means this
 * channel says nothing and the overlap channel decides, so a miss here costs nothing that was
 * not already missed.
 */

const stageSeparator = /\|\||&&|[|;]/;

/** Members of one family that a rephrase swaps for each other. */
const interpreterFamilies: Readonly<Record<string, string>> = {
  sh: "sh",
  bash: "sh",
  zsh: "sh",
  dash: "sh",
  ksh: "sh",
  ash: "sh",
  python: "python",
  python2: "python",
  python3: "python",
  node: "node",
  nodejs: "node",
};

const environmentAssignment = /^[A-Za-z_][\w]*=/;

/**
 * A token that could name a program. Lower case unless it carries a path, because that is what
 * separates `curl` from `Before`: prose starts its sentences with a capital and commands do
 * not, and a line of prose read as a command is how this channel would start matching things
 * nobody wrote as commands.
 */
const programName = /^(?:[a-z0-9_@.+-]+|[A-Za-z0-9_@./+-]*\/[A-Za-z0-9_@./+-]+)$/;

/**
 * Punctuation that ends a sentence rather than an argument. A word ending in one of these is
 * prose: `run:` and `else,` are not operands, and no shell word this needs to read ends that
 * way. A bare `.` is left alone, since `cd .` is a real command.
 */
const sentenceEnding = /[,:;!?]$/;

export function canonicalShellCommand(command: string): string | null {
  const stages = command
    .split(stageSeparator)
    .map((stage) => canonicalStage(stage))
    .filter((stage): stage is CanonicalStage => stage !== null);

  if (stages.length === 0) {
    return null;
  }
  // A single bare program carries too little to attribute anything to. Requiring either an
  // operand or a second stage is what keeps a one-word line of prose from matching a one-word
  // command, and it costs only commands nobody would need this channel for.
  if (stages.length === 1 && (stages[0]?.operands.length ?? 0) === 0) {
    return null;
  }

  return stages.map((stage) => [stage.program, ...stage.operands].join(" ")).join(" | ");
}

interface CanonicalStage {
  readonly program: string;
  /** Sorted, unquoted, and without the flags: what the stage acts on. */
  readonly operands: readonly string[];
}

function canonicalStage(stage: string): CanonicalStage | null {
  const tokens = tokenize(stage);
  // Leading `NAME=value` is the shell setting the environment, not the command being run.
  while (tokens.length > 0 && environmentAssignment.test(tokens[0] ?? "")) {
    tokens.shift();
  }
  const first = tokens.shift();
  if (first === undefined) {
    return null;
  }
  const program = programOf(first);
  if (program === null) {
    return null;
  }

  const words = tokens.map((token) => unquoted(token)).filter((word) => word.length > 0);
  if (words.some((word) => sentenceEnding.test(word))) {
    return null;
  }

  return {
    program,
    // Flags dropped rather than sorted: inserting them is the rephrase, and `curl -fsSL URL`
    // fetches what `curl URL` fetches. What is not attempted is separating a flag's own value
    // from an operand, which needs each flag's arity: `-n 5` leaves `5` here.
    operands: words.filter((word) => !word.startsWith("-")).sort(),
  };
}

/** The command's own name: path and interpreter family both folded away. */
function programOf(token: string): string | null {
  const bare = unquoted(token);
  if (!programName.test(bare)) {
    return null;
  }
  const name = bare.slice(bare.lastIndexOf("/") + 1);
  return interpreterFamilies[name] ?? name;
}

/** Whitespace-separated words, with a quoted run counting as one word. */
function tokenize(stage: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote = "";

  for (const character of stage.trim()) {
    if (quote !== "") {
      current += character;
      if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (/\s/.test(character)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += character;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

function unquoted(token: string): string {
  const quoted = /^(['"])([\s\S]*)\1$/.exec(token);
  return quoted === null ? token : (quoted[2] ?? "");
}

/**
 * Every line of the content read as a command, keeping the ones that settle into one. A line
 * a prompt marker or an indent introduces is the shape a README writes a command in, so those
 * are stripped before the reading.
 */
export function canonicalCommandsIn(content: string): ReadonlySet<string> {
  const found = new Set<string>();
  for (const line of content.split("\n")) {
    const candidate = line.trim().replace(/^[$>#]\s+/, "");
    const canonical = canonicalShellCommand(candidate);
    if (canonical !== null) {
      found.add(canonical);
    }
  }
  return found;
}
