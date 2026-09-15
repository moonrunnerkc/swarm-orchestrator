/**
 * Imported first by the CLI, before the command composition loads, so a runtime below the floor
 * stops with one line rather than with whatever syntax it fails to parse first. The floor
 * itself lives in node-floor.ts with no side effect, so the gates can read it.
 */
import { nodeFloorShortfall } from "./node-floor.ts";

const shortfall = nodeFloorShortfall(process.version);
if (shortfall !== null) {
  process.stderr.write(`${shortfall}\n`);
  process.exit(1);
}
