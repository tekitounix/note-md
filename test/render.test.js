const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

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
