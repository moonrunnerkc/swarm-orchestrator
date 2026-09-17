/**
 * A stream that has started repeating itself. A local model at its default temperature will
 * sometimes emit one short marker over and over until the output cap stops it: gemma4:31b
 * behind Ollama answered `<channel|>` eight hundred times in a live run, six minutes at 22
 * tokens a second, and two of five samples of the same request did the same. Nothing useful
 * comes after such a run of repeats, so the loop cuts the call off and samples again.
 *
 * Pure text arithmetic, so it belongs in core and costs nothing ambient (invariant 8).
 */

/** How many consecutive repeats of one unit it takes before the stream is cut off. */
export const degenerateRepeatThreshold = 96;

const shortestUnit = 2;
const longestUnit = 32;

export interface RepeatedTail {
  readonly unit: string;
  readonly repeats: number;
}

/**
 * The smallest unit of two to thirty-two characters that the text ends with, repeated at least
 * the threshold's worth of times in a row, or null. A single character is not a unit: a rule
 * of dashes or a banner of equals signs is a thing people write, and a marker is not.
 */
export function repeatedTail(text: string): RepeatedTail | null {
  const window = text.slice(-(longestUnit * degenerateRepeatThreshold));
  for (let length = shortestUnit; length <= longestUnit; length += 1) {
    if (window.length < length * degenerateRepeatThreshold) {
      return null;
    }
    const unit = window.slice(-length);
    if (isSingleCharacter(unit)) {
      continue;
    }
    let repeats = 0;
    let end = window.length;
    while (end >= length && window.startsWith(unit, end - length)) {
      repeats += 1;
      end -= length;
    }
    if (repeats >= degenerateRepeatThreshold) {
      return { unit, repeats };
    }
  }
  return null;
}

function isSingleCharacter(unit: string): boolean {
  return unit.split("").every((character) => character === unit[0]);
}
