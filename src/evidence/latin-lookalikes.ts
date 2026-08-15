/**
 * Text as a reader sees it: invisibles dropped, and every letter that renders as a Latin one
 * folded to the Latin one.
 *
 * Two checks need this and need it for the same reason. The placeholder gate matches markers a
 * person reads as TODO; the secret detector keys on names a person reads as `password`. Both
 * are defeated by a code point that prints as the letter it is not, and folding in one of them
 * and not the other is a difference nobody can defend: a field named password with its second
 * letter written in Cyrillic says credential to every reader of the record.
 *
 * A named list of the Cyrillic, Greek, and fullwidth letters that are indistinguishable in
 * ordinary type, rather than a general confusables engine: every entry is one code point
 * mapping to one, so folding cannot change what any other check sees. Something spelled out of
 * a script nobody listed still reads as itself to a person and is not caught, and the fix for
 * that is a longer list rather than a different mechanism (build-guide section 7.1).
 */

/**
 * Format characters: zero-width spaces and joiners, bidi controls, the soft hyphen. They render
 * as nothing, so a word split by one reads exactly like the word.
 */
const formatCharacters = /\p{Cf}/gu;

const latinLookalikes: ReadonlyMap<string, string> = new Map(
  Object.entries({
    "\u0410": "A",
    "\u0412": "B",
    "\u0415": "E",
    "\u041A": "K",
    "\u041C": "M",
    "\u041D": "H",
    "\u041E": "O",
    "\u0420": "P",
    "\u0421": "C",
    "\u0422": "T",
    "\u0425": "X",
    "\u0430": "a",
    "\u0435": "e",
    "\u043E": "o",
    "\u0440": "p",
    "\u0441": "c",
    "\u0445": "x",
    "\u0443": "y",
    "\u0391": "A",
    "\u0392": "B",
    "\u0395": "E",
    "\u0396": "Z",
    "\u0397": "H",
    "\u0399": "I",
    "\u039A": "K",
    "\u039C": "M",
    "\u039D": "N",
    "\u039F": "O",
    "\u03A1": "P",
    "\u03A4": "T",
    "\u03A5": "Y",
    "\u03A7": "X",
    "\u03BF": "o",
    "\u03B9": "i",
    "\u03BA": "k",
    "\u03BD": "v",
    "\u03C1": "p",
    "\u03C4": "t",
    "\u03C7": "x",
  }),
);

const fullwidthUpper = /[\uFF21-\uFF3A]/g;
const fullwidthLower = /[\uFF41-\uFF5A]/g;

/** The text as a reader sees it: no invisibles, and every lookalike letter as its Latin twin. */
export function asLatinLetters(text: string): string {
  return (
    text
      .replace(formatCharacters, "")
      .replace(fullwidthUpper, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0xff21 + 0x41),
      )
      .replace(fullwidthLower, (character) =>
        String.fromCharCode(character.charCodeAt(0) - 0xff41 + 0x61),
      )
      // Greek and Cyrillic, which is where every entry in the table lives.
      .replaceAll(/[\u0370-\u04FF]/gu, (character) => latinLookalikes.get(character) ?? character)
  );
}
