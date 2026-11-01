import type { ArgumentGrammar, WordRole } from "./argument-grammars.ts";
import { readAwkProgram } from "./awk-program.ts";
import { readSedScript } from "./sed-script.ts";
import { pathsAWordCouldOpen } from "./shell-paths.ts";

/**
 * How one implementation parses options. GNU tools keep reading options after the first operand
 * and BSD tools stop there (`grep pattern -e x` searches a file called `-e` on macOS), and sed's
 * `-i` takes the next word on BSD and nothing on GNU. A word is text only where every reading
 * agrees it is; anything one reading would open is ruled on.
 */
interface Reading {
  readonly permutes: boolean;
  readonly disputedTakesNextWord: boolean;
}

const readings: readonly Reading[] = [true, false].flatMap((permutes) =>
  [false, true].map((disputedTakesNextWord) => ({ permutes, disputedTakesNextWord })),
);

interface Assigned {
  readonly role: WordRole;
  readonly text: string;
}

/**
 * The paths a program described by `grammar` could open from these arguments, or null where one
 * of them runs a command or opens a file nothing here can name.
 */
export function pathsInArguments(
  grammar: ArgumentGrammar,
  argumentsOf: readonly string[],
): readonly string[] | null {
  const paths = new Set<string>();
  for (const reading of readings) {
    const assigned = assignRoles(grammar, argumentsOf, reading);
    // An option the table does not know could take a file: every word is read as before.
    const named =
      assigned === null ? argumentsOf.flatMap(pathsAWordCouldOpen) : pathsOfRoles(assigned);
    if (named === null) {
      return null;
    }
    for (const path of named) paths.add(path);
  }
  return [...paths];
}

/** Each word's role under one reading, or null where a word is an option the grammar does not know. */
function assignRoles(
  grammar: ArgumentGrammar,
  argumentsOf: readonly string[],
  reading: Reading,
): readonly Assigned[] | null {
  const assigned: Assigned[] = [];
  const operands: string[] = [];
  let supplied = false;
  let optionsEnded = false;

  for (let index = 0; index < argumentsOf.length; index += 1) {
    const word = argumentsOf[index] ?? "";
    const next = argumentsOf[index + 1];
    if (optionsEnded || word === "-" || !word.startsWith("-")) {
      operands.push(word);
      optionsEnded ||= !reading.permutes;
      continue;
    }
    if (word === "--") {
      optionsEnded = true;
      continue;
    }

    if (word.startsWith("--")) {
      const equals = word.indexOf("=");
      const name = equals === -1 ? word.slice(2) : word.slice(2, equals);
      const value = equals === -1 ? undefined : word.slice(equals + 1);
      const valued = grammar.longValued[name];
      const attached = grammar.longAttached[name];
      if (grammar.suppliers.has(`--${name}`)) supplied = true;
      if (value === undefined && (grammar.longFlags.has(name) || attached !== undefined)) continue;
      const role = valued ?? attached;
      if (role === undefined) return null;
      if (value !== undefined) {
        assigned.push({ role, text: value });
      } else if (next !== undefined) {
        assigned.push({ role, text: next });
        index += 1;
      } else {
        return null;
      }
      continue;
    }

    for (let letter = 1; letter < word.length; letter += 1) {
      const option = word[letter] ?? "";
      const rest = word.slice(letter + 1);
      if (grammar.suppliers.has(`-${option}`)) supplied = true;
      if (grammar.flags.includes(option)) continue;
      const disputed = grammar.disputed[option];
      const separate =
        grammar.valued[option] ?? (reading.disputedTakesNextWord ? disputed : undefined);
      const role = separate ?? grammar.attached[option] ?? disputed;
      if (role === undefined) return null;
      if (rest.length > 0) {
        assigned.push({ role, text: rest });
      } else if (separate !== undefined) {
        if (next === undefined) return null;
        assigned.push({ role, text: next });
        index += 1;
      }
      break;
    }
  }

  operands.forEach((text, index) => {
    const role = index === 0 && !supplied ? grammar.firstOperand : "path";
    assigned.push({ role, text });
  });
  return assigned;
}

/** The paths the assigned words name, or null where one runs a command or opens what it computes. */
function pathsOfRoles(assigned: readonly Assigned[]): readonly string[] | null {
  const paths: string[] = [];
  const scripts = assigned.filter((word) => word.role === "sed-script").map((word) => word.text);
  const read = scripts.map(readSedScript);
  if (read.some((effects) => effects?.runsCommands === true)) return null;
  if (read.some((effects) => effects === null)) {
    // sed joins its `-e` scripts into one program, so where one cannot be followed, where the
    // others begin is not known either: all of them are read as before.
    paths.push(...scripts.flatMap(pathsAWordCouldOpen));
  } else {
    paths.push(...read.flatMap((effects) => effects?.files ?? []));
  }

  for (const { role, text } of assigned) {
    if (role === "path") {
      paths.push(...pathsAWordCouldOpen(text));
    } else if (role === "program-file") {
      // A program read from standard input is one nothing here sees.
      if (text === "-") return null;
      paths.push(...pathsAWordCouldOpen(text));
    } else if (role === "awk-program") {
      const effects = readAwkProgram(text);
      if (effects?.unreadable === true) return null;
      paths.push(...(effects === null ? pathsAWordCouldOpen(text) : effects.files));
    } else if (role === "backup-suffix" && text.includes("*") && text.includes("/")) {
      // GNU sed puts the backup where `*` is replaced by the file's name, so a suffix with a
      // slash names a directory; without `*` it is appended to a file's name and stays beside it.
      paths.push(text);
    }
  }
  return paths;
}
