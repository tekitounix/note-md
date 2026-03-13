/**
 * Markdown → HTML renderer with note.com-inspired custom styling.
 *
 * Adapted from the CLI tool for use in a VS Code Webview.
 * Takes raw markdown, returns a self-contained HTML string with
 * custom CSS that approximates note.com's appearance, TOC sidebar,
 * and interactive toolbar.
 *
 * Note: The CSS is independently written and does not use note.com's
 * actual stylesheets or assets.
 */

import MarkdownIt from 'markdown-it';
import { resolveMappedImageUrl } from './imageRefs';
import { parseFrontmatter } from './frontmatter';

// ---------------------------------------------------------------------------
// CDN asset configuration
// Centralised here so that version bumps and URL changes are single-point edits.
// SRI hashes must be updated in tandem with version changes.
// ---------------------------------------------------------------------------

const CDN = {
  fontAwesomeCss: 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  fontAwesomeCssSri:
    'sha512-DTOQO9RWCH3ppGqcWaEA1BIZOC6xxalwEsw9c2QQeAIftl+Vegovlnee1c9QX4TctnWMn13TZye+giMm8e2LwA==',
  highlightCss:
    'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css',
  highlightCssSri: 'sha384-oaMLBGEzBOJx3UHwac0cVndtX5fxGQIfnAeFZ35RTgqPcYlbprH9o9PUV/F8Le07',
  highlightJs: 'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js',
  highlightJsSri: 'sha384-F/bZzf7p3Joyp5psL90p/p89AZJsndkSoGwRpXcZhleCWhd8SnRuoYo4d0yirjJp',
  katexCss: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css',
  katexCssSri: 'sha384-nB0miv6/jRmo5UMMR1wu3Gz6NLsoTkbqJghGIsx//Rlm+ZU03BU6SQNC66uf4l5+',
  katexJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js',
  katexJsSri: 'sha384-7zkQWkzuo3B5mTepMUcHkMB5jZaolc2xDwL6VFqjFALcbeS9Ggm/Yr2r3Dy4lfFg',
  katexAutoRenderJs: 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js',
  katexAutoRenderJsSri: 'sha384-43gviWU0YVjaDtb/GhzOouOXtZMP/7XUzwPTstBeZFe/+rCMvRwr4yROQP43s0Xk',
  mermaidEsm: 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs',
} as const;

/** Unique CDN origins extracted from CDN URLs — used in Content-Security-Policy. */
const CDN_ORIGINS = [
  ...new Set(
    Object.values(CDN)
      .filter((v) => v.startsWith('https://'))
      .map((v) => new URL(v).origin),
  ),
].join(' ');

// ---------------------------------------------------------------------------
// markdown-it setup
// ---------------------------------------------------------------------------

const md = new MarkdownIt({ html: true, linkify: true, xhtmlOut: true });
md.disable('table');

// Add IDs to all headings (needed for TOC links & scroll spy)
md.core.ruler.push('heading_ids', (state) => {
  for (let i = 0; i < state.tokens.length; i++) {
    if (state.tokens[i].type === 'heading_open') {
      const inline = state.tokens[i + 1];
      if (inline?.type === 'inline') {
        state.tokens[i].attrSet('id', slugify(inline.content));
      }
    }
  }
});

// Add data-source-line to block elements (for diagnostic annotation)
md.core.ruler.push('source_map', (state) => {
  for (const token of state.tokens) {
    if (token.map && token.nesting >= 0) {
      token.attrSet('data-source-line', String(token.map[0]));
    }
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const BLOCK_RE =
  'h[1-6]|p|pre|div|ul|ol|li|blockquote|figure|figcaption|table|tr|td|th|hr|section|article|main';

function stripBlockGaps(html: string): string {
  return html.replace(
    new RegExp(`(</?(?:${BLOCK_RE})(?:\\s[^>]*)?>)\\s+(?=</?(?:${BLOCK_RE})[\\s>/])`, 'g'),
    '$1',
  );
}

/**
 * Convert note.com ruby notation to HTML ruby elements.
 * ｜漢字《かんじ》 → <ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>
 * Both fullwidth ｜ and halfwidth | are accepted (same as note.com).
 * Content inside <pre>...</pre> blocks is left unchanged.
 */
function convertRuby(html: string): string {
  return html.replace(
    /(<pre[\s>][\s\S]*?<\/pre>)|[｜|]([^《》\n]+)《([^》\n]+)》/g,
    (match, pre, text, ruby) => {
      if (pre) return pre;
      return `<ruby>${text}<rp>(</rp><rt>${ruby}</rt><rp>)</rp></ruby>`;
    },
  );
}

interface TocItem {
  level: number;
  id: string;
  text: string;
}

function extractToc(html: string): TocItem[] {
  const items: TocItem[] = [];
  const re = /<(h[23])\s+id="([^"]*)"[^>]*>(.*?)<\/\1>/gs;
  let m;
  while ((m = re.exec(html)) !== null) {
    items.push({
      level: parseInt(m[1].slice(1)),
      id: m[2],
      text: m[3].replace(/<[^>]+>/g, '').trim(),
    });
  }
  return items;
}

function buildTocHtml(items: TocItem[]): string {
  if (items.length === 0) return '';
  const lis = items
    .map((item) => {
      const t = escHtml(item.text);
      return `      <li class="side-toc__item" data-level="h${item.level}"><button class="side-toc__link" data-href="#${item.id}">${t}</button></li>`;
    })
    .join('\n');
  return `
  <aside class="side-toc" id="side-toc">
    <div class="side-toc__header" id="side-toc-toggle">
      <span class="side-toc__arrow">◀</span> 目次
    </div>
    <ol class="side-toc__list" id="side-toc-list">
${lis}
    </ol>
  </aside>`;
}

function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resolve image src attributes — prefer uploaded URL from urlMap,
 * fall back to baseUri for local preview.
 */
function resolveImageSrcs(html: string, urlMap?: Record<string, string>, baseUri?: string): string {
  return html.replace(/src="(?!https?:|data:|#)([^"]+)"/g, (_match, src: string) => {
    // Normalize backslashes for Windows paths in Markdown (e.g. images\photo.png)
    const normalizedSrc = src.replace(/\\/g, '/');
    const mapped = resolveMappedImageUrl(urlMap, normalizedSrc);
    // Always preserve original relative path so resolveBodyImages can re-resolve
    // after url-map-updated arrives (e.g. TIFF/WebP converted async).
    const dataSrc = ` data-original-src="${normalizedSrc}"`;
    if (mapped) return `src="${mapped}"${dataSrc}`;
    // Fall back to local webview URI
    if (baseUri) return `src="${baseUri}/${encodeURI(normalizedSrc)}"${dataSrc}`;
    return `src="${normalizedSrc}"${dataSrc}`;
  });
}

// ---------------------------------------------------------------------------
// note.com-compatible character counter
// ---------------------------------------------------------------------------
// Counts characters from raw Markdown source, matching note.com's
// ProseMirror textBetween(0, size, '\n') behaviour.

export function countNoteChars(markdown: string): number {
  const lines = markdown.split('\n');

  // Skip title (first h1 heading) and any following blank lines
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s/.test(lines[i])) {
      startIdx = i + 1;
      while (startIdx < lines.length && lines[startIdx].trim() === '') startIdx++;
      break;
    }
  }

  let inCodeFence = false;
  let fenceChar = '';
  let inDisplayMath = false;
  const blocks: string[] = [];
  let cur: string[] = [];

  const flush = () => {
    if (cur.length === 0) return;
    blocks.push(cur.join('\n'));
    cur = [];
  };

  for (let i = startIdx; i < lines.length; i++) {
    const raw = lines[i];

    // Code fence toggle (supports both ``` and ~~~)
    const fenceMatch = !inCodeFence && raw.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      flush();
      inCodeFence = true;
      fenceChar = fenceMatch[1][0];
      cur = [];
      continue;
    }
    if (inCodeFence) {
      const closeRe = new RegExp(`^${fenceChar === '~' ? '~' : '`'}{3,}\\s*$`);
      if (closeRe.test(raw)) {
        blocks.push(cur.join('\n'));
        cur = [];
        inCodeFence = false;
        fenceChar = '';
      } else {
        cur.push(raw);
      }
      continue;
    }

    // Display math boundaries
    if (/^\$\$\s*$/.test(raw.trim()) && !inDisplayMath) {
      flush();
      inDisplayMath = true;
      cur = [];
      continue;
    }
    if (/^\$\$\s*$/.test(raw.trim()) && inDisplayMath) {
      blocks.push(cur.join('\n'));
      cur = [];
      inDisplayMath = false;
      continue;
    }
    if (inDisplayMath) {
      cur.push(raw);
      continue;
    }

    // Blank line → block separator
    if (raw.trim() === '') {
      flush();
      continue;
    }

    // Empty blocks (contribute separator but no text)
    if (
      /^---\s*$/.test(raw.trim()) || // HR (markdown)
      /^<hr\s*\/?\s*>$/i.test(raw.trim()) || // HR (html)
      /^!\[[^\]]*\]\([^)]*\)\s*$/.test(raw.trim()) || // Image (markdown)
      /^<img\s[^>]*\/?>\s*$/i.test(raw.trim())
    ) // Image (html)
    {
      flush();
      blocks.push('');
      continue;
    }

    // Ignored elements (no block, no separator)
    if (/^<br\s*\/?\s*>\s*$/i.test(raw.trim())) continue;
    if (/^<!--[\s\S]*?-->\s*$/.test(raw)) continue;

    // Regular content — strip markdown syntax
    let s = raw;
    if (/^#{1,6}\s/.test(s)) {
      flush();
      s = s.replace(/^#{1,6}\s+/, '');
    }
    if (/^>\s?/.test(s)) s = s.replace(/^>\s?/, '');
    if (/^\s*[-*]\s/.test(s)) s = s.replace(/^\s*[-*]\s+/, '');
    if (/^\s*\d+\.\s/.test(s)) s = s.replace(/^\s*\d+\.\s+/, '');
    s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
    s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    s = s.replace(/\*\*([^*]+)\*\*/g, '$1');
    s = s.replace(/__([^_]+)__/g, '$1');
    s = s.replace(/~~([^~]+)~~/g, '$1');
    s = s.replace(/\$\$\{(.+?)\}\$\$/g, '$1'); // inline math
    s = s.replace(/[｜|]([^《]+)《[^》]+》/g, '$1'); // ruby → base only
    s = s.replace(/<!--[\s\S]*?-->/g, '');
    s = s.replace(/<[^>]+>/g, '');

    if (s.trim().length > 0) cur.push(s);
  }
  flush();

  return blocks.join('\n').length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RenderOptions {
  headerImagePath?: string;
  urlMap?: Record<string, string>;
  /** Nonce for CSP (required for VS Code Webview) */
  nonce?: string;
  /** CSP source for Webview */
  cspSource?: string;
  /** Base URI for local resource resolution */
  baseUri?: string;
  /** Generation counter for stale-message rejection in Webview */
  generation?: number;
}

/** Shared render pipeline — transforms raw markdown into processed content. */
function renderContent(
  markdown: string,
  opts?: RenderOptions,
): {
  title: string;
  body: string;
  tocHtml: string;
  urlMapJson: string;
  charCount: number;
  headerImagePath?: string;
} {
  // Parse frontmatter (e.g. header image) and strip it before rendering
  const { data: frontmatter, content: markdownBody } = parseFrontmatter(markdown);
  let body = md.render(markdownBody);

  // Convert mermaid code blocks to renderable divs (before inline code strip)
  body = body.replace(
    /<pre[^>]*><code[^>]*class="language-mermaid"[^>]*>([\s\S]*?)<\/code><\/pre>/g,
    (_m, content: string) => {
      const decoded = content.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
      const escaped = decoded.replace(/"/g, '&quot;');
      return `<div class="mermaid" data-original="${escaped}">${decoded}</div>`;
    },
  );

  // Strip inline <code> tags (note.com doesn't support inline code).
  body = body.replace(/(?<!<pre\b[^>]*>)<code>([^<]*)<\/code>/g, '$1');

  // Convert ruby notation (｜text《ruby》 → <ruby> HTML)
  body = convertRuby(body);

  // Extract & remove title (first h1)
  let title = '';
  body = body.replace(/<h1[^>]*>(.*?)<\/h1>/s, (_, t: string) => {
    title = t.replace(/<[^>]+>/g, '').trim();
    return '';
  });

  // Resolve local image paths — use uploaded URL from urlMap when available,
  // otherwise fall back to webview URI.
  body = resolveImageSrcs(body, opts?.urlMap, opts?.baseUri);

  body = stripBlockGaps(body);

  const tocHtml = buildTocHtml(extractToc(body));

  const urlMapJson = opts?.urlMap ? JSON.stringify(opts.urlMap).replace(/</g, '\\u003c') : '{}';

  // Resolve header image path from frontmatter
  let headerImagePath = frontmatter.header;
  if (headerImagePath) {
    const mapped = resolveMappedImageUrl(opts?.urlMap, headerImagePath);
    if (mapped) {
      headerImagePath = mapped;
    } else if (opts?.baseUri) {
      headerImagePath = `${opts.baseUri}/${headerImagePath}`;
    }
  }

  return {
    title,
    body,
    tocHtml,
    urlMapJson,
    charCount: countNoteChars(markdownBody),
    headerImagePath,
  };
}

export function renderPreview(markdown: string, opts?: RenderOptions): string {
  const { title, body, tocHtml, urlMapJson, charCount, headerImagePath } = renderContent(
    markdown,
    opts,
  );

  // Prefer frontmatter header, fall back to explicitly passed headerImagePath
  const resolvedHeader = headerImagePath ?? opts?.headerImagePath;
  const headerImgHtml = resolvedHeader
    ? `<img src="${escHtml(resolvedHeader)}" alt="ヘッダー画像">`
    : '';

  const nonce = opts?.nonce ?? '';
  const cspSource = opts?.cspSource ?? '';

  return buildPage(
    escHtml(title),
    body,
    tocHtml,
    headerImgHtml,
    urlMapJson,
    nonce,
    cspSource,
    opts?.generation,
    charCount,
  );
}

/** Result of rendering only the content portions (for incremental update) */
export interface RenderBodyResult {
  titleHtml: string;
  bodyHtml: string;
  tocHtml: string;
  urlMapJson: string;
  charCount: number;
  headerHtml: string;
}

/**
 * Render only title + body + TOC (no full-page shell).
 * Used for incremental Webview updates via postMessage.
 */
export function renderBody(markdown: string, opts?: RenderOptions): RenderBodyResult {
  const { title, body, tocHtml, urlMapJson, charCount, headerImagePath } = renderContent(
    markdown,
    opts,
  );
  const headerHtml = headerImagePath
    ? `<img src="${escHtml(headerImagePath)}" alt="ヘッダー画像">`
    : '';
  return {
    titleHtml: escHtml(title),
    bodyHtml: body,
    tocHtml,
    urlMapJson,
    charCount,
    headerHtml,
  };
}

// ---------------------------------------------------------------------------
// Full-page template
// ---------------------------------------------------------------------------

function buildPage(
  titleEsc: string,
  body: string,
  tocHtml: string,
  headerImgHtml: string,
  urlMapJson: string,
  nonce: string,
  cspSource: string,
  generation?: number,
  charCount?: number,
): string {
  const isWebview = nonce !== '';
  const nonceAttr = isWebview ? ` nonce="${nonce}"` : '';
  const cspMeta = isWebview
    ? `\n  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} ${CDN_ORIGINS} 'unsafe-inline'; script-src 'nonce-${nonce}' ${CDN_ORIGINS}; img-src ${cspSource} https: data:; font-src ${CDN_ORIGINS}; worker-src blob:;">`
    : '';

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">${cspMeta}
  <title>${titleEsc || 'note プレビュー'}</title>
  <link rel="stylesheet" href="${CDN.fontAwesomeCss}"
        integrity="${CDN.fontAwesomeCssSri}"
        crossorigin="anonymous" referrerpolicy="no-referrer" />
  <link rel="stylesheet"
        href="${CDN.highlightCss}"
        integrity="${CDN.highlightCssSri}"
        crossorigin="anonymous" />
  <link rel="stylesheet"
        href="${CDN.katexCss}"
        integrity="${CDN.katexCssSri}"
        crossorigin="anonymous" />
  <style${nonceAttr}>
${CSS}
  </style>
</head>
<body>
  <div class="toolbar">
    <button class="tool-btn copy-btn" id="copy-title-btn" data-tooltip="タイトルをコピー"><i class="fa-solid fa-heading"></i> タイトル</button>
    <button class="tool-btn copy-btn" id="copy-body-btn" data-tooltip="note.com用HTMLをコピー"${isWebview ? ' disabled' : ''}><i class="fa-solid fa-copy"></i> 本文コピー</button>
    <span id="upload-status" class="upload-status"></span>
    <div class="divider"${isWebview ? '' : ' style="display:none"'}></div>
    <button class="tool-btn icon-only" id="force-upload-btn" data-tooltip="画像を強制再アップロード"${isWebview ? '' : ' style="display:none"'}><i class="fa-solid fa-arrows-rotate"></i></button>
    <button class="tool-btn icon-only" id="open-browser-btn" data-tooltip="ブラウザで開く"${isWebview ? '' : ' style="display:none"'}><i class="fa-solid fa-up-right-from-square"></i></button>
    <button class="tool-btn icon-only" id="open-cheatsheet-btn" data-tooltip="書式リファレンス"${isWebview ? '' : ' style="display:none"'}><i class="fa-solid fa-circle-question"></i></button>
    <div class="divider"></div>
    <div class="font-toggle">
      <button id="font-gothic" class="active">ゴシック</button>
      <button id="font-mincho">明朝</button>
    </div>
    <span id="status"></span>
    <span id="char-count" style="margin-left:auto;font-size:12px;color:rgba(255,255,255,0.5);">${(charCount ?? 0).toLocaleString()}文字</span>
  </div>

${tocHtml}
  <div class="note-container">
    <div class="note-header-image" id="article-header">${headerImgHtml}</div>
    <div class="note-title" id="article-title">
      <h1>${titleEsc}</h1>
    </div>
    <div class="note-body" id="article-body">
${body}
    </div>
  </div>

  <script${nonceAttr}>
    window.__urlMap = ${urlMapJson};
    window.__gen = ${generation ?? 0};
  </script>
  <script${nonceAttr} src="${CDN.highlightJs}"
          integrity="${CDN.highlightJsSri}"
          crossorigin="anonymous"></script>
  <script${nonceAttr} src="${CDN.katexJs}"
          integrity="${CDN.katexJsSri}"
          crossorigin="anonymous"></script>
  <script${nonceAttr} src="${CDN.katexAutoRenderJs}"
          integrity="${CDN.katexAutoRenderJsSri}"
          crossorigin="anonymous"></script>
  <script${nonceAttr} type="module">
    import mermaid from '${CDN.mermaidEsm}';
    mermaid.initialize({
      startOnLoad: true,
      theme: 'default',
      securityLevel: 'strict',
    });
    window.__mermaid = mermaid;
  </script>
  <script${nonceAttr}>
    // Wait for KaTeX to load, then render math
    document.addEventListener('DOMContentLoaded', function() {
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(document.querySelector('.note-body'), {
          delimiters: [
            { left: '$$\u007b', right: '}$$', display: false },
            { left: '$$', right: '$$', display: true }
          ],
          throwOnError: false
        });
      }
    });
    // Fallback: try after a short delay for CDN loading
    setTimeout(function() {
      if (typeof renderMathInElement === 'function') {
        renderMathInElement(document.querySelector('.note-body'), {
          delimiters: [
            { left: '$$\u007b', right: '}$$', display: false },
            { left: '$$', right: '$$', display: true }
          ],
          throwOnError: false
        });
      }
    }, 1000);
  </script>
  <script${nonceAttr}>
${JS}
  </script>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// CSS constant
// ---------------------------------------------------------------------------

const CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --font-mincho: "Hiragino Mincho ProN", "Hiragino Mincho Pro", HGSMinchoE,
                     "Yu Mincho", YuMincho, "MS PMincho", serif;
      --font-gothic: "Helvetica Neue", "Hiragino Sans", "Hiragino Kaku Gothic ProN",
                     Arial, "Noto Sans JP", Meiryo, sans-serif;
      --font-code: SFMono-Regular, Consolas, Menlo, Courier, monospace;
      --font-size-base: 1rem;
      --font-size-sm: 0.875rem;
      --font-size-xs: 0.75rem;
      --font-size-lg: 1.125rem;
      --font-size-xl: 1.25rem;
      --font-size-2xl: 1.75rem;
      --font-size-article-title-desktop: 2rem;
      --color-text-primary: #08131a;
      --color-text-secondary: rgba(8,19,26,0.66);
      --color-surface-invert: #000;
      --color-text-invert: #fff;
      --color-background-primary: #fff;
      --color-background-secondary: #f5f8fa;
      --color-border-default: rgba(8,19,26,0.14);
      --color-border-strong: rgba(8,19,26,0.22);
    }
    body {
      font-family: var(--font-gothic);
      background-color: var(--color-background-primary);
      color: var(--color-text-primary);
      -webkit-font-smoothing: antialiased;
      font-size: var(--font-size-base);
      font-weight: 400;
      font-kerning: auto;
      line-height: 1.5;
      word-wrap: break-word;
    }
    body.font-serif {
      font-family: var(--font-mincho);
    }

    /* Toolbar */
    .toolbar {
      position: sticky; top: 0; z-index: 100;
      background: #222; color: #ccc;
      padding: 0 20px; height: 44px;
      display: flex; align-items: center; gap: 8px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 13px;
    }
    .toolbar .divider {
      width: 1px; height: 20px; background: rgba(255,255,255,0.12); margin: 0 2px;
    }
    .tool-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: transparent; color: #999; border: none; border-radius: 6px;
      font-size: 13px; font-weight: 500; padding: 6px 12px; cursor: pointer;
      white-space: nowrap; transition: all 0.15s; flex-shrink: 0;
    }
    .tool-btn.icon-only {
      padding: 6px 8px;
    }
    .tool-btn { position: relative; }
    .tool-btn:hover { background: rgba(255,255,255,0.08); color: #ddd; }
    .tool-btn:active { background: rgba(255,255,255,0.14); }
    .tool-btn[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute; left: 50%; top: 100%;
      transform: translateX(-50%); margin-top: 6px;
      background: #222; color: #ccc; font-size: 11px; font-weight: 400;
      padding: 4px 8px; border-radius: 4px; white-space: nowrap;
      pointer-events: none; z-index: 100;
    }
    .tool-btn i { font-size: 14px; }
    .tool-btn.copy-btn { color: #e8913a; }
    .tool-btn.copy-btn:hover { background: rgba(232,145,58,0.12); color: #f0a858; }
    .tool-btn.copy-btn:disabled { color: rgba(232,145,58,0.3); cursor: not-allowed; }
    .tool-btn.copy-btn:disabled:hover { background: none; color: rgba(232,145,58,0.3); }
    .upload-status { font-size: 11px; color: rgba(255,255,255,0.45); white-space: nowrap; }
    .upload-status.uploading { color: #49b583; }
    .upload-status.error { color: #e05555; }
    .font-toggle {
      display: flex; border-radius: 6px; overflow: hidden;
      border: 1px solid rgba(255,255,255,0.12);
      flex-shrink: 0;
    }
    .font-toggle button {
      background: transparent; color: #999; border: none;
      font-size: 12px; padding: 5px 14px; cursor: pointer;
      transition: all 0.15s; white-space: nowrap;
      min-width: 72px; text-align: center;
    }
    .font-toggle button:hover { color: #bbb; }
    .font-toggle button.active {
      background: rgba(232,145,58,0.2); color: #e8913a;
    }
    #status {
      font-size: 12px; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #status.ok { color: #e8913a; }
    #status.err { color: #e05555; }

    /* Layout */
    .note-container {
      width: 620px;
      margin: 0 auto;
      min-height: 100vh;
    }
    .note-header-image {
      width: 100%; line-height: 0;
    }
    .note-header-image:empty {
      display: none;
    }
    .note-header-image img {
      width: 100%; height: auto; display: block;
      margin-top: 48px;
    }
    .note-title {
      margin-top: 72px; margin-bottom: 38px;
    }
    .note-title h1 {
      font-size: var(--font-size-article-title-desktop);
      font-weight: 700; line-height: 1.5;
      color: var(--color-text-primary);
      letter-spacing: .04em;
      font-feature-settings: "palt" 1;
      margin: 0;
    }
    body.font-serif .note-title h1 {
      font-family: var(--font-mincho);
    }
    .note-body {
      padding-bottom: 80px;
    }

    /* Article typography */
    .note-body h2, .note-body h3 {
      font-weight: 700;
      font-feature-settings: "palt" 1;
      letter-spacing: .04em;
      line-height: 2.25rem;
      margin-bottom: -18px;
    }
    .note-body h2 { font-size: var(--font-size-2xl); margin-top: 54px; }
    .note-body h3 { font-size: var(--font-size-xl); margin-top: 36px; }
    .note-body h2 + h3 { margin-top: 54px; }
    .note-body p {
      font-size: var(--font-size-lg);
      line-height: 2rem;
      margin-top: 36px; margin-bottom: 36px;
    }
    .note-body li {
      font-size: var(--font-size-lg);
      line-height: 1.875rem;
      margin-top: 9px; margin-bottom: 9px;
    }
    .note-body > p:first-child,
    .note-body > ul:first-child,
    .note-body > ol:first-child { margin-top: 0; }
    .note-body > p:last-child,
    .note-body > h2:last-child,
    .note-body > h3:last-child,
    .note-body > ul:last-child,
    .note-body > ol:last-child { margin-bottom: 0; }
    .note-body ul, .note-body ol {
      margin-top: 36px; margin-bottom: 36px;
      padding-left: 1.5em;
    }
    .note-body ul { list-style-type: disc; }
    .note-body li > ul, .note-body li > ol {
      margin-top: 0; margin-bottom: 0;
    }
    .note-body img {
      display: block; max-width: 100%; height: auto !important;
      margin: 36px auto; text-align: center;
      border: 1px solid var(--color-border-default);
    }
    .note-body p > img { margin: 0 auto; }
    .note-body figure { margin-top: 36px; margin-bottom: 36px; }
    .note-body figcaption {
      display: block; margin-top: 16px;
      font-size: var(--font-size-sm); text-align: center;
    }
    .note-body figcaption:empty { margin-top: 0; }

    .note-body blockquote {
      margin: 36px 0; padding: 25px 36px;
      font-size: var(--font-size-base); line-height: 2.25rem;
      background-color: var(--color-background-secondary);
    }
    .note-body blockquote > * {
      margin-top: 0; margin-bottom: 0;
      font-size: var(--font-size-base);
    }
    .note-body pre,
    .note-body pre[data-name="preCode"] {
      font-family: var(--font-code);
      font-size: var(--font-size-xs);
      line-height: 1.125rem;
      color: var(--color-text-invert);
      background-color: var(--color-surface-invert);
      white-space: pre-wrap;
      margin-top: 36px; margin-bottom: 36px;
      overflow-x: auto;
    }
    .note-body code {
      font-family: var(--font-code);
      font-size: var(--font-size-xs);
      line-height: 1.125rem;
      display: block; padding: 36px;
      color: var(--color-text-invert);
      word-wrap: normal; white-space: pre;
      background-color: initial;
      overflow-x: auto;
    }
    .note-body pre code.hljs { background: transparent; padding: 36px; }
    .note-body p > code, .note-body li > code,
    .note-body h2 > code, .note-body h3 > code {
      display: inline; padding: 0;
      color: inherit; background: none;
      border-radius: 0; font-size: inherit;
      font-family: inherit;
      white-space: normal; line-height: inherit;
    }
    .note-body a {
      color: var(--color-text-primary);
      text-decoration: underline;
    }
    .note-body .katex-display { margin: 36px 0; text-align: left; }
    .note-body .katex-display > .katex { text-align: left; }
    .note-body [style*="text-align"] .katex-display,
    .note-body [style*="text-align"] .katex-display > .katex { text-align: inherit; }
    .note-body .katex { font-size: 1.1em; }
    .note-body hr {
      border: none;
      border-bottom: 1px solid var(--color-border-strong);
      margin: 36px 0;
    }

    /* Ruby */
    .note-body ruby { ruby-align: center; }
    .note-body ruby rt { font-size: 0.5em; }
    .note-body ruby rp { font-size: 0; }

    /* Mermaid */
    .note-body .mermaid {
      margin: 36px 0; text-align: center; overflow: auto;
      background: #fff; border-radius: 8px; padding: 16px;
    }
    .note-body .mermaid svg { max-width: 100%; height: auto; display: inline-block; }

    /* Side TOC */
    .side-toc {
      position: fixed; left: 0; top: 44px;
      width: 240px;
      height: calc(100vh - 44px);
      overflow-y: auto;
      scrollbar-width: none; /* Firefox */
      padding: 16px 16px 16px 20px;
      font-family: var(--font-gothic);
      font-size: var(--font-size-xs);
      z-index: 50;
      border-right: 1px solid var(--color-border-default);
      transition: width 0.25s;
    }
    .side-toc::-webkit-scrollbar { display: none; } /* Chrome/Edge */
    .side-toc.is-collapsed {
      width: 48px; overflow: hidden; border-right: none;
    }
    .side-toc__header {
      position: fixed; left: 20px; top: 54px;
      display: flex; align-items: center; gap: 6px;
      font-family: var(--font-gothic);
      font-size: var(--font-size-sm); font-weight: 600;
      color: rgba(8,19,26,0.36);
      cursor: pointer; user-select: none;
      white-space: nowrap; z-index: 51;
    }
    .side-toc.is-collapsed .side-toc__header { left: 14px; }
    .side-toc__header:hover { color: var(--color-text-secondary); }
    .side-toc__arrow {
      display: inline-block; font-size: 0.65em;
      transition: transform 0.25s;
    }
    .side-toc.is-collapsed .side-toc__arrow { transform: rotate(180deg); }
    .side-toc__list {
      list-style: none; padding: 0;
      margin: 32px 0 0 0;
      transition: opacity 0.2s, visibility 0.2s;
    }
    .side-toc.is-collapsed .side-toc__list {
      opacity: 0; visibility: hidden;
    }
    .side-toc__item {
      padding: 5px 0; margin: 0; list-style-type: none;
    }
    .side-toc__item[data-level="h2"] .side-toc__link {
      font-weight: 600; font-size: var(--font-size-xs);
    }
    .side-toc__item[data-level="h3"] { padding-left: 14px; }
    .side-toc__item[data-level="h3"] .side-toc__link { font-weight: 400; }
    .side-toc__link {
      display: block; width: 100%;
      background: none; border: none; padding: 0;
      font-family: inherit; font-size: var(--font-size-xs);
      line-height: 1.5; color: rgba(8,19,26,0.40);
      text-align: left; cursor: pointer; text-decoration: none;
    }
    .side-toc__link:hover { color: var(--color-text-secondary); }
    .side-toc__link.is-active {
      color: var(--color-text-secondary); font-weight: 600;
    }

    /* Responsive */
    @media (min-width: 1101px) {
      .note-container {
        margin-left: calc(50vw - 190px);
        margin-right: auto;
        transition: margin-left 0.25s;
      }
      .note-container.toc-collapsed {
        margin-left: auto; margin-right: auto;
      }
    }
    @media (max-width: 1100px) {
      .side-toc { display: none; }
    }
    @media only screen and (max-width: 768px) {
      .note-header-image img { margin-top: 0; }
      .note-container { width: auto; }
      .note-title { padding-right: 40px; padding-left: 40px; }
      .note-body  { padding-right: 40px; padding-left: 40px; }
    }
    @media only screen and (max-width: 480px) {
      .note-title {
        padding-right: 16px; padding-left: 16px;
        margin-top: 30px; margin-bottom: 35px;
      }
      .note-title h1 { font-size: var(--font-size-xl); }
      .note-body { padding-right: 16px; padding-left: 16px; }
      .note-body h2, .note-body h3 {
        line-height: 1.875rem; margin-bottom: -15px;
      }
      .note-body h2 { margin-top: 45px; font-size: var(--font-size-xl); }
      .note-body h3 { margin-top: 30px; font-size: var(--font-size-lg); }
      .note-body h2 + h3 { margin-top: 45px; }
      .note-body p, .note-body figure,
      .note-body blockquote, .note-body hr,
      .note-body h2, .note-body h3,
      .note-body ul, .note-body ol {
        margin-top: 30px; margin-bottom: 30px;
      }
      .note-body p  { font-size: var(--font-size-base); }
      .note-body li { font-size: var(--font-size-base); margin-top: 7px; margin-bottom: 7px; }
      .note-body pre { margin: 32px -16px; }
      .note-body code { padding: 24px; }
    }

`;

// ---------------------------------------------------------------------------
// JS constant (client-side interactivity for Webview)
// ---------------------------------------------------------------------------

const JS = `
    // VS Code Webview API (guard for browser preview)
    const vscode = (typeof acquireVsCodeApi === 'function') ? acquireVsCodeApi() : null;

    if (typeof hljs !== 'undefined') hljs.highlightAll();

    const statusEl = document.getElementById('status');
    const headerEl = document.getElementById('article-header');
    const titleEl  = document.getElementById('article-title');
    const bodyEl   = document.getElementById('article-body');

    function escText(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function showStatus(msg, ok) {
      statusEl.textContent = msg;
      statusEl.className = ok ? 'ok' : 'err';
      if (ok) setTimeout(() => { statusEl.textContent = ''; }, 4000);
    }

    const uploadStatusEl = document.getElementById('upload-status');

    /* ── note.com-compatible character counter (computed in extension host) ── */

    function lookupImageUrl(urlMap, src) {
      if (!urlMap) return null;
      var normalized = src.replace(/\\\\/g, '/').replace(/^(?:\\.\\/)+/, '');
      var keys = [normalized];
      var unsupRe = /\\.(svg|webp|bmp|tiff?)$/i;
      if (unsupRe.test(normalized)) keys.push(normalized.replace(unsupRe, '.png'));
      var parts = normalized.split('/');
      var name = parts[parts.length - 1] || normalized;
      if (name !== normalized) {
        keys.push(name);
        if (unsupRe.test(name)) keys.push(name.replace(unsupRe, '.png'));
      }
      for (var i = 0; i < keys.length; i++) {
        if (urlMap[keys[i]]) return urlMap[keys[i]];
      }
      return null;
    }

    function resolveBodyImages(urlMap) {
      if (!urlMap || Object.keys(urlMap).length === 0) return;
      document.querySelectorAll('#article-body img').forEach(function(img) {
        // Prefer data-original-src (the relative path before webview URI resolution)
        var origSrc = img.getAttribute('data-original-src');
        var src = origSrc || img.getAttribute('src') || '';
        if (src.startsWith('data:')) return;
        if (!origSrc && src.startsWith('http') && !src.includes('vscode-resource')) return;
        var mapped = lookupImageUrl(urlMap, src);
        if (mapped) img.setAttribute('src', mapped);
      });
    }

    // Listen for messages from extension host
    window.addEventListener('message', event => {
      const msg = event.data;
      // Accept messages without gen, or matching current gen
      if (msg.gen !== undefined && msg.gen !== window.__gen) return;
      switch (msg.type) {
        case 'copy-result':
          if (msg.ok) {
            showStatus('\\u2713 ' + (msg.label || '') + ' をコピーしました', true);
          } else {
            showStatus('\\u2717 コピー失敗', false);
          }
          break;
        case 'upload-started':
          uploadStatusEl.textContent = '画像処理中...';
          uploadStatusEl.className = 'upload-status uploading';
          document.getElementById('copy-body-btn').disabled = true;
          break;
        case 'upload-failed':
          uploadStatusEl.textContent = '処理失敗';
          uploadStatusEl.className = 'upload-status error';
          document.getElementById('copy-body-btn').disabled = false;
          break;
        case 'url-map-updated':
          window.__urlMap = msg.urlMap;
          window.__imagesReady = true;
          document.getElementById('copy-body-btn').disabled = false;
          uploadStatusEl.textContent = '';
          uploadStatusEl.className = 'upload-status';
          resolveBodyImages(msg.urlMap);
          break;
        case 'update': {
          // Sync generation counter so subsequent messages are accepted
          if (msg.gen !== undefined) window.__gen = msg.gen;
          const scrollY = window.scrollY;
          if (headerEl) headerEl.innerHTML = msg.headerHtml || '';
          titleEl.querySelector('h1').innerHTML = msg.titleHtml;
          bodyEl.innerHTML = msg.bodyHtml;
          window.__urlMap = JSON.parse(msg.urlMapJson);
          resolveBodyImages(window.__urlMap);
          // Count from extension host (note.com-compatible)
          document.getElementById('char-count').textContent =
            (msg.charCount || 0).toLocaleString() + '文字';
          if (typeof hljs !== 'undefined') hljs.highlightAll();
          if (typeof renderMathInElement === 'function') {
            renderMathInElement(bodyEl, {
              delimiters: [
                { left: '$$\u007b', right: '}$$', display: false },
                { left: '$$', right: '$$', display: true }
              ],
              throwOnError: false,
            });
          }
          if (window.__mermaid) window.__mermaid.run({ nodes: bodyEl.querySelectorAll('.mermaid') });
          // Rebuild side TOC
          const sideTocList = document.querySelector('.side-toc__list');
          if (sideTocList) {
            sideTocList.innerHTML = msg.tocHtml;
            initTocBehavior();
          }
          window.scrollTo(0, scrollY);
          break;
        }
        case 'scroll-to-line': {
          const line = msg.line;
          // Find the closest block element at or before the given source line
          const blocks = document.querySelectorAll('[data-source-line]');
          var firstLine = blocks.length > 0 ? parseInt(blocks[0].getAttribute('data-source-line'), 10) : 0;
          if (line <= firstLine) {
            // Editor is at the very top — scroll preview to top
            window.scrollTo({ top: 0, behavior: 'auto' });
          } else {
            let target = null;
            for (const el of blocks) {
              const elLine = parseInt(el.getAttribute('data-source-line'), 10);
              if (elLine <= line) target = el;
              else break;
            }
            if (target) {
              const toolbar = document.querySelector('.toolbar');
              const offset = toolbar ? toolbar.offsetHeight + 16 : 16;
              const top = target.getBoundingClientRect().top + window.scrollY - offset;
              window.scrollTo({ top, behavior: 'auto' });
            }
          }
          break;
        }
      }
    });

    function prepareCopyContent(el) {
      const clone = el.cloneNode(true);
      // Remove HTML comments
      const commentWalker = document.createTreeWalker(clone, NodeFilter.SHOW_COMMENT);
      const comments = [];
      while (commentWalker.nextNode()) comments.push(commentWalker.currentNode);
      comments.forEach(c => c.remove());

      const urlMap = window.__urlMap || {};
      clone.querySelectorAll('img').forEach(img => {
        // Use data-original-src (the original relative path) for URL lookup,
        // since the current src may be a vscode-resource URI that won't match urlMap keys.
        const origSrc = img.getAttribute('data-original-src');
        const src = origSrc || img.getAttribute('src') || '';
        const isExternal = src.startsWith('http') && !src.includes('vscode-resource');
        if (src && !isExternal && !src.startsWith('data:')) {
          const mapped = lookupImageUrl(urlMap, src);
          if (mapped) img.setAttribute('src', mapped);
        }
      });
      // Revert KaTeX-rendered math to note.com dollar-dollar-brace syntax
      clone.querySelectorAll('.katex-display').forEach(el => {
        const ann = el.querySelector('annotation');
        if (ann) el.replaceWith('$$' + '{' + ann.textContent.trim() + '}' + '$$');
      });
      // Inline math: remaining .katex elements (not inside .katex-display)
      clone.querySelectorAll('.katex').forEach(el => {
        const ann = el.querySelector('annotation');
        if (ann) el.replaceWith('$$' + '{' + ann.textContent.trim() + '}' + '$$');
      });
      // Revert mermaid diagrams to fenced code block text
      clone.querySelectorAll('.mermaid').forEach(el => {
        const code = el.getAttribute('data-original') || el.textContent;
        const pre = document.createElement('pre');
        const codeEl = document.createElement('code');
        codeEl.textContent = '\\x60\\x60\\x60mermaid\\n' + code.trim() + '\\n\\x60\\x60\\x60';
        pre.appendChild(codeEl);
        el.replaceWith(pre);
      });
      // Revert ruby elements to note.com ruby notation
      clone.querySelectorAll('ruby').forEach(el => {
        const rt = el.querySelector('rt');
        if (!rt) return;
        const rubyText = rt.textContent;
        let base = '';
        el.childNodes.forEach(n => {
          if (n.nodeType === 3) base += n.textContent;
        });
        el.replaceWith('\\uff5c' + base + '\\u300a' + rubyText + '\\u300b');
      });

      // Separate consecutive image-only paragraphs with an empty line so
      // note.com processes each image independently. Without separation,
      // note.com drops all but the last image. This is a note.com
      // limitation — all other separators (hr/br/zwsp/span/div/figure)
      // either fail to display images or produce equal/larger gaps.
      clone.querySelectorAll('p').forEach(p => {
        var imgs = p.querySelectorAll('img');
        if (imgs.length > 0 && p.childNodes.length === imgs.length) {
          var next = p.nextElementSibling;
          if (next && next.tagName === 'P') {
            var nextImgs = next.querySelectorAll('img');
            if (nextImgs.length > 0 && next.childNodes.length === nextImgs.length) {
              var spacer = document.createElement('p');
              spacer.innerHTML = '\\u00a0';
              p.after(spacer);
            }
          }
        }
      });

      // Strip data-* attributes added for internal use (data-source-line,
      // data-original-src, etc.) — they are not needed in the pasted content
      // and may confuse note.com's editor.
      clone.querySelectorAll('[data-source-line]').forEach(el => el.removeAttribute('data-source-line'));
      clone.querySelectorAll('[data-original-src]').forEach(el => el.removeAttribute('data-original-src'));

      return { html: clone.innerHTML, text: el.innerText };
    }

    function fallbackCopy(html, text, label) {
      try {
        const tmp = document.createElement('div');
        tmp.contentEditable = 'true';
        tmp.innerHTML = '<meta charset="utf-8">' + html;
        tmp.style.position = 'fixed';
        tmp.style.left = '-9999px';
        document.body.appendChild(tmp);
        const range = document.createRange();
        range.selectNodeContents(tmp);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('copy');
        sel.removeAllRanges();
        document.body.removeChild(tmp);
        showStatus('\\u2713 ' + label + ' をコピーしました', true);
      } catch (e) {
        showStatus('\\u2717 コピー失敗', false);
      }
    }

    async function copyHtml(el, label) {
      const content = prepareCopyContent(el);
      const html = '<meta charset="utf-8">' + content.html;
      try {
        const htmlBlob = new Blob([html], { type: 'text/html' });
        const textBlob = new Blob([content.text], { type: 'text/plain' });
        await navigator.clipboard.write([
          new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
        ]);
        showStatus('\\u2713 ' + label + ' をコピーしました', true);
      } catch (e) {
        fallbackCopy(content.html, content.text, label);
      }
    }

    document.getElementById('copy-title-btn').addEventListener('click', () => {
      copyHtml(titleEl, 'タイトル');
    });
    document.getElementById('copy-body-btn').addEventListener('click', () => {
      copyHtml(bodyEl, '本文');
    });

    /* Force upload button */
    document.getElementById('force-upload-btn').addEventListener('click', () => {
      if (vscode) vscode.postMessage({ type: 'force-upload' });
    });

    /* Open in browser button */
    document.getElementById('open-browser-btn').addEventListener('click', () => {
      if (vscode) vscode.postMessage({ type: 'open-in-browser' });
    });

    /* Open cheatsheet button */
    document.getElementById('open-cheatsheet-btn').addEventListener('click', () => {
      if (vscode) vscode.postMessage({ type: 'open-cheatsheet' });
    });

    /* Copy button starts disabled; enabled only when Extension
       sends url-map-updated (after image diff check completes). */

    /* Font toggle */
    const minchoBtn = document.getElementById('font-mincho');
    const gothicBtn = document.getElementById('font-gothic');
    minchoBtn.addEventListener('click', () => {
      document.body.classList.add('font-serif');
      minchoBtn.classList.add('active');
      gothicBtn.classList.remove('active');
    });
    gothicBtn.addEventListener('click', () => {
      document.body.classList.remove('font-serif');
      gothicBtn.classList.add('active');
      minchoBtn.classList.remove('active');
    });

    /* Character count is set from extension host via 'update' message
       and initialized in the HTML element by buildPage. */

    /* Side TOC toggle */
    const sideToc = document.querySelector('.side-toc');
    const sideTocToggle = document.getElementById('side-toc-toggle');
    const noteContainer = document.querySelector('.note-container');
    if (sideToc && sideTocToggle) {
      sideTocToggle.addEventListener('click', () => {
        sideToc.classList.toggle('is-collapsed');
        if (noteContainer) noteContainer.classList.toggle('toc-collapsed');
      });
    }

    /* Side TOC: click handler + scroll spy (reusable for update rebuilds) */
    function initTocBehavior() {
      document.querySelectorAll('.side-toc__link').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const href = btn.getAttribute('data-href');
          if (!href) return;
          const el = document.getElementById(href.slice(1));
          if (el) {
            const toolbar = document.querySelector('.toolbar');
            const offset = toolbar ? toolbar.offsetHeight + 16 : 16;
            const top = el.getBoundingClientRect().top + window.scrollY - offset;
            window.scrollTo({ top, behavior: 'smooth' });
          }
        });
      });
    }
    initTocBehavior();

    /* Scroll spy — uses live querySelectorAll so it picks up TOC rebuilds */
    var _scrollSpyRaf = 0;
    window.addEventListener('scroll', () => {
      cancelAnimationFrame(_scrollSpyRaf);
      _scrollSpyRaf = requestAnimationFrame(() => {
        const links = document.querySelectorAll('.side-toc__link');
        if (links.length === 0) return;
        const toolbar = document.querySelector('.toolbar');
        const offset = toolbar ? toolbar.offsetHeight + 24 : 24;
        const ids = Array.from(links)
          .map(l => l.getAttribute('data-href')?.slice(1))
          .filter(Boolean);
        let active = ids[0];
        for (const id of ids) {
          const el = document.getElementById(id);
          if (el && el.getBoundingClientRect().top <= offset) active = id;
        }
        links.forEach(l => {
          const isActive = l.getAttribute('data-href') === '#' + active;
          l.classList.toggle('is-active', isActive);
          if (isActive) l.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        });
      });
    }, { passive: true });

    // Notify extension host that Webview JS is ready
    if (vscode) vscode.postMessage({ type: 'webview-ready' });
`;
