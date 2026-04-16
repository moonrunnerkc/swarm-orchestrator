import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, computeStats, deriveTitle } from "../src/markdown.js";

test("renders headings, emphasis, and code spans", () => {
  const html = renderMarkdown("# Hello\n\nA **bold** and *italic* word and `code`.");
  assert.match(html, /<h1>Hello<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>italic<\/em>/);
  assert.match(html, /<code>code<\/code>/);
});

test("escapes raw HTML to prevent XSS", () => {
  const html = renderMarkdown("<script>alert(1)</script>");
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("rejects javascript: links but keeps label text", () => {
  const html = renderMarkdown("[click](javascript:alert(1))");
  assert.ok(!html.includes("javascript:"));
  assert.match(html, /click/);
});

test("renders fenced code blocks with language class", () => {
  const html = renderMarkdown("```js\nconst x = 1;\n```");
  assert.match(html, /<pre><code class="lang-js">const x = 1;<\/code><\/pre>/);
});

test("renders unordered and ordered lists", () => {
  const ul = renderMarkdown("- one\n- two");
  const ol = renderMarkdown("1. one\n2. two");
  assert.match(ul, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(ol, /<ol><li>one<\/li><li>two<\/li><\/ol>/);
});

test("renders blockquotes and horizontal rules", () => {
  assert.match(renderMarkdown("> quoted"), /<blockquote>quoted<\/blockquote>/);
  assert.match(renderMarkdown("---"), /<hr \/>/);
});

test("computeStats counts words and characters", () => {
  const { words, characters, readMinutes } = computeStats("one two three");
  assert.equal(words, 3);
  assert.equal(characters, 13);
  assert.equal(readMinutes, 1);
});

test("computeStats ignores empty strings", () => {
  assert.deepEqual(computeStats(""), { words: 0, characters: 0, readMinutes: 1 });
  assert.deepEqual(computeStats(null), { words: 0, characters: 0, readMinutes: 1 });
});

test("computeStats strips markdown syntax before counting", () => {
  const stats = computeStats("# Heading\n\n**bold** text");
  assert.equal(stats.words, 3);
});

test("deriveTitle uses first non-empty line, minus # prefix", () => {
  assert.equal(deriveTitle("# My Note\n\nbody"), "My Note");
  assert.equal(deriveTitle("\n\nPlain first line"), "Plain first line");
  assert.equal(deriveTitle(""), "");
});
