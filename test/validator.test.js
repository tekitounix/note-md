const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// ─── vscode module mock ─────────────────────────────────────────
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

const { validate, validateAsync } = require('../out/validator.js');

// ─── Helpers ────────────────────────────────────────────────────

/** Return only diagnostics matching the given rule ID. */
function findByRule(diagnostics, ruleId) {
  return diagnostics.filter((d) => d.ruleId === ruleId);
}

function offsetAt(text, line, column) {
  const lines = text.split('\n');
  let offset = 0;
  for (let i = 0; i < line; i++) offset += lines[i].length + 1;
  return offset + column;
}

function applyFirstFix(text, diagnostic) {
  const edit = diagnostic.fixes[0].edits[0];
  const start = offsetAt(text, edit.range.line, edit.range.column);
  const end = offsetAt(
    text,
    edit.range.endLine ?? edit.range.line,
    edit.range.endColumn ?? edit.range.column + edit.range.length,
  );
  return text.slice(0, start) + edit.newText + text.slice(end);
}

test('malformed frontmatter remains opted in and reports a YAML diagnostic', () => {
  const text = '---\nnote-md: true\nbroken: [\n---\n# Title';
  const diagnostics = validate(text, 'change');
  assert.equal(findByRule(diagnostics, 'note/frontmatter-invalid').length, 1);
});

test('unterminated frontmatter reports an error instead of disabling validation', () => {
  const diagnostics = validate('---\nnote-md: true\n# not closed', 'change');
  assert.equal(findByRule(diagnostics, 'note/frontmatter-invalid').length, 1);
});

test('frontmatter through line 100 is protected from body syntax rules', () => {
  const lines = [
    '---',
    'note-md: true',
    ...Array(25).fill('key: value'),
    'quoted: "*italic*"',
    '---',
    '# T',
  ];
  const diagnostics = validate(lines.join('\n'), 'change');
  assert.equal(findByRule(diagnostics, 'note/no-italic').length, 0);
  assert.equal(findByRule(diagnostics, 'note/multiple-h1').length, 0);
});

test('frontmatter eyecatch text is not inspected by unrelated syntax rules', () => {
  const diagnostics = validate('---\nnote-md: { eyecatch: "foo|bar.png" }\n---\n# T', 'change');
  assert.equal(findByRule(diagnostics, 'note/ruby-unmatched').length, 0);
});

// =====================================================================
// 4.1 Unsupported syntax detection
// =====================================================================

// ─── note/no-table ──────────────────────────────────────────────

test('note/no-table: detects pipe table (header + separator)', () => {
  const text = '| A | B |\n| --- | --- |\n| 1 | 2 |';
  const diags = findByRule(validate(text, 'change'), 'note/no-table');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].range.line, 0);
});

test('note/no-table: detects a table without leading pipes', () => {
  const results = validate('A | B\n--- | ---', 'change');
  assert.ok(findByRule(results, 'note/no-table').length > 0);
});

test('note/no-table: no false positive on single pipe line', () => {
  const text = 'a | b | c\nnext line';
  const diags = findByRule(validate(text, 'change'), 'note/no-table');
  assert.equal(diags.length, 0);
});

test('note/no-table: no false positive when separator missing', () => {
  const text = '| A | B |\n| 1 | 2 |';
  const diags = findByRule(validate(text, 'change'), 'note/no-table');
  assert.equal(diags.length, 0);
});

// ─── note/no-italic ─────────────────────────────────────────────

test('note/no-italic: detects *text*', () => {
  const text = 'this is *italic* text';
  const diags = findByRule(validate(text, 'change'), 'note/no-italic');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('*text*'));
});

test('note/no-italic: detects _text_', () => {
  const text = 'this is _italic_ text';
  const diags = findByRule(validate(text, 'change'), 'note/no-italic');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('_text_'));
});

test('note/no-italic: does NOT flag **bold**', () => {
  const text = 'this is **bold** text';
  const diags = findByRule(validate(text, 'change'), 'note/no-italic');
  assert.equal(diags.length, 0);
});

test('note/no-italic: does NOT flag __bold__', () => {
  const text = 'this is __bold__ text';
  const diags = findByRule(validate(text, 'change'), 'note/no-italic');
  assert.equal(diags.length, 0);
});

test('note/no-italic: provides quickfix to convert to bold', () => {
  const text = 'this is *italic* text';
  const diags = findByRule(validate(text, 'change'), 'note/no-italic');
  assert.ok(diags[0].fixes);
  assert.ok(diags[0].fixes.length > 0);
  assert.ok(diags[0].fixes[0].title.includes('太字'));
});

// ─── note/no-inline-code ────────────────────────────────────────

test('note/no-inline-code: detects `code`', () => {
  const text = 'use `console.log` here';
  const diags = findByRule(validate(text, 'change'), 'note/no-inline-code');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, 'info');
});

test('note/no-inline-code: does NOT fire inside fenced code block', () => {
  const text = '```\nuse `code` here\n```';
  const diags = findByRule(validate(text, 'change'), 'note/no-inline-code');
  assert.equal(diags.length, 0);
});

test('note/no-inline-code: provides quickfix to remove backticks', () => {
  const text = 'use `code` here';
  const diags = findByRule(validate(text, 'change'), 'note/no-inline-code');
  assert.ok(diags[0].fixes);
  assert.equal(diags[0].fixes[0].edits[0].newText, 'code');
});

// ─── note/no-h456 ───────────────────────────────────────────────

test('note/no-h456: detects #### heading', () => {
  const text = '#### Sub-sub heading';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('####'));
});

test('note/no-h456: detects ##### heading', () => {
  const text = '##### Deep heading';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diags.length, 1);
});

test('note/no-h456: detects ###### heading', () => {
  const text = '###### Deepest heading';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diags.length, 1);
});

test('note/no-h456: does NOT flag ### heading', () => {
  const text = '### This is fine';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diags.length, 0);
});

test('note/no-h456: does NOT flag ## heading', () => {
  const text = '## This is fine';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diags.length, 0);
});

test('note/no-h456: provides quickfix to convert to h3', () => {
  const text = '#### Heading';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.ok(diags[0].fixes);
  assert.equal(diags[0].fixes[0].edits[0].newText, '###');
});

// ─── note/no-html5 ──────────────────────────────────────────────

test('note/no-html5: detects <details>', () => {
  const text = '<details>\n<summary>Click me</summary>\nContent\n</details>';
  const diags = findByRule(validate(text, 'change'), 'note/no-html5');
  assert.ok(diags.length >= 1);
  const tags = diags.map((d) => d.message);
  assert.ok(tags.some((m) => m.includes('<details>')));
  assert.ok(tags.some((m) => m.includes('<summary>')));
});

test('note/no-html5: detects <dl>, <dt>, <dd>', () => {
  const text = '<dl>\n<dt>Term</dt>\n<dd>Definition</dd>\n</dl>';
  const diags = findByRule(validate(text, 'change'), 'note/no-html5');
  assert.ok(diags.length >= 1);
  const tags = diags.map((d) => d.message);
  assert.ok(tags.some((m) => m.includes('<dl>')));
  assert.ok(tags.some((m) => m.includes('<dt>')));
  assert.ok(tags.some((m) => m.includes('<dd>')));
});

test('note/no-html5: does NOT flag supported HTML tags', () => {
  const text = '<div>content</div>\n<span>inline</span>';
  const diags = findByRule(validate(text, 'change'), 'note/no-html5');
  assert.equal(diags.length, 0);
});

// ─── note/no-footnote ───────────────────────────────────────────

test('note/no-footnote: detects [^1] reference', () => {
  const text = 'Some text[^1] with footnote.\n\n[^1]: Footnote text.';
  const diags = findByRule(validate(text, 'change'), 'note/no-footnote');
  assert.ok(diags.length >= 1);
});

test('note/no-footnote: does NOT flag normal links', () => {
  const text = 'See [link](https://example.com) here.';
  const diags = findByRule(validate(text, 'change'), 'note/no-footnote');
  assert.equal(diags.length, 0);
});

test('note/no-footnote: does NOT flag footnote ref inside inline code', () => {
  const text = 'Code: `[^1]` is a footnote marker.';
  const diags = findByRule(validate(text, 'change'), 'note/no-footnote');
  assert.equal(diags.length, 0);
});

// ─── note/no-image-title ────────────────────────────────────────

test('note/no-image-title: detects ![alt](url "title")', () => {
  const text = '![alt](image.png "my title")';
  const diags = findByRule(validate(text, 'change'), 'note/no-image-title');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('title'));
});

test('note/no-image-title: does NOT flag ![alt](url) without title', () => {
  const text = '![alt](image.png)';
  const diags = findByRule(validate(text, 'change'), 'note/no-image-title');
  assert.equal(diags.length, 0);
});

test('note/no-image-title: provides quickfix to remove title', () => {
  const text = '![alt](image.png "my title")';
  const diags = findByRule(validate(text, 'change'), 'note/no-image-title');
  assert.ok(diags[0].fixes);
  assert.equal(diags[0].fixes[0].edits[0].newText, '');
});

test('note/no-image-title: handles angle paths, nesting, quotes, references, and HTML', () => {
  const text = [
    "![angle](<image path.png> 'title')",
    '![nested](image_(final).png (caption))',
    '![ref][hero]',
    '[hero]: reference.png "reference title"',
    '<img src=raw.png title="raw title">',
  ].join('\n');
  const diags = findByRule(validate(text, 'change'), 'note/no-image-title');
  assert.equal(diags.length, 4);
  for (const diagnostic of diags) {
    assert.ok(!applyFirstFix(text, diagnostic).includes('undefined'));
  }
});

test('note/image-alt-empty: suggests alternative text and supports explicit ignore', () => {
  assert.ok(findByRule(validate('![](image.png)', 'change'), 'note/image-alt-empty').length > 0);
  assert.ok(
    findByRule(
      validate('<!-- note-ignore-next-line -->\n![](image.png)', 'change'),
      'note/image-alt-empty',
    ).length === 0,
  );
});

test('note/image-alt-empty: reference image ignore applies at the use site', () => {
  const text = '<!-- note-ignore-next-line -->\n![][hero]\n[hero]: image.png';
  assert.equal(findByRule(validate(text, 'change'), 'note/image-alt-empty').length, 0);
});

test('note/image-external-unverified: detects schemes case-insensitively', () => {
  const diags = findByRule(
    validate('# T\n\n![remote](HTTPS://example.com/image.png)', 'change'),
    'note/image-external-unverified',
  );
  assert.equal(diags.length, 1);
});

test('image rules support angle-bracket spaces and reference-style images', () => {
  const markdown = [
    '![space](<missing image.png>)',
    '![ref][image]',
    '[image]: missing-ref.png',
  ].join('\n');
  const results = validate(markdown, 'save', process.cwd());
  assert.equal(results.filter((result) => result.ruleId === 'note/image-missing').length, 2);
});

// =====================================================================
// 4.2 Custom extension validation
// =====================================================================

// ─── note/ruby-unmatched ────────────────────────────────────────

test('note/ruby-unmatched: detects ｜text without closing 《》', () => {
  const text = '｜漢字が読めない';
  const diags = findByRule(validate(text, 'change'), 'note/ruby-unmatched');
  assert.ok(diags.length >= 1);
  assert.ok(diags.some((d) => d.message.includes('閉じタグ《》')));
});

test('note/ruby-unmatched: detects 《ruby》 without opening ｜', () => {
  const text = '漢字《かんじ》が読める';
  const diags = findByRule(validate(text, 'change'), 'note/ruby-unmatched');
  assert.ok(diags.length >= 1);
  assert.ok(diags.some((d) => d.message.includes('開始マーク')));
});

test('note/ruby-unmatched: no error for correct ruby ｜漢字《かんじ》', () => {
  const text = '｜漢字《かんじ》が読める';
  const diags = findByRule(validate(text, 'change'), 'note/ruby-unmatched');
  assert.equal(diags.length, 0);
});

test('note/ruby-unmatched: detects empty ruby 《》', () => {
  const text = '｜漢字《》が読める';
  const diags = findByRule(validate(text, 'change'), 'note/ruby-unmatched');
  assert.ok(diags.some((d) => d.message.includes('空')));
});

// ─── note/ruby-nested ───────────────────────────────────────────

test('note/ruby-nested: detects nested ruby markers', () => {
  const text = '｜外側｜内側《うち》';
  const diags = findByRule(validate(text, 'change'), 'note/ruby-nested');
  assert.ok(diags.length >= 1);
  assert.ok(diags[0].message.includes('入れ子'));
});

test('note/ruby-nested: no error for single-level ruby', () => {
  const text = '｜漢字《かんじ》です';
  const diags = findByRule(validate(text, 'change'), 'note/ruby-nested');
  assert.equal(diags.length, 0);
});

// ─── note/math-unmatched ────────────────────────────────────────

test('note/math-unmatched: detects $${ without closing }$$', () => {
  const text = 'Inline math: $${x + y here';
  const diags = findByRule(validate(text, 'change'), 'note/math-unmatched');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('}$$'));
});

test('note/math-unmatched: no error for complete $${x}$$', () => {
  const text = 'Inline math: $${x + y}$$ here';
  const diags = findByRule(validate(text, 'change'), 'note/math-unmatched');
  assert.equal(diags.length, 0);
});

// ─── note/math-display-unclosed ─────────────────────────────────

test('note/math-display-unclosed: detects unclosed $$ block', () => {
  const text = '$$\nx + y = z\n';
  const diags = findByRule(validate(text, 'change'), 'note/math-display-unclosed');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].range.line, 0);
});

test('note/math-display-unclosed: no error for properly closed $$ block', () => {
  const text = '$$\nx + y = z\n$$';
  const diags = findByRule(validate(text, 'change'), 'note/math-display-unclosed');
  assert.equal(diags.length, 0);
});

test('note/math-display-unclosed: ignores $$ inside fenced code', () => {
  const text = '```text\n$$\n```';
  assert.equal(findByRule(validate(text, 'change'), 'note/math-display-unclosed').length, 0);
});

// ─── note/image-path-traversal ──────────────────────────────────

test('note/image-path-traversal: detects ../ in image path', () => {
  const text = '![alt](../images/pic.png)';
  const diags = findByRule(validate(text, 'change'), 'note/image-path-traversal');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('記事ディレクトリ'));
});

test('note/image-path-traversal: no error for relative path without traversal', () => {
  const text = '![alt](images/pic.png)';
  const diags = findByRule(validate(text, 'change'), 'note/image-path-traversal');
  assert.equal(diags.length, 0);
});

test('note/image-path-traversal: no error for URL images', () => {
  const text = '![alt](https://example.com/pic.png)';
  const diags = findByRule(validate(text, 'change'), 'note/image-path-traversal');
  assert.equal(diags.length, 0);
});

test('unsafe external image schemes are errors while HTTPS remains a warning', () => {
  const unsafe = findByRule(
    validate('![x](http://example.com/x.png)\n![y](javascript:alert(1))', 'change'),
    'note/image-external-unverified',
  );
  assert.equal(unsafe.length, 2);
  assert.ok(unsafe.every((diagnostic) => diagnostic.severity === 'error'));

  const safe = findByRule(
    validate('![x](https://example.com/x.png)', 'change'),
    'note/image-external-unverified',
  );
  assert.equal(safe[0].severity, 'warning');
});

test('note/image-path-traversal: does NOT flag filenames containing two dots', () => {
  const text = '![alt](images/foo..bar.png)';
  const diags = findByRule(validate(text, 'change'), 'note/image-path-traversal');
  assert.equal(diags.length, 0);
});

test('note/image-path-traversal: detects absolute path outside articleDir', () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-validator-'));
  try {
    const text = `![alt](${path.join(os.tmpdir(), 'outside.png')})`;
    const diags = findByRule(validate(text, 'change', articleDir), 'note/image-path-traversal');
    assert.equal(diags.length, 1);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('note/image-path-traversal: detects symlink escaping articleDir when resolvable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-validator-'));
  const articleDir = path.join(root, 'article');
  const outside = path.join(root, 'outside.png');
  fs.mkdirSync(articleDir);
  fs.writeFileSync(outside, 'x');
  try {
    fs.symlinkSync(outside, path.join(articleDir, 'link.png'));
  } catch (err) {
    if (err && ['EPERM', 'EACCES'].includes(err.code)) return;
    throw err;
  }
  try {
    const diags = findByRule(
      validate('![alt](link.png)', 'change', articleDir),
      'note/image-path-traversal',
    );
    assert.equal(diags.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// =====================================================================
// 4.4 Structural validation
// =====================================================================

// ─── note/multiple-h1 ───────────────────────────────────────────

test('note/missing-h1: rejects articles without a title', () => {
  assert.equal(findByRule(validate('Body only', 'change'), 'note/missing-h1').length, 1);
  assert.equal(findByRule(validate('# Title\n\nBody', 'change'), 'note/missing-h1').length, 0);
  assert.equal(findByRule(validate('Title\n=====\n\nBody', 'change'), 'note/missing-h1').length, 0);
});

test('note/missing-h1: ignores headings in frontmatter and fenced code', () => {
  const text = ['---', 'name: title', '---', '```', '# not a title', '```', 'Body'].join('\n');
  assert.equal(findByRule(validate(text, 'change'), 'note/missing-h1').length, 1);
});

test('note/empty-h1: rejects titles with no copyable text', () => {
  assert.equal(findByRule(validate('#', 'change'), 'note/empty-h1').length, 1);
  assert.equal(findByRule(validate('# ![image](title.png)', 'change'), 'note/empty-h1').length, 1);
  assert.equal(findByRule(validate('# **Title**', 'change'), 'note/empty-h1').length, 0);
});

test('note/multiple-h1: detects mixed ATX and Setext titles', () => {
  const text = '# First\n\nSecond\n======';
  const diags = findByRule(validate(text, 'change'), 'note/multiple-h1');
  assert.equal(diags.length, 1);
  assert.equal(applyFirstFix(text, diags[0]), '# First\n\nSecond\n---');
});

test('note/multiple-h1: detects multiple # headings', () => {
  const text = '# Title\n\nSome text\n\n# Another Title';
  const diags = findByRule(validate(text, 'change'), 'note/multiple-h1');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].range.line, 4);
});

test('note/multiple-h1: no error for single # heading', () => {
  const text = '# Title\n\nSome text\n\n## Section';
  const diags = findByRule(validate(text, 'change'), 'note/multiple-h1');
  assert.equal(diags.length, 0);
});

test('note/multiple-h1: provides quickfix to convert to h2', () => {
  const text = '# Title\n\n# Second';
  const diags = findByRule(validate(text, 'change'), 'note/multiple-h1');
  assert.ok(diags[0].fixes);
  assert.equal(diags[0].fixes[0].edits[0].newText, '##');
});

// ─── note/hr-variant ────────────────────────────────────────────

test('note/hr-variant: detects ***', () => {
  const text = '***';
  const diags = findByRule(validate(text, 'change'), 'note/hr-variant');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('---'));
});

test('note/hr-variant: detects ___', () => {
  const text = '___';
  const diags = findByRule(validate(text, 'change'), 'note/hr-variant');
  assert.equal(diags.length, 1);
});

test('note/hr-variant: does NOT flag ---', () => {
  const text = '---';
  const diags = findByRule(validate(text, 'change'), 'note/hr-variant');
  assert.equal(diags.length, 0);
});

test('note/hr-variant: provides quickfix to convert to ---', () => {
  const text = '***';
  const diags = findByRule(validate(text, 'change'), 'note/hr-variant');
  assert.ok(diags[0].fixes);
  assert.equal(diags[0].fixes[0].edits[0].newText, '---');
});

// ─── note/unclosed-html-tag ─────────────────────────────────────

test('note/unclosed-html-tag: detects unclosed <div>', () => {
  const text = '<div>\nsome content';
  const diags = findByRule(validate(text, 'change'), 'note/unclosed-html-tag');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('<div>'));
});

test('note/unclosed-html-tag: detects unclosed <span>', () => {
  const text = '<span>inline text';
  const diags = findByRule(validate(text, 'change'), 'note/unclosed-html-tag');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('<span>'));
});

test('note/unclosed-html-tag: no error for properly closed tags', () => {
  const text = '<div>content</div>';
  const diags = findByRule(validate(text, 'change'), 'note/unclosed-html-tag');
  assert.equal(diags.length, 0);
});

test('note/unclosed-html-tag: no error for void elements like <br> and <img>', () => {
  const text = 'line break<br>\n<img src="pic.png">';
  const diags = findByRule(validate(text, 'change'), 'note/unclosed-html-tag');
  assert.equal(diags.length, 0);
});

// ─── note/consecutive-blanks ────────────────────────────────────

test('note/consecutive-blanks: detects 3+ consecutive blank lines', () => {
  const text = 'text\n\n\n\nmore text';
  const diags = findByRule(validate(text, 'change'), 'note/consecutive-blanks');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('3'));
});

test('note/consecutive-blanks: no error for 2 blank lines', () => {
  const text = 'text\n\n\nmore text';
  const diags = findByRule(validate(text, 'change'), 'note/consecutive-blanks');
  assert.equal(diags.length, 0);
});

test('note/consecutive-blanks: detects at end of file', () => {
  const text = 'text\n\n\n\n';
  const diags = findByRule(validate(text, 'change'), 'note/consecutive-blanks');
  assert.equal(diags.length, 1);
});

test('note/consecutive-blanks: quickfix removes extra blank lines', () => {
  const text = 'text\n\n\n\nmore text';
  const diags = findByRule(validate(text, 'change'), 'note/consecutive-blanks');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].fixes);
  assert.equal(applyFirstFix(text, diags[0]), 'text\n\n\nmore text');
});

// =====================================================================
// Preprocessing and protection system
// =====================================================================

test('rules do NOT fire inside fenced code blocks (backtick)', () => {
  const text = '```\n#### heading inside code\n*italic* inside code\n| A | B |\n| --- | --- |\n```';
  const diags = validate(text, 'change');
  const insideCodeRules = findByRule(diags, 'note/no-h456')
    .concat(findByRule(diags, 'note/no-italic'))
    .concat(findByRule(diags, 'note/no-table'));
  assert.equal(insideCodeRules.length, 0);
});

test('rules do NOT fire inside fenced code blocks (tilde)', () => {
  const text = '~~~\n#### heading inside code\n*italic* here\n~~~';
  const diags = validate(text, 'change');
  assert.equal(findByRule(diags, 'note/no-h456').length, 0);
  assert.equal(findByRule(diags, 'note/no-italic').length, 0);
});

test('fenced blocks allow three-space indentation and require a matching closing length', () => {
  const protectedResults = validate('   ````\n*not italic*\n   ````', 'change');
  assert.equal(findByRule(protectedResults, 'note/no-italic').length, 0);

  const unclosedResults = validate('````\n*italic*\n```', 'change');
  assert.equal(findByRule(unclosedResults, 'note/no-italic').length, 0);
  assert.equal(findByRule(unclosedResults, 'note/code-fence-unclosed').length, 1);
  assert.equal(findByRule(unclosedResults, 'note/code-fence-unclosed')[0].range.line, 0);
});

test('rules do NOT fire inside display math blocks', () => {
  const text = '$$\n*italic* and #### heading\n$$';
  const diags = validate(text, 'change');
  assert.equal(findByRule(diags, 'note/no-italic').length, 0);
  assert.equal(findByRule(diags, 'note/no-h456').length, 0);
});

test('note-ignore-next-line suppresses diagnostics on the next line', () => {
  const text = '<!-- note-ignore-next-line -->\n#### This should be ignored';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diags.length, 0);
});

test('note-ignore-next-line does NOT suppress the line after the next', () => {
  const text = '<!-- note-ignore-next-line -->\nThis line is ignored\n#### This should be flagged';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].range.line, 2);
});

// ─── Exclusion zones ────────────────────────────────────────────

test('exclusion zones: footnote ref inside inline code is not flagged', () => {
  const text = 'Code: `[^1]` is syntax.';
  const diags = findByRule(validate(text, 'change'), 'note/no-footnote');
  assert.equal(diags.length, 0);
});

test('exclusion zones: italic inside link URL is not flagged', () => {
  const text = 'See [label](https://example.com/*path*) here.';
  const diags = findByRule(validate(text, 'change'), 'note/no-italic');
  // The URL part is an exclusion zone, so italic inside it should not be flagged
  assert.equal(diags.length, 0);
});

test('exclusion zones: footnote-like text inside inline math is not flagged', () => {
  const text = 'Equation $${[^1] + x}$$ here.';
  const diags = findByRule(validate(text, 'change'), 'note/no-footnote');
  assert.equal(diags.length, 0);
});

// =====================================================================
// disabledRules parameter
// =====================================================================

test('disabledRules: passing a rule ID disables it', () => {
  const text = '#### heading';
  const diagsEnabled = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.equal(diagsEnabled.length, 1);

  const diagsDisabled = findByRule(
    validate(text, 'change', undefined, ['note/no-h456']),
    'note/no-h456',
  );
  assert.equal(diagsDisabled.length, 0);
});

test('disabledRules: disabling one rule does not affect others', () => {
  const text = '#### heading\n***';
  const diags = validate(text, 'change', undefined, ['note/no-h456']);
  assert.equal(findByRule(diags, 'note/no-h456').length, 0);
  assert.equal(findByRule(diags, 'note/hr-variant').length, 1);
});

test('disabledRules: multiple rules can be disabled at once', () => {
  const text = '#### heading\n***\n*italic*';
  const diags = validate(text, 'change', undefined, [
    'note/no-h456',
    'note/hr-variant',
    'note/no-italic',
  ]);
  assert.equal(findByRule(diags, 'note/no-h456').length, 0);
  assert.equal(findByRule(diags, 'note/hr-variant').length, 0);
  assert.equal(findByRule(diags, 'note/no-italic').length, 0);
});

// =====================================================================
// Trigger filtering
// =====================================================================

test('change trigger does NOT run save-only rules (image-missing)', () => {
  // image-missing is a save-only rule; with 'change' it should not run
  const text = '![alt](nonexistent.png)';
  const diags = findByRule(validate(text, 'change'), 'note/image-missing');
  assert.equal(diags.length, 0);
});

test('save trigger runs save-only rules', () => {
  // image-missing should run on save trigger (it will look for the file)
  const text = '![alt](nonexistent.png)';
  const diags = findByRule(validate(text, 'save', '/tmp/nonexistent-dir'), 'note/image-missing');
  assert.ok(diags.length >= 1);
});

test('save trigger also runs change-trigger rules', () => {
  const text = '#### heading';
  const diags = findByRule(validate(text, 'save'), 'note/no-h456');
  assert.equal(diags.length, 1);
});

test('validateAsync runs image-missing, image-oversized, and image-unsupported checks', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-validator-'));
  try {
    fs.writeFileSync(path.join(articleDir, 'oversized.png'), Buffer.alloc(20 * 1024 * 1024 + 1));
    fs.writeFileSync(
      path.join(articleDir, 'diagram.svg'),
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
    );
    const text = [
      '![missing](missing.png)',
      '![big](oversized.png)',
      '![svg](diagram.svg)',
      '![remote](https://example.com/missing.png)',
    ].join('\n');

    const diags = await validateAsync(text, articleDir);
    assert.equal(findByRule(diags, 'note/image-missing').length, 1);
    assert.equal(findByRule(diags, 'note/image-oversized').length, 1);
    assert.equal(findByRule(diags, 'note/image-unsupported').length, 1);

    const disabled = await validateAsync(text, articleDir, ['note/image-oversized']);
    assert.equal(findByRule(disabled, 'note/image-oversized').length, 0);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('note/image-unconvertible rejects AVIF instead of promising conversion', () => {
  const results = validate('# T\n\n![avif](photo.avif)', 'save', process.cwd());
  assert.equal(findByRule(results, 'note/image-unconvertible').length, 1);
  assert.equal(findByRule(results, 'note/image-unsupported').length, 0);
});

test('frontmatter eyecatch receives the same image safety diagnostics as body images', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-frontmatter-image-'));
  try {
    const traversal = '---\nnote-md: { eyecatch: ../outside.png }\n---\n# T';
    assert.equal(
      findByRule(validate(traversal, 'change', articleDir), 'note/image-path-traversal').length,
      1,
    );

    const avif = '---\nnote-md: { eyecatch: photo.avif }\n---\n# T';
    assert.equal(
      findByRule(validate(avif, 'save', articleDir), 'note/image-unconvertible').length,
      1,
    );

    const external = '---\nnote-md: { eyecatch: https://example.com/x.png }\n---\n# T';
    assert.equal(
      findByRule(validate(external, 'change', articleDir), 'note/image-external-unverified').length,
      1,
    );

    const missing = '---\nnote-md: { eyecatch: missing.png }\n---\n# T';
    assert.equal(
      findByRule(await validateAsync(missing, articleDir), 'note/image-missing').length,
      1,
    );
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('note/image-low-res warns for encoded images narrower than 620px', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-low-res-'));
  try {
    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(320, 16);
    png.writeUInt32BE(200, 20);
    fs.writeFileSync(path.join(articleDir, 'small.png'), png);
    const diagnostics = await validateAsync('# T\n\n![small](small.png)', articleDir);
    assert.equal(findByRule(diagnostics, 'note/image-low-res').length, 1);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('note/image-low-res skips oversized sparse files without reading the whole image', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-low-res-large-'));
  try {
    const imagePath = path.join(articleDir, 'large.png');
    const header = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(header);
    header.writeUInt32BE(13, 8);
    header.write('IHDR', 12, 'ascii');
    header.writeUInt32BE(320, 16);
    header.writeUInt32BE(200, 20);
    fs.writeFileSync(imagePath, header);
    fs.truncateSync(imagePath, 20 * 1024 * 1024 + 1);

    const diagnostics = await validateAsync('# T\n\n![large](large.png)', articleDir);
    assert.equal(findByRule(diagnostics, 'note/image-oversized').length, 1);
    assert.equal(findByRule(diagnostics, 'note/image-low-res').length, 0);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

// =====================================================================
// QuickFix existence checks
// =====================================================================

test('quickfix: note/no-h456 includes fix', () => {
  const text = '#### heading';
  const diags = findByRule(validate(text, 'change'), 'note/no-h456');
  assert.ok(diags[0].fixes, 'no-h456 should provide fixes');
  assert.ok(diags[0].fixes.length > 0);
});

test('quickfix: note/hr-variant includes fix', () => {
  const text = '***';
  const diags = findByRule(validate(text, 'change'), 'note/hr-variant');
  assert.ok(diags[0].fixes, 'hr-variant should provide fixes');
  assert.ok(diags[0].fixes.length > 0);
});

test('quickfix: note/no-inline-code includes fix', () => {
  const text = 'use `code` here';
  const diags = findByRule(validate(text, 'change'), 'note/no-inline-code');
  assert.ok(diags[0].fixes, 'no-inline-code should provide fixes');
  assert.ok(diags[0].fixes.length > 0);
});

test('quickfix: note/no-italic includes fix', () => {
  const text = 'this is *italic* text';
  const diags = findByRule(validate(text, 'change'), 'note/no-italic');
  assert.ok(diags[0].fixes, 'no-italic should provide fixes');
  assert.ok(diags[0].fixes.length > 0);
});

test('quickfix: note/multiple-h1 includes fix', () => {
  const text = '# Title\n# Second';
  const diags = findByRule(validate(text, 'change'), 'note/multiple-h1');
  assert.ok(diags[0].fixes, 'multiple-h1 should provide fixes');
  assert.ok(diags[0].fixes.length > 0);
});

test('quickfix: note/no-image-title includes fix', () => {
  const text = '![alt](image.png "title")';
  const diags = findByRule(validate(text, 'change'), 'note/no-image-title');
  assert.ok(diags[0].fixes, 'no-image-title should provide fixes');
  assert.ok(diags[0].fixes.length > 0);
});

// =====================================================================
// note/unsupported-version — forward-compat marker
// =====================================================================

test('unsupported-version: fires when note-md.version exceeds supported schema', () => {
  const text = '---\nnote-md: { version: 99 }\n---\n\n# Title';
  const diags = findByRule(validate(text, 'change'), 'note/unsupported-version');
  assert.equal(diags.length, 1);
  assert.equal(diags[0].severity, 'info');
});

test('unsupported-version: silent for current or absent version', () => {
  assert.equal(
    findByRule(
      validate('---\nnote-md: { version: 1 }\n---\n# T', 'change'),
      'note/unsupported-version',
    ).length,
    0,
  );
  assert.equal(
    findByRule(validate('---\nnote-md:\n---\n# T', 'change'), 'note/unsupported-version').length,
    0,
  );
});

test('unsupported-version: silent when opted out', () => {
  const text = '---\nnote-md: false\n---\n# T';
  assert.equal(findByRule(validate(text, 'change'), 'note/unsupported-version').length, 0);
});
