#!/usr/bin/env node
// Checks a swarm-verify attestation with nothing but Node: the DSSE signature over the in-toto
// Statement, and the subject digests recomputed from the files you name.
//
//   node verify.mjs <attestation.sigstore.json> --key <public.pem> [--patch <file>] [--tree <dir>]
//
// Exit 0 when the signature verifies and every named file matches its subject, 1 when anything
// does not, 2 for a command line it cannot read. The verdict inside is printed, not enforced.
import { createHash, createPublicKey, verify } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join, relative, sep } from "node:path";

const payloadType = "application/vnd.in-toto+json";
const statementType = "https://in-toto.io/Statement/v1";
const predicateType = "https://swarm-verify.dev/verdict/v1";

function usage(problem) {
  process.stderr.write(
    `${problem}\nusage: node verify.mjs <attestation> --key <public.pem> [--patch <file>] [--tree <dir>]\n`,
  );
  process.exit(2);
}

function parse(argv) {
  const options = { attestation: null, key: null, patch: null, tree: null };
  for (let at = 0; at < argv.length; at += 1) {
    const word = argv[at];
    const flag = /^--(key|patch|tree)$/.exec(word);
    if (flag !== null) {
      if (argv[at + 1] === undefined) usage(`${word} needs a value`);
      options[flag[1]] = argv[++at];
    } else if (word.startsWith("--")) usage(`unknown option ${word}`);
    else if (options.attestation === null) options.attestation = word;
    else usage(`unexpected argument ${word}`);
  }
  if (options.attestation === null) usage("name the attestation to check");
  if (options.key === null)
    usage("--key is required: a signature means nothing without the expected signer");
  return options;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** DSSE pre-authentication encoding. */
function pae(type, body) {
  return Buffer.concat([
    Buffer.from(`DSSEv1 ${Buffer.byteLength(type)} ${type} ${body.length} `),
    body,
  ]);
}

/** The same digest swarm-verify computes: `<mode> <sha256> <path>` per file, sorted by path. */
function treeDigest(root) {
  const entries = [];
  const walk = (directory) => {
    for (const name of readdirSync(directory)) {
      if (name === ".git") continue;
      const path = join(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory()) walk(path);
      else if (stat.isSymbolicLink() || stat.isFile()) {
        const mode = stat.isSymbolicLink() ? "120000" : stat.mode & 0o111 ? "100755" : "100644";
        const content = stat.isSymbolicLink()
          ? Buffer.from(readlinkSync(path))
          : readFileSync(path);
        const name = relative(root, path).split(sep).join("/");
        entries.push({ path: Buffer.from(name), line: `${mode} ${sha256(content)} ${name}\n` });
      }
    }
  };
  walk(root);
  entries.sort((a, b) => Buffer.compare(a.path, b.path));
  return sha256(entries.map((entry) => entry.line).join(""));
}

const options = parse(process.argv.slice(2));
const results = [];
const check = (name, ok, detail) => results.push({ name, ok, detail });

let document;
try {
  document = JSON.parse(readFileSync(options.attestation, "utf8"));
} catch (error) {
  usage(`${options.attestation} is not readable JSON: ${error.message}`);
}
const envelope = document?.dsseEnvelope ?? document;
const signatures = Array.isArray(envelope?.signatures) ? envelope.signatures : [];
check(
  "envelope",
  envelope?.payloadType === payloadType && typeof envelope?.payload === "string",
  envelope?.payloadType ?? "missing",
);

const body = Buffer.from(typeof envelope?.payload === "string" ? envelope.payload : "", "base64");
const key = createPublicKey(readFileSync(options.key));
const signed = signatures.some((signature) => {
  try {
    return verify(null, pae(payloadType, body), key, Buffer.from(signature.sig, "base64"));
  } catch {
    return false;
  }
});
check(
  "signature",
  signed,
  signed ? "verifies under the given key" : "does not verify under the given key",
);

let statement = null;
try {
  statement = JSON.parse(body.toString("utf8"));
} catch {
  check("statement", false, "the payload is not JSON");
}
if (statement !== null) {
  check(
    "statement",
    statement._type === statementType && statement.predicateType === predicateType,
    `${statement._type} with ${statement.predicateType}`,
  );
  const subjects = Array.isArray(statement.subject) ? statement.subject : [];
  const digestOf = (match) => subjects.find(match)?.digest?.sha256;
  if (options.patch !== null) {
    const expected = digestOf((subject) => subject.name !== "tree");
    const actual = sha256(readFileSync(options.patch));
    check("patch", actual === expected, `sha256:${actual}`);
  }
  if (options.tree !== null) {
    const actual = treeDigest(options.tree);
    check("tree", actual === digestOf((subject) => subject.name === "tree"), `sha256:${actual}`);
  }
}

for (const result of results) {
  process.stdout.write(
    `${result.ok ? "ok    " : "FAILED"} ${result.name.padEnd(9)} ${result.detail}\n`,
  );
}
const predicate = statement?.predicate;
if (signed && predicate !== undefined) {
  process.stdout.write(
    `verdict   ${predicate.verdict}${predicate.reasons?.length ? `: ${predicate.reasons.join("; ")}` : ""}\n`,
  );
}
process.exitCode = results.every((result) => result.ok) ? 0 : 1;
