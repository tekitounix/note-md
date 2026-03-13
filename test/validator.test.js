const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

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

const { validate } = require('../out/validator.js');

// ─── Helpers ────────────────────────────────────────────────────

/** Return only diagnostics matching the given rule ID. */
function findByRule(diagnostics, ruleId) {
  return diagnostics.filter((d) => d.ruleId === ruleId);
}

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

// ─── note/image-path-traversal ──────────────────────────────────

test('note/image-path-traversal: detects ../ in image path', () => {
  const text = '![alt](../images/pic.png)';
  const diags = findByRule(validate(text, 'change'), 'note/image-path-traversal');
  assert.equal(diags.length, 1);
  assert.ok(diags[0].message.includes('..'));
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

// =====================================================================
// 4.4 Structural validation
// =====================================================================

// ─── note/multiple-h1 ───────────────────────────────────────────

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
