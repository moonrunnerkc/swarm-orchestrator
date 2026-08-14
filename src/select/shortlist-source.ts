import { bundledShortlistLocation, readBundledShortlist } from "./bundled-shortlist.ts";
import { parseShortlist, type Shortlist } from "./shortlist.ts";

/**
 * Served from the repository rather than a release, so a new model reaches users the day it is
 * curated instead of the day the next version ships.
 */
export const defaultShortlistUrl =
  "https://raw.githubusercontent.com/moonrunnerkc/swarm-orchestrator/main/src/select/coding-models.v1.json";

/** What `--shortlist` takes to mean "do not go to the network at all". */
export const bundledShortlistKeyword = "bundled";

export type ShortlistOrigin = "published" | "bundled" | "file";

export interface LoadedShortlist {
  readonly shortlist: Shortlist;
  readonly origin: ShortlistOrigin;
  readonly location: string;
  /** Why the published list was not used, or null when it was, or was never asked for. */
  readonly fallbackReason: string | null;
}

interface ShortlistResponse {
  readonly ok: boolean;
  readonly status: number;
  text(): Promise<string>;
}

export type ShortlistFetch = (url: string) => Promise<ShortlistResponse>;

export interface ShortlistSource {
  readonly fetch: ShortlistFetch;
  readonly readFile: (path: string) => Promise<string>;
  /**
   * A URL, a file path, or "bundled". Null takes the published list with the bundled snapshot
   * behind it, which is the zero-config path.
   */
  readonly requested: string | null;
}

export class ShortlistUnavailableError extends Error {
  constructor(location: string, cause: string) {
    super(
      `cannot read the model shortlist from ${location}: ${cause}. ` +
        `Use --shortlist ${bundledShortlistKeyword} to run against the snapshot that ships ` +
        "with this release.",
    );
    this.name = "ShortlistUnavailableError";
  }
}

export async function loadShortlist(source: ShortlistSource): Promise<LoadedShortlist> {
  if (source.requested === bundledShortlistKeyword) {
    return bundled(null);
  }
  if (source.requested === null) {
    return publishedOrBundled(source);
  }
  if (isUrl(source.requested)) {
    return {
      shortlist: await fetchShortlist(source.fetch, source.requested),
      origin: "published",
      location: source.requested,
      fallbackReason: null,
    };
  }
  return {
    shortlist: await readShortlistFile(source.readFile, source.requested),
    origin: "file",
    location: source.requested,
    fallbackReason: null,
  };
}

/**
 * Unreachable and malformed are different failures. An unreachable list is an absence, and the
 * snapshot covers it. A malformed one is a defect, and quietly substituting older data would
 * hide a broken publish from the person who could fix it, so it is raised.
 */
async function publishedOrBundled(source: ShortlistSource): Promise<LoadedShortlist> {
  let text: string;
  try {
    text = await get(source.fetch, defaultShortlistUrl);
  } catch (error) {
    return bundled(`${defaultShortlistUrl} could not be read (${describe(error)})`);
  }
  return {
    shortlist: parseShortlist(text, defaultShortlistUrl),
    origin: "published",
    location: defaultShortlistUrl,
    fallbackReason: null,
  };
}

async function bundled(fallbackReason: string | null): Promise<LoadedShortlist> {
  return {
    shortlist: await readBundledShortlist(),
    origin: "bundled",
    location: bundledShortlistLocation,
    fallbackReason,
  };
}

async function fetchShortlist(fetch: ShortlistFetch, url: string): Promise<Shortlist> {
  let text: string;
  try {
    text = await get(fetch, url);
  } catch (error) {
    throw new ShortlistUnavailableError(url, describe(error));
  }
  return parseShortlist(text, url);
}

async function readShortlistFile(
  read: (path: string) => Promise<string>,
  path: string,
): Promise<Shortlist> {
  let text: string;
  try {
    text = await read(path);
  } catch (error) {
    throw new ShortlistUnavailableError(path, describe(error));
  }
  return parseShortlist(text, path);
}

async function get(fetch: ShortlistFetch, url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`the server answered ${response.status}`);
  }
  return response.text();
}

function isUrl(requested: string): boolean {
  return requested.startsWith("http://") || requested.startsWith("https://");
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
