import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// The dashboard is plain HTML + a single vanilla-JS file. These tests
// verify the shape contractually — that the page references the score
// file the spec calls out, that the JS module is wired up, and that
// the expected headline elements are present. The dashboard is not
// JS-executed under jsdom; the assertions are structural.

// __dirname at runtime is dist/test/leaderboard/ (Mocha runs the
// compiled tests). Three levels up gets us back to the repo root.
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const INDEX_HTML = path.join(REPO_ROOT, 'docs', 'leaderboard', 'index.html');
const SCORE_JS = path.join(REPO_ROOT, 'docs', 'leaderboard', 'score.js');

describe('leaderboard / dashboard (v10.3-advisory)', () => {
  it('index.html and score.js exist', () => {
    assert.ok(fs.existsSync(INDEX_HTML), `missing ${INDEX_HTML}`);
    assert.ok(fs.existsSync(SCORE_JS), `missing ${SCORE_JS}`);
  });

  it('index.html links to score.js (no inline bundle)', () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    assert.match(html, /src=["']\.\/score\.js["']/u);
  });

  it('index.html parses as a well-formed document with the expected headline', () => {
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    assert.match(html, /<!doctype html>/iu);
    assert.match(html, /<html lang="en">/u);
    assert.match(html, /Swarm Audit\s+·\s+Real-Corpus Leaderboard/u);
    // The three KPI slots the dashboard writes the overall metrics into.
    assert.match(html, /id="head-precision"/u);
    assert.match(html, /id="head-recall"/u);
    assert.match(html, /id="head-f1"/u);
    // The score-file timestamp lives in #head-meta.
    assert.match(html, /id="head-meta"/u);
    // Per-detector table headers, F1 in particular sortable.
    assert.match(html, /data-sort="f1"/u);
  });

  it('score.js fetches benchmarks/real-corpus/scores/latest.json', () => {
    const js = fs.readFileSync(SCORE_JS, 'utf8');
    assert.match(
      js,
      /benchmarks\/real-corpus\/scores\/latest\.json/u,
      'score.js must reference the score snapshot path',
    );
    // Sortable interaction is part of the spec — assert the handler
    // mechanism is present (a click-listener on data-sort headers).
    assert.match(js, /data-sort/u);
    assert.match(js, /addEventListener\(['"]click['"]/u);
  });

  it('the referenced score file exists and parses as the expected shape', () => {
    const scorePath = path.join(
      REPO_ROOT,
      'benchmarks',
      'real-corpus',
      'scores',
      'latest.json',
    );
    assert.ok(fs.existsSync(scorePath), `missing ${scorePath}`);
    const parsed = JSON.parse(fs.readFileSync(scorePath, 'utf8'));
    assert.ok(parsed.aggregate, 'expected aggregate block');
    assert.ok(Array.isArray(parsed.perDetector), 'expected perDetector array');
    assert.equal(typeof parsed.aggregate.overallF1, 'number');
  });
});
