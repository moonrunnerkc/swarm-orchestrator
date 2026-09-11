import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { networkInterfaces } from "node:os";

/** A short-lived synthetic endpoint, closed before the containment self-test returns. */
export async function controlledNetworkTarget() {
  const address = Object.values(networkInterfaces())
    .flat()
    .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address;
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
  return {
    script: `const s=require("node:net").connect(${binding.port},${JSON.stringify(address)});let value="";s.setTimeout(2000);s.on("data",b=>value+=b);s.on("end",()=>{if(value===${JSON.stringify(challenge)})process.stdout.write("connected")});s.on("error",()=>{});s.on("timeout",()=>s.destroy());`,
    close: () => new Promise<void>((resolve) => listener.close(() => resolve())),
  };
}
