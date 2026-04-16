import * as assert from 'assert';
import { run_accessibility_gate } from '../src/quality-gates/gates/accessibility.js';
import { GateContext, AccessibilityConfig, ProjectFile } from '../src/quality-gates/types.js';

const MAX_FILE_SIZE = 1_000_000;

function makeFile(relativePath: string, text: string): ProjectFile {
  return { path: `/fake/${relativePath}`, relativePath, sizeBytes: text.length, text };
}

function makeCtx(files: ProjectFile[]): GateContext {
  return { projectRoot: '/fake', files };
}

function fullConfig(): AccessibilityConfig {
  return {
    enabled: true,
    requireSkipLink: true,
    requireHeadingHierarchy: true,
    requireAriaLabels: true,
    requireFocusStyles: true,
    requireReducedMotion: true,
    requireNoPhantomAssets: true,
    requireMetaTags: true,
    requireResponsiveCSS: true,
    requireColorScheme: true,
    requireSemanticHTML: true,
    requireImgAlt: true
  };
}

describe('AccessibilityGate', () => {

  it('passes when all checks are satisfied', async () => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>App</title>
  <meta name="description" content="A real app">
  <meta name="theme-color" content="#333">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>
  <header><h1>Main Title</h1></header>
  <nav aria-label="Main"><a href="/">Home</a></nav>
  <main id="main-content">
    <h2>Section</h2>
  </main>
</body>
</html>`;
    const css = `:root { --color-bg: #fff; --color-text: #000; }
button:focus-visible { outline: 2px solid blue; outline-offset: 2px; }
body { font-size: 1rem; }
@media (prefers-color-scheme: dark) { :root { --color-bg: #111; --color-text: #eee; } }`;
    const ctx = makeCtx([
      makeFile('index.html', html),
      makeFile('styles.css', css)
    ]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    assert.strictEqual(result.status, 'pass', `Expected pass but got issues: ${result.issues.map(i => i.message).join('; ')}`);
    assert.strictEqual(result.issues.length, 0);
  });

  it('flags missing lang attribute on <html>', async () => {
    const html = `<!DOCTYPE html><html><head><title>App</title></head><body><h1>Hi</h1></body></html>`;
    const ctx = makeCtx([makeFile('index.html', html)]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    assert.strictEqual(result.status, 'fail');
    const langIssue = result.issues.find(i => i.message.includes('lang'));
    assert.ok(langIssue, 'should flag missing lang attribute');
  });

  it('flags missing skip-to-content link', async () => {
    const html = `<html lang="en"><body><h1>Title</h1></body></html>`;
    const ctx = makeCtx([makeFile('index.html', html)]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    const skipIssue = result.issues.find(i => i.message.includes('skip-to-content'));
    assert.ok(skipIssue, 'should flag missing skip link');
  });

  it('accepts skip link in JSX files', async () => {
    const html = `<html lang="en"><body><div id="root"></div></body></html>`;
    const tsx = `export function App() { return <><a href="#main-content" className="skip-link">Skip to content</a><h1>Hi</h1></>; }`;
    const css = `a:focus-visible { outline: 2px solid blue; }`;
    const ctx = makeCtx([
      makeFile('index.html', html),
      makeFile('src/App.tsx', tsx),
      makeFile('styles.css', css)
    ]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    const skipIssue = result.issues.find(i => i.message.includes('skip-to-content'));
    assert.strictEqual(skipIssue, undefined, 'skip link in JSX should satisfy the check');
  });

  it('flags broken heading hierarchy (h1 -> h3 skip)', async () => {
    const html = `<html lang="en"><body>
      <a href="#main-content" class="skip-link">Skip</a>
      <h1>Title</h1><h3>Subsection</h3>
    </body></html>`;
    const css = `button:focus-visible { outline: 2px solid blue; }`;
    const ctx = makeCtx([
      makeFile('index.html', html),
      makeFile('styles.css', css)
    ]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    const headingIssue = result.issues.find(i => i.message.includes('heading level skips'));
    assert.ok(headingIssue, 'should flag h1 -> h3 gap');
    assert.ok(headingIssue.message.includes('h1'), 'message should mention h1');
    assert.ok(headingIssue.message.includes('h3'), 'message should mention h3');
  });

  it('flags first heading not being h1', async () => {
    const html = `<html lang="en"><body>
      <a href="#main-content">Skip to content</a>
      <h2>Not the right start</h2>
    </body></html>`;
    const css = `a:focus-visible { outline: 2px solid blue; }`;
    const ctx = makeCtx([
      makeFile('index.html', html),
      makeFile('styles.css', css)
    ]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    const h2Issue = result.issues.find(i => i.message.includes('first heading is <h2>'));
    assert.ok(h2Issue, 'should flag first heading not being h1');
  });

  it('flags <nav> without aria-label in JSX', async () => {
    const tsx = `export function Header() { return <nav><a href="/">Home</a></nav>; }`;
    const ctx = makeCtx([makeFile('src/Header.tsx', tsx)]);

    const config = fullConfig();
    config.requireSkipLink = false;
    config.requireHeadingHierarchy = false;
    config.requireFocusStyles = false;

    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const navIssue = result.issues.find(i => i.message.includes('<nav>'));
    assert.ok(navIssue, 'should flag nav without aria-label');
  });

  it('passes <nav> with aria-label', async () => {
    const tsx = `export function Header() { return <nav aria-label="Main navigation"><a href="/">Home</a></nav>; }`;
    const ctx = makeCtx([makeFile('src/Header.tsx', tsx)]);

    const config = fullConfig();
    config.requireSkipLink = false;
    config.requireHeadingHierarchy = false;
    config.requireFocusStyles = false;

    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const navIssue = result.issues.find(i => i.message.includes('<nav>'));
    assert.strictEqual(navIssue, undefined, 'nav with aria-label should pass');
  });

  it('flags icon-only button without aria-label', async () => {
    const tsx = `export function IconBtn() { return <button><svg><path d="M10 10"/></svg></button>; }`;
    const ctx = makeCtx([makeFile('src/IconBtn.tsx', tsx)]);

    const config = fullConfig();
    config.requireSkipLink = false;
    config.requireHeadingHierarchy = false;
    config.requireFocusStyles = false;

    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const btnIssue = result.issues.find(i => i.message.includes('icon-only'));
    assert.ok(btnIssue, 'should flag icon-only button without aria-label');
  });

  it('passes button with visible text', async () => {
    const tsx = `export function Btn() { return <button>Save Changes</button>; }`;
    const ctx = makeCtx([makeFile('src/Btn.tsx', tsx)]);

    const config = fullConfig();
    config.requireSkipLink = false;
    config.requireHeadingHierarchy = false;
    config.requireFocusStyles = false;

    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const btnIssue = result.issues.find(i => i.message.includes('icon-only'));
    assert.strictEqual(btnIssue, undefined, 'button with text should pass');
  });

  it('flags missing :focus-visible in CSS', async () => {
    const css = `button { color: blue; }`;
    const html = `<html lang="en"><body><a href="#main-content">Skip</a><h1>Hi</h1></body></html>`;
    const ctx = makeCtx([
      makeFile('styles.css', css),
      makeFile('index.html', html)
    ]);

    const config = fullConfig();
    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const focusIssue = result.issues.find(i => i.message.includes('focus-visible'));
    assert.ok(focusIssue, 'should flag missing :focus-visible');
  });

  it('flags outline: none without replacement', async () => {
    const css = `button:focus { outline: none; }`;
    const html = `<html lang="en"><body><a href="#main-content">Skip</a><h1>Hi</h1></body></html>`;
    const ctx = makeCtx([
      makeFile('styles.css', css),
      makeFile('index.html', html)
    ]);

    const config = fullConfig();
    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const outlineIssue = result.issues.find(i => i.message.includes('outline: none'));
    assert.ok(outlineIssue, 'should flag outline: none without replacement');
  });

  it('does not false-positive on outline with decimal rem values', async () => {
    const css = `button:focus-visible { outline: 0.1875rem solid var(--color-focus-ring); outline-offset: 0.1875rem; }`;
    const html = `<html lang="en"><body><a href="#main-content">Skip</a><h1>Hi</h1></body></html>`;
    const ctx = makeCtx([
      makeFile('styles.css', css),
      makeFile('index.html', html)
    ]);

    const config = fullConfig();
    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const outlineIssue = result.issues.find(i => i.message.includes('outline: none'));
    assert.strictEqual(outlineIssue, undefined, 'should not flag outline: 0.1875rem as outline: 0');
  });

  it('accepts rem-based outline as valid replacement for outline: none', async () => {
    const css = `*:focus { outline: none; }\nbutton:focus-visible { outline: 2rem solid blue; }`;
    const html = `<html lang="en"><body><a href="#main-content">Skip</a><h1>Hi</h1></body></html>`;
    const ctx = makeCtx([
      makeFile('styles.css', css),
      makeFile('index.html', html)
    ]);

    const config = fullConfig();
    const result = await run_accessibility_gate(ctx, config, MAX_FILE_SIZE);
    const outlineIssue = result.issues.find(i => i.message.includes('outline: none'));
    assert.strictEqual(outlineIssue, undefined, 'rem-based outline should count as replacement');
  });

  it('passes with no HTML or CSS files (nothing to check)', async () => {
    const ctx = makeCtx([makeFile('src/utils.ts', 'export const foo = 1;')]);
    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    assert.strictEqual(result.status, 'pass');
    assert.strictEqual(result.issues.length, 0);
  });

  it('reports correct stats', async () => {
    const html = `<html lang="en"><body><a href="#main-content">Skip</a><h1>Hi</h1></body></html>`;
    const css = `:focus-visible { outline: 2px solid blue; }`;
    const tsx = `export const App = () => <div>App</div>;`;
    const ctx = makeCtx([
      makeFile('index.html', html),
      makeFile('src/App.tsx', tsx),
      makeFile('styles.css', css)
    ]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    assert.strictEqual(result.stats?.htmlFiles, 1);
    assert.strictEqual(result.stats?.jsxFiles, 1);
    assert.strictEqual(result.stats?.cssFiles, 1);
  });

  it('skips all checks for pre-existing files in baseline', async () => {
    // This HTML has many accessibility issues: no lang, no skip link, no meta tags
    const badHtml = `<!DOCTYPE html><html><head><title>App</title></head><body><div>Content</div></body></html>`;
    const badCss = `body { transition: all 0.3s; }`;
    const ctx: GateContext = {
      projectRoot: '/fake',
      files: [
        makeFile('index.html', badHtml),
        makeFile('style.css', badCss),
      ],
      baselineFiles: new Set(['index.html', 'style.css']),
    };

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    assert.strictEqual(result.status, 'pass', 'pre-existing files should not trigger accessibility failures');
    assert.strictEqual(result.issues.length, 0, 'no issues should be reported for baseline files');
    assert.strictEqual(result.stats?.htmlFiles, 0, 'baseline HTML files should be excluded from scan');
    assert.strictEqual(result.stats?.cssFiles, 0, 'baseline CSS files should be excluded from scan');
  });

  it('checks agent-created files while skipping baseline files', async () => {
    const oldHtml = `<!DOCTYPE html><html><head><title>App</title></head><body><div>Old</div></body></html>`;
    const newCss = `body { transition: all 0.3s; }`;
    const ctx: GateContext = {
      projectRoot: '/fake',
      files: [
        makeFile('index.html', oldHtml),
        makeFile('api.css', newCss),
      ],
      baselineFiles: new Set(['index.html']),
    };

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    // index.html is baseline: its issues should NOT be flagged
    const htmlIssue = result.issues.find(i => i.filePath === 'index.html');
    assert.strictEqual(htmlIssue, undefined, 'pre-existing HTML issues should not be flagged');
    // api.css is agent-created: its animation-without-reduced-motion SHOULD be flagged
    const cssIssue = result.issues.find(i => i.filePath === 'api.css');
    assert.ok(cssIssue, 'agent-created CSS with issues should be flagged');
  });

  it('checks all files when no baseline is provided', async () => {
    const html = `<!DOCTYPE html><html><head><title>App</title></head><body><div>Content</div></body></html>`;
    const ctx = makeCtx([makeFile('index.html', html)]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    assert.strictEqual(result.stats?.htmlFiles, 1, 'without baseline all HTML files should be scanned');
    assert.ok(result.issues.length > 0, 'without baseline, issues should be flagged');
  });

  it('resolves relative asset refs against the HTML file directory', async () => {
    // web/index.html sitting next to web/src/styles.css and web/src/app.js —
    // the browser resolves src="src/styles.css" to web/src/styles.css, and the
    // gate must do the same instead of looking for a top-level src/styles.css.
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="Nested app">
  <meta name="theme-color" content="#333">
  <title>Nested</title>
  <link rel="stylesheet" href="src/styles.css" />
</head>
<body>
  <a href="#main-content" class="skip-link">Skip</a>
  <header><h1>Hi</h1></header>
  <main id="main-content"><p>Body</p></main>
  <script type="module" src="src/app.js"></script>
</body>
</html>`;
    const css = `:root { --bg: #fff; }
button:focus-visible { outline: 2px solid blue; }
body { font-size: 1rem; }
@media (prefers-color-scheme: dark) { :root { --bg: #000; } }`;
    const ctx = makeCtx([
      makeFile('web/index.html', html),
      makeFile('web/src/styles.css', css),
      makeFile('web/src/app.js', 'export const app = true;'),
    ]);

    const result = await run_accessibility_gate(ctx, fullConfig(), MAX_FILE_SIZE);
    const phantomIssues = result.issues.filter(i => i.message.includes('does not exist'));
    assert.deepStrictEqual(phantomIssues, [], `nested refs should resolve; got: ${phantomIssues.map(i => i.message).join('; ')}`);
  });
});
