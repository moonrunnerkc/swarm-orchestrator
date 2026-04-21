import { maybe_read_text } from '../file-utils';
import { GateContext, GateIssue, GateResult, AccessibilityConfig } from '../types';

// Matches <h1> through <h6> tags in HTML content
const HEADING_REGEX = /<h([1-6])\b/gi;

export async function run_accessibility_gate(
  ctx: GateContext,
  config: AccessibilityConfig,
  maxFileSizeBytes: number
): Promise<GateResult> {
  const start = Date.now();
  const issues: GateIssue[] = [];

  // Only check files created by agents; pre-existing project files are the owner's concern
  const baseline = ctx.baselineFiles;
  const isAgentFile = (f: { relativePath: string }) => !baseline || !baseline.has(f.relativePath);
  const htmlFiles = ctx.files.filter(f => /\.html?$/i.test(f.relativePath) && isAgentFile(f));
  const jsxFiles = ctx.files.filter(f => /\.(jsx|tsx)$/i.test(f.relativePath) && isAgentFile(f));
  const cssFiles = ctx.files.filter(f => /\.css$/i.test(f.relativePath) && isAgentFile(f));

  // 1. Check lang attribute on <html> in all .html files
  for (const file of htmlFiles) {
    const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
    if (!text) continue;

    if (/<html\b/i.test(text) && !/<html[^>]+lang\s*=/i.test(text)) {
      issues.push({
        message: `<html> element missing lang attribute`,
        filePath: file.relativePath,
        hint: 'add lang="en" (or appropriate language code) to the <html> tag'
      });
    }
  }

  // 2. Check for skip-to-content link
  if (config.requireSkipLink && htmlFiles.length > 0) {
    const hasSkipLink = htmlFiles.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      if (!text) return false;
      return /skip-link|skip.to.content|#main-content/i.test(text);
    });

    // Also check JSX/TSX components for skip links
    const hasSkipLinkInJsx = jsxFiles.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      if (!text) return false;
      return /skip-link|skip.to.content|#main-content/i.test(text);
    });

    if (!hasSkipLink && !hasSkipLinkInJsx) {
      issues.push({
        message: 'no skip-to-content link found in HTML or JSX files',
        hint: 'add <a href="#main-content" class="skip-link">Skip to content</a> as the first focusable element'
      });
    }
  }

  // 3. Check heading hierarchy
  if (config.requireHeadingHierarchy) {
    const allSourceFiles = [...htmlFiles, ...jsxFiles];
    for (const file of allSourceFiles) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;

      const headings: number[] = [];
      let match: RegExpExecArray | null;
      const headingRegex = new RegExp(HEADING_REGEX.source, 'gi');
      while ((match = headingRegex.exec(text)) !== null) {
        headings.push(parseInt(match[1], 10));
      }

      if (headings.length === 0) continue;

      // First heading should be h1
      if (headings[0] !== 1) {
        issues.push({
          message: `first heading is <h${headings[0]}>, expected <h1>`,
          filePath: file.relativePath,
          hint: 'page should start with an <h1> element'
        });
      }

      // No skipped levels: h1 -> h3 without h2 in between
      for (let i = 1; i < headings.length; i++) {
        if (headings[i] > headings[i - 1] + 1) {
          issues.push({
            message: `heading level skips from <h${headings[i - 1]}> to <h${headings[i]}>`,
            filePath: file.relativePath,
            hint: `add an intermediate <h${headings[i - 1] + 1}> heading before <h${headings[i]}>`
          });
          break; // one issue per file is enough
        }
      }
    }
  }

  // 4. Check aria-label on interactive/landmark elements
  if (config.requireAriaLabels) {
    for (const file of jsxFiles) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;

      // <nav> without aria-label
      if (/<nav\b/i.test(text) && !/<nav[^>]+aria-label/i.test(text)) {
        issues.push({
          message: '<nav> element missing aria-label',
          filePath: file.relativePath,
          hint: 'add aria-label="Main navigation" or similar'
        });
      }

      // <button> without aria-label and without visible text children
      // Only flag buttons that look like icon-only buttons (contain emoji or svg but no plain text)
      const buttonRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
      let btnMatch: RegExpExecArray | null;
      while ((btnMatch = buttonRegex.exec(text)) !== null) {
        const attrs = btnMatch[1];
        const content = btnMatch[2];
        const hasAriaLabel = /aria-label/i.test(attrs);
        // Button has meaningful text if it contains word characters outside tags
        const strippedContent = content.replace(/<[^>]+>/g, '').trim();
        const hasTextContent = /\w{2,}/.test(strippedContent);

        if (!hasAriaLabel && !hasTextContent) {
          issues.push({
            message: 'icon-only <button> missing aria-label',
            filePath: file.relativePath,
            excerpt: content.slice(0, 40),
            hint: 'add aria-label describing the button action'
          });
          break; // one per file
        }
      }
    }
  }

  // 5. Check for :focus-visible in CSS
  if (config.requireFocusStyles) {
    const hasFocusVisible = cssFiles.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      if (!text) return false;
      return /:focus-visible/.test(text);
    });

    // Also check inline styles in JSX for focus handling
    const hasFocusInJsx = jsxFiles.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      if (!text) return false;
      return /focus-visible|onFocus|:focus/.test(text);
    });

    if (!hasFocusVisible && !hasFocusInJsx && cssFiles.length > 0) {
      issues.push({
        message: 'no :focus-visible styles found in any CSS file',
        hint: 'add :focus-visible { outline: 2px solid <color>; outline-offset: 2px; } for interactive elements'
      });
    }

    // Check for outline: none/0 without replacement focus style.
    // "0" must be standalone (followed by ; or whitespace-then-;), not a decimal prefix like 0.1875rem.
    const outlineDisabledRe = /outline\s*:\s*(none|0(?!\.\d))\s*(;|!|$)/m;
    const outlineReplacementRe = /outline\s*:\s*\d+(\.\d+)?\s*(px|rem|em)\b/;
    for (const file of cssFiles) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;

      if (outlineDisabledRe.test(text) && !outlineReplacementRe.test(text.replace(outlineDisabledRe, ''))) {
        issues.push({
          message: 'outline: none found without replacement focus style',
          filePath: file.relativePath,
          hint: 'removing outline disables keyboard focus visibility; add an alternative focus indicator'
        });
      }
    }
  }

  // 6. Check prefers-reduced-motion when animations are present
  if (config.requireReducedMotion) {
    const animationSources = [...cssFiles, ...htmlFiles];
    for (const file of animationSources) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;

      const hasAnimations = /@keyframes\b/.test(text) || /animation\s*:/.test(text) || /transition\s*:/.test(text);
      const hasReducedMotionQuery = /prefers-reduced-motion/.test(text);

      if (hasAnimations && !hasReducedMotionQuery) {
        issues.push({
          message: 'CSS includes animations but no prefers-reduced-motion media query',
          filePath: file.relativePath,
          hint: 'add @media (prefers-reduced-motion: reduce) { /* disable or simplify animations */ }'
        });
      }
    }
  }

  // 7. Check for phantom asset references (src/href pointing to nonexistent local files)
  if (config.requireNoPhantomAssets) {
    const knownFiles = new Set(ctx.files.map(f => f.relativePath));
    for (const file of htmlFiles) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;

      // Match src="..." and href="..." that look like local paths (not URLs, not anchors, not data URIs)
      const refRegex = /(?:src|href)\s*=\s*["']([^"']+)["']/gi;
      // Resolve references against the HTML file's own directory so a nested
      // page (e.g. web/index.html) correctly points at web/src/styles.css.
      const slashIdx = file.relativePath.lastIndexOf('/');
      const htmlDir = slashIdx >= 0 ? file.relativePath.substring(0, slashIdx) : '';
      let refMatch: RegExpExecArray | null;
      while ((refMatch = refRegex.exec(text)) !== null) {
        const ref = refMatch[1];
        // Skip external URLs, anchors, data URIs, template expressions
        if (/^(https?:|mailto:|#|data:|javascript:|\{|%|\/)/.test(ref)) continue;

        // Resolve ./ and ../ segments against the HTML file's directory.
        let remaining = ref.replace(/^\.\//g, '');
        let dir = htmlDir;
        while (remaining.startsWith('../')) {
          remaining = remaining.substring(3);
          const parent = dir.lastIndexOf('/');
          dir = parent >= 0 ? dir.substring(0, parent) : '';
        }
        const resolved = dir ? `${dir}/${remaining}` : remaining;

        // Fall back to the bare reference for flat projects where HTML sits
        // alongside its assets without a shared parent directory.
        if (!knownFiles.has(resolved) && !knownFiles.has(remaining)) {
          issues.push({
            message: `references "${ref}" which does not exist in the project`,
            filePath: file.relativePath,
            hint: 'remove the reference or create the missing file'
          });
        }
      }
    }
  }

  // 8. Check for required meta tags in HTML head
  if (config.requireMetaTags) {
    for (const file of htmlFiles) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;
      if (!/<html\b/i.test(text)) continue;

      if (!/<meta[^>]+name\s*=\s*["']description["'][^>]*>/i.test(text)) {
        issues.push({
          message: 'missing <meta name="description"> in HTML head',
          filePath: file.relativePath,
          hint: 'add <meta name="description" content="..."> with a real project description'
        });
      }
      if (!/<meta[^>]+name\s*=\s*["']theme-color["'][^>]*>/i.test(text)) {
        issues.push({
          message: 'missing <meta name="theme-color"> in HTML head',
          filePath: file.relativePath,
          hint: 'add <meta name="theme-color" content="#..."> matching the primary brand color'
        });
      }
    }
  }

  // 9. Check for responsive CSS (viewport meta tag and responsive units or media queries)
  if (config.requireResponsiveCSS && htmlFiles.length > 0) {
    const hasViewportMeta = htmlFiles.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      return text ? /<meta[^>]+name\s*=\s*["']viewport["'][^>]*>/i.test(text) : false;
    });
    if (!hasViewportMeta) {
      issues.push({
        message: 'no <meta name="viewport"> found in any HTML file',
        hint: 'add <meta name="viewport" content="width=device-width, initial-scale=1.0"> for responsive layout'
      });
    }

    // At least one CSS file should use a responsive technique
    if (cssFiles.length > 0) {
      const hasResponsive = cssFiles.some(f => {
        const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
        if (!text) return false;
        return /@media\b/.test(text) || /\bclamp\(/.test(text) || /\b(vw|vh|vmin|vmax|rem|%)\b/.test(text);
      });
      if (!hasResponsive) {
        issues.push({
          message: 'CSS uses no responsive techniques (media queries, clamp(), relative units)',
          hint: 'use relative units (rem, %), clamp(), or @media queries for responsive layout'
        });
      }
    }
  }

  // 10. Check for color scheme support (CSS custom properties + dark mode query)
  if (config.requireColorScheme && cssFiles.length > 0) {
    const hasCustomProperties = cssFiles.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      return text ? /--[\w-]+\s*:/.test(text) : false;
    });
    const hasDarkModeQuery = cssFiles.some(f => {
      const text = f.text ?? maybe_read_text(f, maxFileSizeBytes);
      return text ? /prefers-color-scheme\s*:\s*dark/.test(text) : false;
    });

    if (!hasCustomProperties) {
      issues.push({
        message: 'no CSS custom properties defined; colors should use --var references for theming',
        hint: 'define colors, spacing, and font sizes as custom properties on :root'
      });
    }
    if (!hasDarkModeQuery) {
      issues.push({
        message: 'no @media (prefers-color-scheme: dark) found for dark mode support',
        hint: 'add a dark mode media query that overrides :root custom properties'
      });
    }
  }

  // 11. Check semantic HTML: flag div-heavy markup without semantic elements
  if (config.requireSemanticHTML) {
    for (const file of htmlFiles) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;
      if (!/<html\b/i.test(text)) continue;

      const hasMain = /<main\b/i.test(text);
      const hasNav = /<nav\b/i.test(text);
      const hasHeader = /<header\b/i.test(text);
      const hasSemanticElement = hasMain || hasNav || hasHeader;
      const divCount = (text.match(/<div\b/gi) || []).length;

      // Flag pages that use divs but no semantic landmarks at all
      if (divCount > 3 && !hasSemanticElement) {
        issues.push({
          message: `${divCount} <div> elements but no semantic landmarks (main, nav, header)`,
          filePath: file.relativePath,
          hint: 'replace wrapper divs with semantic elements: <main>, <nav>, <header>, <footer>'
        });
      }
    }
  }

  // 12. Check that <img> tags have alt attributes
  if (config.requireImgAlt) {
    const allSourceFiles = [...htmlFiles, ...jsxFiles];
    for (const file of allSourceFiles) {
      const text = file.text ?? maybe_read_text(file, maxFileSizeBytes);
      if (!text) continue;

      const imgRegex = /<img\b([^>]*)>/gi;
      let imgMatch: RegExpExecArray | null;
      while ((imgMatch = imgRegex.exec(text)) !== null) {
        const attrs = imgMatch[1];
        if (!/\balt\s*=/i.test(attrs)) {
          issues.push({
            message: '<img> element missing alt attribute',
            filePath: file.relativePath,
            hint: 'add alt="descriptive text" or alt="" for decorative images'
          });
          break; // one per file
        }
      }
    }
  }

  const durationMs = Date.now() - start;
  const status: GateResult['status'] = issues.length > 0 ? 'fail' : 'pass';

  return {
    id: 'accessibility',
    title: 'Accessibility checks',
    status,
    durationMs,
    issues,
    stats: {
      htmlFiles: htmlFiles.length,
      jsxFiles: jsxFiles.length,
      cssFiles: cssFiles.length,
      issues: issues.length
    }
  };
}
