/**
 * A total that is a number only where every part of it was measured.
 *
 * An unknown is not a zero. Adding the known parts and printing the sum beside the word "total"
 * is how an undercount gets read as a measurement, so the sum of the known parts is kept under
 * its own name with the number of parts it is missing, and `total` is null until there are none.
 */
export interface KnownTotal {
  readonly total: number | null;
  readonly knownSubtotal: number;
  readonly unknownParts: number;
}

export function knownTotal(parts: readonly (number | null | undefined)[]): KnownTotal {
  const known = parts.filter((part): part is number => typeof part === "number");
  const knownSubtotal = known.reduce((sum, part) => sum + part, 0);
  const unknownParts = parts.length - known.length;
  return { total: unknownParts === 0 ? knownSubtotal : null, knownSubtotal, unknownParts };
}
