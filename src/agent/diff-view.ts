import { diffSections } from "./context.ts";

/** Below this a file's share holds no more than its header, so the files are listed instead. */
const smallestShare = 400;

const headerLine =
  /^(diff --git |new file mode|deleted file mode|old mode|new mode|similarity index|rename (from|to) |copy (from|to) |index |--- |\+\+\+ )/;

function counts(section: string): string {
  let plus = 0;
  let minus = 0;
  for (const line of section.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++ ")) plus += 1;
    if (line.startsWith("-") && !line.startsWith("--- ")) minus += 1;
  }
  return `+${plus} -${minus}`;
}

/** One file's section in at most `bytes`: its header whole, then the start and end of its hunks. */
function cut(path: string, section: string, bytes: number): string {
  if (Buffer.byteLength(section) <= bytes) return section;
  const lines = section.split("\n");
  const split = lines.findIndex((line) => !headerLine.test(line));
  const head = split === -1 ? lines : lines.slice(0, split);
  const body = split === -1 ? [] : lines.slice(split);
  const marker = (omitted: number) =>
    `[... ${omitted} lines of ${path}'s change omitted; git diff -- ${path} shows them ...]`;
  let room = bytes - Buffer.byteLength(`${head.join("\n")}\n${marker(body.length)}\n`);
  const front: string[] = [];
  const back: string[] = [];
  // Whole lines from the front and the back in turn, so both ends of the change stay in view.
  for (let at = 0, end = body.length - 1; at <= end; ) {
    const fromFront = front.length <= back.length;
    const line = body[fromFront ? at : end] ?? "";
    const size = Buffer.byteLength(line) + 1;
    if (size > room) break;
    room -= size;
    if (fromFront) {
      front.push(line);
      at += 1;
    } else {
      back.unshift(line);
      end -= 1;
    }
  }
  return [...head, ...front, marker(body.length - front.length - back.length), ...back].join("\n");
}

/**
 * The diff as a turn shows it, within `cap` bytes, with every changed file named under its own
 * header. Cut from the middle as a whole, a diff loses the headers between its ends, and the
 * end of the last file's change reads as part of the first file's: t6 (session
 * 20261103T213819-76ab1e) read the second re-export shim as written into the first file and
 * reread that file until the run stopped. Each file gets a share of the cap instead; a small
 * file keeps all of its change and leaves the rest to the larger ones.
 */
export function diffView(diff: string, cap: number): string {
  if (Buffer.byteLength(diff) <= cap) return diff;
  const sections = [...diffSections(diff)];
  const listing = [
    `The diff is longer than ${cap} bytes, so each file's change is shortened. Changed files:`,
    ...sections.map(([path, section]) => `- ${path} (${counts(section)} lines)`),
  ].join("\n");
  let left = cap - Buffer.byteLength(listing) - 2;
  if (left < sections.length * smallestShare) {
    return `${listing}\n(git diff -- <path> shows one file's change)`.slice(0, cap);
  }
  const bySize = sections
    .map(([path, section], order) => ({ path, section, order }))
    .sort((a, b) => Buffer.byteLength(a.section) - Buffer.byteLength(b.section));
  const shown = new Map<number, string>();
  for (const [index, one] of bySize.entries()) {
    const share = Math.floor((left - (bySize.length - index - 1)) / (bySize.length - index));
    const text = cut(one.path, one.section, share);
    shown.set(one.order, text);
    left -= Buffer.byteLength(text) + 1;
  }
  return [listing, "", ...sections.map((_, order) => shown.get(order) ?? "")].join("\n");
}
