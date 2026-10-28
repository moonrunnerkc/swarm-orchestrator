import { execFile } from "node:child_process";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  sign,
} from "node:crypto";

export const signingKeyVariable = "SWARM_SIGNING_KEY";
const service = "swarm-orchestrator";
const account = "bundle-signing-key";

export interface SigningKey {
  readonly source: "environment" | "keychain" | "per-run";
  readonly publicKeyPem: string;
  /** SHA-256 of the public key's SPKI DER, in hex. */
  readonly fingerprint: string;
  sign(message: Buffer): Buffer;
}

export interface ResolvedKey {
  readonly key: SigningKey;
  /** Why a durable key was not used, where one was not. */
  readonly notice: string | null;
}

type Run = (
  file: string,
  args: readonly string[],
  input?: string,
) => Promise<{ code: number; stdout: string; stderr: string }>;

const runCommand: Run = (file, args, input) =>
  new Promise((settle) => {
    const child = execFile(file, args, { timeout: 15_000 }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      settle({ code, stdout, stderr });
    });
    child.stdin?.end(input ?? "");
  });

function keyFrom(privateKey: KeyObject, source: SigningKey["source"]): SigningKey {
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new Error(`the ${source} signing key is ${privateKey.asymmetricKeyType}, not ed25519`);
  }
  const publicKey = createPublicKey(privateKey);
  const der = publicKey.export({ type: "spki", format: "der" });
  return {
    source,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
    fingerprint: createHash("sha256").update(der).digest("hex"),
    sign: (message) => sign(null, message, privateKey),
  };
}

/** A PEM private key, or base64 PKCS#8 DER as the keychain stores it. */
export function keyFromText(text: string, source: SigningKey["source"]): SigningKey {
  const trimmed = text.trim();
  const privateKey = trimmed.startsWith("-----BEGIN")
    ? createPrivateKey(trimmed)
    : createPrivateKey({ key: Buffer.from(trimmed, "base64"), format: "der", type: "pkcs8" });
  return keyFrom(privateKey, source);
}

/** The macOS keychain or the Secret Service, never the workspace. */
async function keychain(platform: string, run: Run): Promise<SigningKey | null> {
  const lookup =
    platform === "darwin"
      ? await run("security", ["find-generic-password", "-a", account, "-s", service, "-w"])
      : platform === "linux"
        ? await run("secret-tool", ["lookup", "service", service, "account", account])
        : null;
  if (lookup === null) return null;
  if (lookup.code === 0 && lookup.stdout.trim().length > 0) {
    return keyFromText(lookup.stdout, "keychain");
  }
  const created = generateKeyPairSync("ed25519").privateKey;
  const secret = created.export({ type: "pkcs8", format: "der" }).toString("base64");
  const stored =
    platform === "darwin"
      ? (await run("security", ["default-keychain"])).code === 0 &&
        // Both password prompts are answered on stdin so nothing waits on a person.
        (
          await run(
            "security",
            ["add-generic-password", "-U", "-a", account, "-s", service, "-w"],
            `${secret}\n${secret}\n`,
          )
        ).code === 0
      : (
          await run(
            "secret-tool",
            ["store", "--label=swarm signing key", "service", service, "account", account],
            secret,
          )
        ).code === 0;
  if (!stored) throw new Error("the keychain would not store a new key");
  return keyFrom(created, "keychain");
}

/**
 * SWARM_SIGNING_KEY first, then the OS keychain, then a per-run key with a notice. A per-run
 * key still binds the statement, but cannot tie two statements to one signer.
 */
export async function resolveSigningKey(
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: string = process.platform,
  run: Run = runCommand,
): Promise<ResolvedKey> {
  const fromEnvironment = env[signingKeyVariable];
  if (fromEnvironment !== undefined && fromEnvironment.trim().length > 0) {
    return { key: keyFromText(fromEnvironment, "environment"), notice: null };
  }
  try {
    const stored = await keychain(platform, run);
    if (stored !== null) return { key: stored, notice: null };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      key: keyFrom(generateKeyPairSync("ed25519").privateKey, "per-run"),
      notice: `the OS keychain could not be used (${reason}), so a per-run key signed this`,
    };
  }
  return {
    key: keyFrom(generateKeyPairSync("ed25519").privateKey, "per-run"),
    notice: "no OS keychain on this platform, so a per-run key signed this",
  };
}
