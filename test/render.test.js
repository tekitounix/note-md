const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        showWarningMessage() {},
        showInformationMessage() {},
      },
      workspace: {
        getConfiguration() {
          return {
            get(_key, defaultValue) {
              return defaultValue;
            },
          };
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { countNoteChars, renderPreview, renderBody } = require('../out/render.js');

// ===========================================================================
// countNoteChars
// ===========================================================================

test('countNoteChars: basic paragraph text equals its length', () => {
  const md = '# Title\n\nHello world';
  assert.equal(countNoteChars(md), 'Hello world'.length);
});

test('countNoteChars: title (h1) is excluded from count', () => {
  const md = '# My Title\n\nBody text';
  assert.equal(countNoteChars(md), 'Body text'.length);
});

test('countNoteChars: bold markers are stripped, content counted', () => {
  const md = '# T\n\n**bold text**';
  assert.equal(countNoteChars(md), 'bold text'.length);
});

test('countNoteChars: links — only text counted, not URL', () => {
  const md = '# T\n\n[click here](https://example.com)';
  assert.equal(countNoteChars(md), 'click here'.length);
});

test('countNoteChars: images are not counted', () => {
  const md = '# T\n\n![alt text](image.png)';
  assert.equal(countNoteChars(md), 0);
});

test('countNoteChars: HR (---) treated as empty block', () => {
  const md = '# T\n\nfoo\n\n---\n\nbar';
  // blocks: "foo", "", "bar" → joined "foo\n\nbar" = 7
  assert.equal(countNoteChars(md), 'foo\n\nbar'.length);
});

test('countNoteChars: backtick code block content is counted', () => {
  const md = '# T\n\n```\nhello\nworld\n```';
  assert.equal(countNoteChars(md), 'hello\nworld'.length);
});

test('countNoteChars: tilde code block content is counted', () => {
  const md = '# T\n\n~~~\nhello\nworld\n~~~';
  assert.equal(countNoteChars(md), 'hello\nworld'.length);
});

test('countNoteChars: display math ($$...$$) content is counted', () => {
  const md = '# T\n\n$$\nx^2 + y^2\n$$';
  assert.equal(countNoteChars(md), 'x^2 + y^2'.length);
});

test('countNoteChars: inline math ($${...}$$) content without delimiters is counted', () => {
  const md = '# T\n\nThe formula $${E=mc^2}$$ is famous';
  assert.equal(countNoteChars(md), 'The formula E=mc^2 is famous'.length);
});

test('countNoteChars: ruby with fullwidth ｜ — only base text counted', () => {
  const md = '# T\n\n｜漢字《かんじ》です';
  assert.equal(countNoteChars(md), '漢字です'.length);
});

test('countNoteChars: ruby with halfwidth | — same count as fullwidth', () => {
  const withFullwidth = '# T\n\n｜漢字《かんじ》です';
  const withHalfwidth = '# T\n\n|漢字《かんじ》です';
  assert.equal(countNoteChars(withFullwidth), countNoteChars(withHalfwidth));
  assert.equal(countNoteChars(withHalfwidth), '漢字です'.length);
});

test('countNoteChars: HTML comments are not counted', () => {
  const md = '# T\n\n<!-- this is a comment -->\nvisible text';
  assert.equal(countNoteChars(md), 'visible text'.length);
});

test('countNoteChars: consecutive blank lines treated as single block separator', () => {
  const md = '# T\n\nfoo\n\n\n\nbar';
  // Multiple blank lines still produce a single separator between blocks
  assert.equal(countNoteChars(md), 'foo\nbar'.length);
});

test('countNoteChars: mixed content — h1 + paragraphs + code block + list', () => {
  const md = [
    '# Title',
    '',
    'First paragraph.',
    '',
    '```',
    'code here',
    '```',
    '',
    '- list item one',
    '- list item two',
  ].join('\n');
  // blocks: "First paragraph.", "code here", "list item one\nlist item two"
  const expected = 'First paragraph.\ncode here\nlist item one\nlist item two'.length;
  assert.equal(countNoteChars(md), expected);
});

// ===========================================================================
// renderPreview / renderBody consistency
// ===========================================================================

test('renderPreview and renderBody produce consistent title, body, TOC', () => {
  const md = '# My Title\n\n## Section A\n\nParagraph one.\n\n## Section B\n\nParagraph two.';
  const opts = {};

  const preview = renderPreview(md, opts);
  const body = renderBody(md, opts);

  // Title should match
  assert.ok(preview.includes(body.titleHtml), 'preview should contain the same title');
  assert.equal(body.titleHtml, 'My Title');

  // Body HTML fragments should appear in full preview
  assert.ok(preview.includes('Paragraph one.'), 'preview should contain body content');
  assert.ok(body.bodyHtml.includes('Paragraph one.'), 'bodyHtml should contain body content');

  // TOC HTML should match
  assert.ok(preview.includes(body.tocHtml), 'preview should contain the same TOC HTML');

  // charCount should match between both
  assert.equal(body.charCount, countNoteChars(md));
});

test('TOC keeps a stable shell and sends only list items on incremental updates', () => {
  const empty = renderBody('# T\n\nBody');
  assert.match(empty.tocHtml, /<aside class="side-toc" id="side-toc" hidden>/);
  assert.equal(empty.tocListHtml, '');

  const populated = renderBody('# T\n\n## Section\n\n### Child');
  assert.match(populated.tocHtml, /<aside class="side-toc" id="side-toc">/);
  assert.match(populated.tocListHtml, /^\s*<li class="side-toc__item"/);
  assert.ok(!populated.tocListHtml.includes('<aside'));

  const preview = renderPreview('# T\n\nBody');
  assert.match(preview, /sideTocList\.innerHTML = msg\.tocListHtml \|\| ''/);
  assert.match(preview, /sideToc\.hidden = !msg\.tocListHtml/);
  assert.match(preview, /classList\.remove\('toc-collapsed'\)/);
});

test('renderBody converts ruby notation to <ruby> HTML elements', () => {
  const md = '# T\n\n｜漢字《かんじ》です';
  const result = renderBody(md);
  assert.ok(result.bodyHtml.includes('<ruby>漢字<rp>(</rp><rt>かんじ</rt><rp>)</rp></ruby>'));
});

test('renderBody converts mermaid code blocks to <div class="mermaid">', () => {
  const md = '# T\n\n```mermaid\ngraph TD;\n  A-->B;\n```';
  const result = renderBody(md);
  assert.ok(result.bodyHtml.includes('<div class="mermaid"'), 'should contain mermaid div');
  assert.ok(!result.bodyHtml.includes('language-mermaid'), 'should not retain code block class');
});

test('renderBody strips inline code tags', () => {
  const md = '# T\n\nUse `console.log` for debugging';
  const result = renderBody(md);
  assert.ok(!result.bodyHtml.includes('<code>'), 'inline <code> tags should be stripped');
  assert.ok(result.bodyHtml.includes('console.log'), 'content of inline code should remain');
});

test('renderBody extracts h1 as title and removes it from body', () => {
  const md = '# Article Title\n\nBody content here.';
  const result = renderBody(md);
  assert.equal(result.titleHtml, 'Article Title');
  assert.ok(!result.bodyHtml.includes('<h1'), 'h1 should be removed from body');
  assert.ok(result.bodyHtml.includes('Body content here.'));
});

test('renderBody decodes heading entities exactly once for title and TOC', () => {
  const result = renderBody('# A & B < C\n\n## X & Y < Z');
  assert.equal(result.titleHtml, 'A &amp; B &lt; C');
  assert.match(result.tocHtml, />X &amp; Y &lt; Z<\/button>/);
  assert.ok(!result.titleHtml.includes('&amp;amp;'));
  assert.ok(!result.tocHtml.includes('&amp;amp;'));
});

test('renderBody resolves escaped and entity-containing local image paths', () => {
  const result = renderBody(
    '# T\n\n![escaped](figures/a\\(final\\).png)\n\n![entity](figures/a&b.png)',
    {
      urlMap: {
        'figures/a(final).png': 'https://example.com/final.png',
        'figures/a&b.png': 'https://example.com/amp.png',
      },
    },
  );
  assert.match(result.bodyHtml, /src="https:\/\/example\.com\/final\.png"/);
  assert.match(result.bodyHtml, /src="https:\/\/example\.com\/amp\.png"/);
});

test('renderBody uses the first reference definition and resolves unquoted HTML images', () => {
  const result = renderBody(
    [
      '# T',
      '',
      '![hero][same]',
      '',
      '[same]: figures/first.png',
      '[same]: figures/second.png',
      '',
      '<img src=figures/raw.png alt="raw">',
    ].join('\n'),
    {
      urlMap: {
        'figures/first.png': 'https://example.com/first.png',
        'figures/raw.png': 'https://example.com/raw.png',
      },
    },
  );
  assert.match(result.bodyHtml, /src="https:\/\/example\.com\/first\.png"/);
  assert.match(result.bodyHtml, /src="https:\/\/example\.com\/raw\.png"/);
  assert.ok(!result.bodyHtml.includes('second.png'));
});

test('renderBody preserves external frontmatter images in local Webviews', () => {
  const result = renderBody('---\nheader: HTTPS://example.com/header.png\n---\n# T', {
    articleDir: process.cwd(),
    baseUri: 'vscode-resource://article',
  });
  assert.match(result.headerHtml, /src="HTTPS:\/\/example\.com\/header\.png"/);
});

test('renderBody rejects unsafe image schemes, protocol-relative URLs, and urlMap values', () => {
  for (const value of [
    'http://example.com/header.png',
    '//example.com/header.png',
    'javascript:alert(1)',
  ]) {
    const header = renderBody(`---\nnote-md: { eyecatch: "${value}" }\n---\n# T`);
    assert.equal(header.headerHtml, '');
  }

  const body = renderBody('# T\n\n![x](image.png)', {
    urlMap: { 'image.png': 'javascript:alert(1)' },
  });
  assert.ok(!body.bodyHtml.includes('javascript:'));
  assert.deepEqual(JSON.parse(body.urlMapJson), {});
});

test('countNoteChars excludes a Setext h1 title', () => {
  assert.equal(countNoteChars('Title\n=====\n\nBody'), 4);
});

test('renderBody resolves image src with urlMap', () => {
  const md = '# T\n\n![photo](figures/photo.png)';
  const opts = {
    urlMap: { 'figures/photo.png': 'https://cdn.example.com/photo.png' },
  };
  const result = renderBody(md, opts);
  assert.ok(
    result.bodyHtml.includes('src="https://cdn.example.com/photo.png"'),
    'image src should be resolved via urlMap',
  );
  assert.ok(
    !result.bodyHtml.includes(' src="figures/photo.png"'),
    'original local path should be replaced',
  );
});

test('renderBody keeps same-name images in different directories distinct', () => {
  const result = renderBody(
    ['![one](figures/photo.png)', '![two](appendix/photo.png)'].join('\n\n'),
    {
      urlMap: {
        'figures/photo.png': 'https://example.com/figures-photo.png',
        'appendix/photo.png': 'https://example.com/appendix-photo.png',
      },
    },
  );

  assert.match(result.bodyHtml, /src="https:\/\/example\.com\/figures-photo\.png"/);
  assert.match(result.bodyHtml, /src="https:\/\/example\.com\/appendix-photo\.png"/);
});

test('renderBody urlMapJson contains the urlMap data', () => {
  const md = '# T\n\ntext';
  const opts = {
    urlMap: { 'img.png': 'https://example.com/img.png' },
  };
  const result = renderBody(md, opts);
  const parsed = JSON.parse(result.urlMapJson);
  assert.deepEqual(parsed, { 'img.png': 'https://example.com/img.png' });
});

test('renderBody returns empty urlMapJson when no urlMap provided', () => {
  const md = '# T\n\ntext';
  const result = renderBody(md);
  assert.equal(result.urlMapJson, '{}');
});

test('renderBody sanitizes raw HTML scripts and event handlers', () => {
  const md = '# T\n\n<script>alert(1)</script><p onclick="alert(2)">本文</p>';
  const result = renderBody(md);
  assert.ok(!result.bodyHtml.includes('<script'), 'script tags should be removed');
  assert.ok(!result.bodyHtml.includes('onclick='), 'event handler attributes should be removed');
  assert.ok(result.bodyHtml.includes('<p>本文</p>'), 'safe paragraph HTML should remain');
});

test('renderBody escapes Mermaid source instead of injecting it as HTML', () => {
  const md = '# T\n\n```mermaid\n</div><script>alert(1)</script>\n```';
  const result = renderBody(md);
  assert.ok(result.bodyHtml.includes('class="mermaid"'), 'mermaid container should remain');
  assert.ok(
    !result.bodyHtml.includes('<script>'),
    'mermaid source must not become executable HTML',
  );
  assert.ok(result.bodyHtml.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('renderBody does not resolve local images outside articleDir into webview URIs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-render-'));
  const articleDir = path.join(root, 'article');
  fs.mkdirSync(articleDir);
  try {
    const result = renderBody('# T\n\n![x](../secret.png)', {
      articleDir,
      baseUri: 'vscode-resource://article',
    });
    assert.ok(!result.bodyHtml.includes('vscode-resource://article/../secret.png'));
    assert.ok(result.bodyHtml.includes('src=""'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renderPreview uses only bundled Webview assets and a narrow CSP', () => {
  const preview = renderPreview('# Title\n\nBody', {
    nonce: 'nonce',
    cspSource: 'vscode-webview:',
    assetBaseUri: 'vscode-webview://assets',
  });
  assert.match(preview, /vscode-webview:\/\/assets\/webview-vendor\.js/);
  assert.ok(!preview.includes('webview-mermaid.js'));
  assert.match(preview, /vscode-webview:\/\/assets\/katex\.css/);
  assert.ok(!preview.includes('cdnjs.cloudflare.com'));
  assert.ok(!preview.includes('cdn.jsdelivr.net'));
  assert.match(preview, /script-src vscode-webview: 'nonce-nonce'/);
  assert.match(preview, /base-uri 'none'/);
  assert.match(preview, /form-action 'none'/);
  assert.match(preview, /style-src-elem vscode-webview: 'nonce-nonce'/);
  assert.match(preview, /style-src-attr 'unsafe-inline'/);
  assert.match(preview, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(preview, /@media only screen and \(max-width: 480px\)[\s\S]*flex-wrap: wrap/);
});

test('clipboard plain text is produced from the transformed clone', () => {
  const preview = renderPreview('# T\n\n｜漢字《かんじ》');
  assert.match(preview, /text: clone\.innerText/);
  assert.ok(!preview.includes('text: el.innerText'));
  assert.match(preview, /measurement\.appendChild\(clone\)/);
  assert.match(preview, /document\.body\.appendChild\(measurement\)/);
  assert.match(preview, /finally \{\s*measurement\.remove\(\)/);
});

test('renderPreview loads the optional Mermaid bundle only for Mermaid articles', () => {
  const preview = renderPreview('# Title\n\n```mermaid\ngraph TD; A-->B;\n```', {
    nonce: 'nonce',
    cspSource: 'vscode-webview:',
    assetBaseUri: 'vscode-webview://assets',
  });
  assert.match(preview, /vscode-webview:\/\/assets\/webview-mermaid\.js/);
});

test('renderBody preserves frontmatter source lines and makes duplicate heading IDs unique', () => {
  const markdown = [
    '---',
    'header: header.png',
    '---',
    '',
    '# Title',
    '',
    '## Same',
    '## Same',
  ].join('\n');
  const result = renderBody(markdown);
  assert.match(result.bodyHtml, /id="same"[^>]*data-source-line="6"/);
  assert.match(result.bodyHtml, /id="same-2"[^>]*data-source-line="7"/);
});
