import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

/** A short-lived synthetic endpoint, closed before the containment self-test returns. */
export async function controlledNetworkTarget() {
  let address: string | undefined;
  try {
    address = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
  } catch {
    // Some hosts refuse enumeration. No reachable control means no network measurement.
    return null;
  }
  if (address === undefined) return null;
  const challenge = randomUUID();
  const listener = createServer((socket) => socket.end(challenge));
  try {
    await new Promise<void>((resolve, reject) => {
      listener.once("error", reject);
      listener.listen(0, address, () => resolve());
    });
  } catch {
    return null;
  }
  const binding = listener.address();
  if (binding === null || typeof binding === "string") {
    listener.close();
    return null;
  }
  const script = `const s=require("node:net").connect(${binding.port},${JSON.stringify(address)});let value="";s.setTimeout(2000);s.on("data",b=>value+=b);s.on("end",()=>{if(value===${JSON.stringify(challenge)})process.stdout.write("connected")});s.on("error",()=>{});s.on("timeout",()=>s.destroy());`;
  const python = `import socket,sys\ns=socket.socket();s.settimeout(2)\ntry:\n s.connect((${JSON.stringify(address)},${binding.port}));v=b""\n while True:\n  b=s.recv(4096)\n  if not b: break\n  v+=b\n if v.decode()==${JSON.stringify(challenge)}: sys.stdout.write("connected")\nexcept Exception: pass`;
  const bash = `exec 3<>/dev/tcp/${address}/${binding.port} 2>/dev/null || exit 0; IFS= read -r -t 2 -n ${challenge.length} v <&3; [ "$v" = ${shellQuoted(challenge)} ] && printf connected; exit 0`;
  return {
    script,
    /**
     * The same attempt for an image that carries no node: node where present, else python3,
     * else bash's /dev/tcp. An image with none of them exits ${noProbeProgramExit} with a named
     * reason, which the self-test reads as unmeasured rather than as contained.
     */
    shellScript:
      `if command -v node >/dev/null 2>&1; then exec node -e ${shellQuoted(script)}; ` +
      `elif command -v python3 >/dev/null 2>&1; then exec python3 -c ${shellQuoted(python)}; ` +
      `elif command -v bash >/dev/null 2>&1; then exec bash -c ${shellQuoted(bash)}; ` +
      `else printf '%s\\n' ${shellQuoted(noProbeProgramReason)} >&2; exit ${noProbeProgramExit}; fi`,
    close: () => new Promise<void>((resolve) => listener.close(() => resolve())),
  };
}

/** Exit status and reason a probe script uses when the image has no program to attempt it. */
export const noProbeProgramExit = 78;
export const noProbeProgramReason = "no program in this image can attempt the connection";

/** One shell word, single-quoted, for /bin/sh. */
export function shellQuoted(text: string): string {
  return `'${text.replaceAll("'", "'\\''")}'`;
}
