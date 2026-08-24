import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { backingLinks, parseClaims, renderBacking, renderPage, resolveBackingPath } from "./build-site.mjs";

const repositoryRoot = join(import.meta.dirname, "..");
const claimsMarkdown = await readFile(join(repositoryRoot, "docs", "claims.md"), "utf8");
const manifest = JSON.parse(await readFile(join(repositoryRoot, "package.json"), "utf8"));

const tracked = {
  files: new Set(["src/evidence/claim.ts", "docs/claims.md", "docs/evidence/2026-08-18/notes.md"]),
  directories: new Set(["docs/evidence/2026-08-18", "src/evidence"]),
};

describe("reading the claims table", () => {
  it("takes every row of the table and nothing above it", () => {
    const { claims } = parseClaims(claimsMarkdown);

    expect(claims.length).toBeGreaterThan(10);
    expect(claims.some((entry) => entry.claim === "Claim")).toBe(false);
    expect(claims.every((entry) => entry.claim.length > 0 && entry.backing.length > 0)).toBe(true);
  });

  /**
   * The half of that file this project is judged by. A page carrying the claims and not the
   * list underneath them would be the marketing page `docs/claims.md` was written to prevent.
   */
  it("takes the forbidden phrases too, with the reason each is forbidden", () => {
    const { forbidden } = parseClaims(claimsMarkdown);

    expect(forbidden.length).toBeGreaterThan(3);
    expect(forbidden.every((entry) => entry.phrase.length > 0 && entry.reason.length > 0)).toBe(true);
    expect(forbidden.some((entry) => entry.phrase.includes("Seven red-team laps"))).toBe(true);
  });
});

describe("resolving what a backing cell points at", () => {
  it("reads a cell path as relative to the document that holds it", () => {
    expect(resolveBackingPath("../src/evidence/claim.ts", tracked)?.path).toBe("src/evidence/claim.ts");
    expect(resolveBackingPath("evidence/2026-08-18/notes.md", tracked)?.path).toBe(
      "docs/evidence/2026-08-18/notes.md",
    );
  });

  it("links a directory to a tree rather than to a blob", () => {
    const resolved = resolveBackingPath("evidence/2026-08-18/", tracked);

    expect(resolved?.directory).toBe(true);
    expect(resolved?.href).toContain("/tree/");
  });

  /**
   * Inventing a link to a file nobody committed is the defect `scripts/check-doc-paths.mjs`
   * exists to catch, and a page that does it is worse than one that does not link at all: the
   * reader follows the pointer and lands on a 404 carrying this project's name.
   */
  it("leaves an untracked path as text rather than linking to a 404", () => {
    expect(resolveBackingPath("evidence/nothing-here.md", tracked)).toBe(null);
    expect(renderBacking("see `evidence/nothing-here.md`", tracked)).not.toContain("<a");
  });

  it("escapes to the repository root and no further", () => {
    expect(resolveBackingPath("../../outside.md", tracked)).toBe(null);
  });

  it("shows a linked path as what it is in the repository, not as the cell spelled it", () => {
    const html = renderBacking("`../src/evidence/claim.ts`", tracked);

    expect(html).toContain("<code>src/evidence/claim.ts</code>");
    expect(html).not.toContain("../src");
  });

  it("counts each artifact once however often the cell names it", () => {
    const links = backingLinks("`../src/evidence/claim.ts` and `../src/evidence/claim.ts`", tracked);

    expect(links.length).toBe(1);
  });
});

describe("the rendered page", () => {
  const { claims, forbidden } = parseClaims(claimsMarkdown);
  const html = renderPage({
    version: manifest.version,
    description: manifest.description,
    claims,
    forbidden,
    tracked,
  });

  it("carries every claim the table makes", () => {
    for (const entry of claims) {
      const [opening] = entry.claim.split(",");
      expect(html).toContain(opening.replace(/&/g, "&amp;"));
    }
  });

  it("carries every phrase the project forbids itself", () => {
    for (const entry of forbidden) {
      expect(html).toContain(entry.phrase.replace(/"/g, "&quot;"));
    }
  });

  /**
   * The version is on the page, and this is the check that keeps it from being a number
   * somebody typed once. `docs/tech-debt.md` names the same failure for the documents inside
   * the tarball, where nothing checks it yet.
   */
  it("names the version the manifest names", () => {
    expect(html).toContain(manifest.version);
  });

  /**
   * Invariant 1 on the page itself. The harness renders verdicts; a static page has no
   * harness, so the only verdict it may show is one it is quoting, and that one is a refusal.
   */
  it("renders no verdict of its own, only the refused claim it quotes", () => {
    const stamped = [...html.matchAll(/<span class="stamp">([^<]+)<\/span>/g)].map((match) => match[1]);

    expect(stamped).toEqual(["UNVERIFIED"]);
  });

  it("is a whole document with a viewport and a description", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('name="viewport"');
    expect(html).toContain(manifest.description.slice(0, 40));
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("closes every tag it opens", () => {
    for (const tag of ["main", "header", "footer", "article", "section", "ul", "li", "dl", "dt", "dd"]) {
      const opened = html.match(new RegExp(`<${tag}[\\s>]`, "g")) ?? [];
      const closed = html.match(new RegExp(`</${tag}>`, "g")) ?? [];
      expect(closed.length, tag).toBe(opened.length);
    }
  });
});
