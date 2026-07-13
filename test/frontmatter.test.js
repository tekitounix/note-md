const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseFrontmatter,
  isNoteArticle,
  resolveEyecatch,
  NOTE_MD_SCHEMA_VERSION,
} = require('../out/frontmatter.js');

test('no frontmatter: not a note article', () => {
  const parsed = parseFrontmatter('# Title\n\nbody');
  assert.equal(parsed.noteMd.hasMarker, false);
  assert.equal(isNoteArticle(parsed), false);
  assert.equal(parsed.lineCount, 0);
  assert.equal(parsed.content, '# Title\n\nbody');
});

test('frontmatter without note-md marker: not a note article', () => {
  const parsed = parseFrontmatter('---\ntitle: Hello\ntags: [a, b]\n---\n\n# Title');
  assert.equal(parsed.noteMd.hasMarker, false);
  assert.equal(isNoteArticle(parsed), false);
});

test('bare marker (null): note article, defaults', () => {
  const parsed = parseFrontmatter('---\nnote-md:\n---\n\n# T');
  assert.equal(parsed.noteMd.hasMarker, true);
  assert.equal(parsed.noteMd.optOut, false);
  assert.equal(isNoteArticle(parsed), true);
  assert.deepEqual(parsed.noteMd.config, {});
  assert.equal(parsed.content, '\n# T');
});

test('marker: true is a note article', () => {
  const parsed = parseFrontmatter('---\nnote-md: true\n---\n');
  assert.equal(isNoteArticle(parsed), true);
});

test('marker: false is an explicit opt-out', () => {
  const parsed = parseFrontmatter('---\nnote-md: false\n---\n');
  assert.equal(parsed.noteMd.hasMarker, true);
  assert.equal(parsed.noteMd.optOut, true);
  assert.equal(isNoteArticle(parsed), false);
});

test('flow-style config: eyecatch and version', () => {
  const parsed = parseFrontmatter('---\nnote-md: { eyecatch: cover.png, version: 2 }\n---\n');
  assert.equal(isNoteArticle(parsed), true);
  assert.equal(parsed.noteMd.config.eyecatch, 'cover.png');
  assert.equal(parsed.noteMd.config.version, 2);
  assert.equal(resolveEyecatch(parsed), 'cover.png');
});

test('block-style config: indented children', () => {
  const parsed = parseFrontmatter(
    '---\nnote-md:\n  eyecatch: figures/cover.png\n  version: 1\n---\n\n# T',
  );
  assert.equal(isNoteArticle(parsed), true);
  assert.equal(parsed.noteMd.config.eyecatch, 'figures/cover.png');
  assert.equal(parsed.noteMd.config.version, 1);
});

test('block-style stops at dedent / other top-level keys', () => {
  const parsed = parseFrontmatter('---\nnote-md:\n  eyecatch: a.png\ntitle: Hello\n---\n');
  assert.equal(parsed.noteMd.config.eyecatch, 'a.png');
  // `title` is a sibling top-level key, not a note-md child
  assert.equal(parsed.noteMd.config.version, undefined);
});

test('legacy top-level header alone does NOT make a note article', () => {
  const parsed = parseFrontmatter('---\nheader: cover.png\n---\n');
  assert.equal(isNoteArticle(parsed), false);
  // but eyecatch resolution still falls back to legacy header
  assert.equal(resolveEyecatch(parsed), 'cover.png');
});

test('eyecatch wins over legacy header when both present', () => {
  const parsed = parseFrontmatter('---\nheader: legacy.png\nnote-md: { eyecatch: new.png }\n---\n');
  assert.equal(resolveEyecatch(parsed), 'new.png');
});

test('quoted values and trailing comments are stripped', () => {
  const parsed = parseFrontmatter('---\nnote-md:\n  eyecatch: "cover.png"  # the cover\n---\n');
  assert.equal(parsed.noteMd.config.eyecatch, 'cover.png');
});

test('coexists with other tools’ frontmatter keys', () => {
  const parsed = parseFrontmatter(
    '---\ntitle: Hello\nemoji: "😀"\ntopics: [ts, vscode]\nnote-md: { eyecatch: c.png }\npublished: true\n---\n',
  );
  assert.equal(isNoteArticle(parsed), true);
  assert.equal(parsed.noteMd.config.eyecatch, 'c.png');
});

test('schema version constant is exported', () => {
  assert.equal(typeof NOTE_MD_SCHEMA_VERSION, 'number');
  assert.ok(NOTE_MD_SCHEMA_VERSION >= 1);
});

test('unterminated frontmatter is treated as no frontmatter', () => {
  const parsed = parseFrontmatter('---\nnote-md:\nno closing fence');
  assert.equal(parsed.noteMd.hasMarker, false);
  assert.equal(parsed.lineCount, 0);
});
