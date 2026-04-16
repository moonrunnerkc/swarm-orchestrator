// Minimal markdown renderer: block-level first, then inline transforms.
// Pure — takes a string, returns an HTML string. Safe by default: input is
// HTML-escaped before any markdown expansion, so user text cannot inject tags.

const escapeHtml = (s) =>
  s.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttr = escapeHtml;

// Allow a small set of URL schemes. Anything else becomes an empty href so
// links can't smuggle in javascript: or data: payloads.
const safeUrl = (raw) => {
  const url = raw.trim();
  if (/^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(url)) return escapeAttr(url);
  return "";
};

const renderInline = (text) => {
  let out = text;
  // Code spans first — their contents must not be touched by other rules.
  const codePlaceholders = [];
  out = out.replace(/`([^`\n]+)`/g, (_, code) => {
    codePlaceholders.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codePlaceholders.length - 1}\u0000`;
  });

  // Images: ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, alt, url, title) => {
    const href = safeUrl(url);
    if (!href) return escapeHtml(alt);
    const t = title ? ` title="${escapeAttr(title)}"` : "";
    return `<img src="${href}" alt="${escapeAttr(alt)}"${t} />`;
  });

  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_, label, url, title) => {
    const href = safeUrl(url);
    const t = title ? ` title="${escapeAttr(title)}"` : "";
    if (!href) return label;
    return `<a href="${href}"${t} rel="noopener noreferrer" target="_blank">${label}</a>`;
  });

  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, "$1<em>$2</em>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");

  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => codePlaceholders[Number(i)]);
  return out;
};

const renderParagraph = (lines) => `<p>${renderInline(lines.join(" "))}</p>`;

export const renderMarkdown = (source) => {
  if (!source) return "";
  const safe = escapeHtml(source).split("\n");
  const out = [];
  let i = 0;

  const flushParagraph = (buf) => {
    if (buf.length) out.push(renderParagraph(buf));
  };

  while (i < safe.length) {
    const line = safe[i];

    // Fenced code block
    const fence = line.match(/^(`{3,}|~{3,})\s*([\w-]*)\s*$/);
    if (fence) {
      const [, marker, lang] = fence;
      const end = marker[0].repeat(marker.length);
      i++;
      const code = [];
      while (i < safe.length && !safe[i].startsWith(end)) {
        code.push(safe[i]);
        i++;
      }
      i++;
      const langAttr = lang ? ` class="lang-${escapeAttr(lang)}"` : "";
      out.push(`<pre><code${langAttr}>${code.join("\n")}</code></pre>`);
      continue;
    }

    // ATX heading
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*(-\s*){3,}$|^\s*(\*\s*){3,}$|^\s*(_\s*){3,}$/.test(line)) {
      out.push("<hr />");
      i++;
      continue;
    }

    // Blockquote
    if (/^&gt;\s?/.test(line)) {
      const quoted = [];
      while (i < safe.length && /^&gt;\s?/.test(safe[i])) {
        quoted.push(safe[i].replace(/^&gt;\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(quoted.join(" "))}</blockquote>`);
      continue;
    }

    // Lists — grouped while consecutive matching lines appear.
    const orderedStart = line.match(/^(\d+)\.\s+(.*)$/);
    const unorderedStart = line.match(/^[-*+]\s+(.*)$/);
    if (orderedStart || unorderedStart) {
      const ordered = !!orderedStart;
      const tag = ordered ? "ol" : "ul";
      const items = [];
      while (i < safe.length) {
        const m = ordered
          ? safe[i].match(/^\d+\.\s+(.*)$/)
          : safe[i].match(/^[-*+]\s+(.*)$/);
        if (!m) break;
        items.push(`<li>${renderInline(m[1])}</li>`);
        i++;
      }
      out.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph — collect until blank or block-starter line.
    const para = [];
    while (i < safe.length && safe[i].trim() !== "" && !/^(#{1,6}\s|&gt;\s?|[-*+]\s|\d+\.\s|`{3,}|~{3,})/.test(safe[i])) {
      para.push(safe[i]);
      i++;
    }
    flushParagraph(para);
  }

  return out.join("\n");
};

// Plain-text stats for the word/character counter. Strips markdown syntax
// so counts reflect what the reader sees rather than the source.
export const computeStats = (source) => {
  const text = (source || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_~\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const characters = (source || "").length;
  const words = text === "" ? 0 : text.split(" ").length;
  const readMinutes = Math.max(1, Math.round(words / 200));
  return { words, characters, readMinutes };
};

// First non-empty line (minus markdown syntax) makes a reasonable title.
export const deriveTitle = (source) => {
  if (!source) return "";
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    return line.replace(/^#{1,6}\s+/, "").replace(/[*_`]/g, "").slice(0, 80);
  }
  return "";
};
