// Hidden behaviour check for entities-bugfix-restore-get-code-point: every example the task text
// states and representative cases beyond them, the required ones (the restored export) and the ones
// that must not change (the other exports and their outputs). Written into the scoring checkout
// under acceptance/hidden/ and run there with tsx; never in an arm's workspace. Exits 1 naming
// every case that does not hold.
import * as escape from "../../src/escape.ts";
import * as index from "../../src/index.ts";

const sample = `<a href="x">'&'</a> 💯 ü`;
const same = (a: unknown, b: unknown) =>
  (Number.isNaN(a) && Number.isNaN(b)) || JSON.stringify(a) === JSON.stringify(b);
const getCodePoint = (escape as Record<string, unknown>).getCodePoint as
  | ((input: string, at: number) => number)
  | undefined;
const cases: [string, () => unknown, unknown][] = [
  // required: stated in the task text
  ["getCodePoint is a function of src/escape.ts", () => typeof getCodePoint, "function"],
  ['getCodePoint("abc", 0)', () => getCodePoint?.("abc", 0), 97],
  ['getCodePoint("abc", 2)', () => getCodePoint?.("abc", 2), 99],
  ['getCodePoint("ü", 0)', () => getCodePoint?.("ü", 0), 252],
  ['getCodePoint("💯", 0)', () => getCodePoint?.("💯", 0), 128_175],
  ['getCodePoint("a💩", 1)', () => getCodePoint?.("a\u{1F4A9}", 1), 128_169],
  ['getCodePoint("abc", 3)', () => getCodePoint?.("abc", 3), Number.NaN],
  ['getCodePoint("", 0)', () => getCodePoint?.("", 0), Number.NaN],
  // required: beyond the stated examples
  ['getCodePoint("a💩", 2) (a low surrogate alone)', () => getCodePoint?.("a\u{1F4A9}", 2), 56_489],
  ['getCodePoint("\\ud83d", 0) (a lone high surrogate)', () => getCodePoint?.("\uD83D", 0), 55_357],
  ['getCodePoint("abc", -1)', () => getCodePoint?.("abc", -1), Number.NaN],
  ['getCodePoint("€", 0)', () => getCodePoint?.("€", 0), 8364],
  // must not change: stated
  ["encodeXML", () => index.encodeXML(sample), "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt; &#128175; &#252;"],
  ["escapeUTF8", () => index.escapeUTF8(sample), "&lt;a href=&quot;x&quot;&gt;&apos;&amp;&apos;&lt;/a&gt; 💯 ü"],
  ["src/index.ts exports", () => Object.keys(index).includes("getCodePoint"), false],
  // must not change: beyond the stated examples
  ["encodeHTML", () => index.encodeHTML("<a> & ü 💯"), "&lt;a&gt; &amp; &uuml; &#128175;"],
  ["encodeNonAsciiHTML", () => index.encodeNonAsciiHTML("<a> & ü 💯"), "&lt;a&gt; &amp; &uuml; &#128175;"],
  ["escapeAttribute", () => index.escapeAttribute(`"a" & <b> ü`), "&quot;a&quot; &amp; <b> ü"],
  ["escapeText", () => index.escapeText(`"a" & <b> ü`), '"a" &amp; &lt;b&gt; ü'],
  ["decodeHTML", () => index.decodeHTML("&amp;&lt;&#x1f4af;&uuml;&notin;"), "&<💯ü∉"],
  ["decodeXML", () => index.decodeXML("&amp;&lt;&#x1f4af;&apos;"), "&<💯'"],
  [
    "src/escape.ts's other exports",
    () => Object.keys(escape).filter((name) => name !== "getCodePoint").sort(),
    ["XML_BITSET_VALUE", "encodeXML", "escape", "escapeAttribute", "escapeText", "escapeUTF8", "xmlEncodeRegex"],
  ],
];
const failed: string[] = [];
for (const [name, read, expected] of cases) {
  let got: unknown;
  try {
    got = read();
  } catch (error) {
    got = `throws ${(error as Error).message}`;
  }
  if (!same(got, expected)) failed.push(`${name}: expected ${String(expected)}, got ${String(got)}`);
}
if (failed.length > 0) {
  console.error(`behaviour check: ${failed.length} of ${cases.length} cases do not hold\n${failed.join("\n")}`);
  process.exit(1);
}
console.log(`behaviour check: all ${cases.length} cases hold`);
