import { execFile } from "node:child_process";
import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { z } from "zod";

export const bundleSignatureSchema = z.object({
  algorithm: z.literal("ed25519"),
  /** SPKI DER, base64. The verifier needs nothing else to check the signature. */
  publicKey: z.string().min(1),
  value: z.string().min(1),
  /** Whether the key survives across runs. A reviewer should see when it does not. */
  keySource: z.enum(["keychain", "ephemeral"]),
});

type BundleSignature = z.infer<typeof bundleSignatureSchema>;

type SigningKeySource = BundleSignature["keySource"];

export interface SigningKey {
  readonly source: SigningKeySource;
  readonly publicKeySpki: string;
  sign(message: string): string;
}

interface SecretStore {
  readonly description: string;
  load(): Promise<string | null>;
  save(secret: string): Promise<void>;
}

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export type CommandRunner = (
  file: string,
  args: readonly string[],
  input?: string,
) => Promise<CommandResult>;

const signingKeyService = "swarm-orchestrator";
const signingKeyAccount = "bundle-signing-key";

/**
 * The OS keychain, never the workspace (invariant 11). macOS uses security, Linux uses
 * secret-tool; anywhere else there is no keychain to reach and the caller falls back.
 */
export function createKeychainSecretStore(options: {
  readonly platform: string;
  readonly run?: CommandRunner;
  readonly service?: string;
  readonly account?: string;
}): SecretStore | null {
  const run = options.run ?? runCommand;
  const service = options.service ?? signingKeyService;
  const account = options.account ?? signingKeyAccount;

  if (options.platform === "darwin") {
    return {
      description: "the macOS keychain",
      async load(): Promise<string | null> {
        const result = await run("security", [
          "find-generic-password",
          "-a",
          account,
          "-s",
          service,
          "-w",
        ]);
        return result.code === 0 ? result.stdout.trim() : null;
      },
      async save(secret: string): Promise<void> {
        // The secret goes over stdin rather than argv, which would expose it to ps. `-w` with
        // no value asks twice, for the value and then to retype it, and reads both from stdin:
        // sending it once satisfied the first ask, gave the second end-of-input, and left
        // `security` printing "password data for new item:" at a person who had nothing to
        // type, because this key is generated here and was never theirs to know. Both asks are
        // answered, so nothing is ever waited on. The prompts go to stderr, which is captured.
        const result = await run(
          "security",
          ["add-generic-password", "-U", "-a", account, "-s", service, "-w"],
          `${secret}\n${secret}\n`,
        );
        if (result.code !== 0) {
          throw new Error(`security add-generic-password failed: ${result.stderr.trim()}`);
        }
      },
    };
  }

  if (options.platform === "linux") {
    return {
      description: "the Secret Service keyring",
      async load(): Promise<string | null> {
        const result = await run("secret-tool", ["lookup", "service", service, "account", account]);
        return result.code === 0 && result.stdout.length > 0 ? result.stdout.trim() : null;
      },
      async save(secret: string): Promise<void> {
        const result = await run(
          "secret-tool",
          ["store", "--label=swarm bundle signing key", "service", service, "account", account],
          secret,
        );
        if (result.code !== 0) {
          throw new Error(`secret-tool store failed: ${result.stderr.trim()}`);
        }
      },
    };
  }

  return null;
}

interface ResolvedSigningKey {
  readonly key: SigningKey;
  /** Non-null when the keychain could not be used, so the CLI can say why in one line. */
  readonly notice: string | null;
}

/**
 * Prefers a durable keychain key and falls back to a per-process one rather than failing
 * the export. Be precise about what either proves: the signature is tamper-evidence after
 * the bundle leaves this machine, not evidence against a compromised producer, and an
 * ephemeral key additionally cannot tie two bundles to the same signer.
 */
export async function resolveSigningKey(store: SecretStore | null): Promise<ResolvedSigningKey> {
  if (store === null) {
    return {
      key: createEphemeralSigningKey(),
      notice: "no OS keychain on this platform, so the bundle is signed with a per-run key",
    };
  }

  let existing: string | null;
  try {
    existing = await store.load();
  } catch (cause) {
    return {
      key: createEphemeralSigningKey(),
      notice:
        `${store.description} could not be read (${describeCause(cause)}), ` +
        "so the bundle is signed with a per-run key",
    };
  }

  if (existing !== null && existing.length > 0) {
    try {
      return { key: signingKeyFromPkcs8(existing, "keychain"), notice: null };
    } catch (cause) {
      // Reached, and worth its own message: the entry is there and holds something that is
      // not a key. Left alone rather than replaced, because overwriting an entry whose
      // contents nobody recognizes is destroying something to fix a signature. Every run
      // downgrades to a per-run key until a person looks, so the notice has to say what to
      // look at rather than repeat an ASN.1 decoding error.
      return {
        key: createEphemeralSigningKey(),
        notice:
          `${store.description} holds an entry under ${signingKeyService}/${signingKeyAccount} ` +
          `that is not an ed25519 private key (${describeCause(cause)}), so the bundle is ` +
          "signed with a per-run key. Delete that entry and the next run will store a new " +
          "key; nothing else reads it",
      };
    }
  }

  try {
    const created = generateKeyPairSync("ed25519");
    const pkcs8 = created.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    await store.save(pkcs8);
    return { key: signingKeyFromPkcs8(pkcs8, "keychain"), notice: null };
  } catch (cause) {
    return {
      key: createEphemeralSigningKey(),
      notice:
        `${store.description} would not take a new key (${describeCause(cause)}), ` +
        "so the bundle is signed with a per-run key",
    };
  }
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createEphemeralSigningKey(): SigningKey {
  const pair = generateKeyPairSync("ed25519");
  return keyFrom(pair.privateKey, "ephemeral");
}

export function signingKeyFromPkcs8(pkcs8Base64: string, source: SigningKeySource): SigningKey {
  const privateKey = createPrivateKey({
    key: Buffer.from(pkcs8Base64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return keyFrom(privateKey, source);
}

export function signChainHead(chainHead: string, key: SigningKey): BundleSignature {
  return {
    algorithm: "ed25519",
    publicKey: key.publicKeySpki,
    value: key.sign(chainHead),
    keySource: key.source,
  };
}

export function verifyChainHeadSignature(chainHead: string, signature: BundleSignature): boolean {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(signature.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verifyBytes(
      null,
      Buffer.from(chainHead, "utf8"),
      publicKey,
      Buffer.from(signature.value, "base64"),
    );
  } catch {
    return false;
  }
}

function keyFrom(privateKey: KeyObject, source: SigningKeySource): SigningKey {
  const publicKeySpki = createPublicKey(privateKey)
    .export({ type: "spki", format: "der" })
    .toString("base64");

  return {
    source,
    publicKeySpki,
    sign: (message: string) =>
      signBytes(null, Buffer.from(message, "utf8"), privateKey).toString("base64"),
  };
}

function runCommand(file: string, args: readonly string[], input?: string): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = execFile(file, [...args], (error, stdout, stderr) => {
      const code =
        error === null ? 0 : ((error as NodeJS.ErrnoException & { code?: number }).code ?? 1);
      resolve({ stdout, stderr, code: typeof code === "number" ? code : 1 });
    });
    if (input !== undefined) {
      child.stdin?.end(input);
    }
  });
}
