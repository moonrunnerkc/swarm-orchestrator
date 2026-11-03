import { stripVTControlCharacters } from "node:util";

/**
 * What of a command's output the no-progress rule compares: the text without the parts that
 * change on every run of the same command against the same tree. Test runners print the clock
 * and how long each stage took (vitest's `Start at` and `Duration`, pytest's `in 0.12s`, jest's
 * `Time:`), and many tools name a fresh temporary directory. Colour codes go too, since whether a
 * tool colours its output can depend on the terminal it finds. The model is shown the output as
 * printed; only the comparison reads this.
 */

// 2026-11-02T21:04:05.123Z, 2026-11-02 21:04:05+00:00
const isoTimestamp =
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
// 14:06:34, 14:06:34.512
const clockTime = /\b\d{1,2}:\d{2}:\d{2}(?:[.,]\d+)?\b/g;
// 0m0.123s, as `time` prints it
const minutesSeconds = /\b\d+m\d+(?:\.\d+)?s\b/g;
// 134ms, 0.12s, 1.5 sec, 3 seconds, 12µs, 2 min
const duration =
  /\b\d+(?:\.\d+)?\s?(?:ms|µs|us|ns|s|secs?|seconds?|mins?|minutes?)(?![\p{L}\p{N}_])/gu;
// /tmp/x, /private/tmp/x, /var/folders/ab/cd/T/x, /private/var/folders/...
const temporaryPath = /(?:\/private)?(?:\/tmp|\/var\/folders)\/[^\s'"`:)\]]*/g;

export function comparableOutput(output: string): string {
  return stripVTControlCharacters(output)
    .replace(temporaryPath, "<temporary path>")
    .replace(isoTimestamp, "<time>")
    .replace(clockTime, "<time>")
    .replace(minutesSeconds, "<duration>")
    .replace(duration, "<duration>");
}
