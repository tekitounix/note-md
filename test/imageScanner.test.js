const test = require('node:test');
const assert = require('node:assert/strict');

const { scanImageReferences } = require('../out/imageScanner.js');

test('image scanner supports spaces, parentheses, reference definitions, HTML, and frontmatter', () => {
  const markdown = [
    '---',
    'header: figures/header image.png',
    '---',
    '',
    '# title',
    '',
    '![space](<figures/my image.png>)',
    '![paren](figures/chart_(final).png)',
    '![reference][hero]',
    '[hero]: figures/reference.png "title"',
    '<img src="figures/from-html.png" alt="HTML image">',
  ].join('\n');

  const references = scanImageReferences(markdown);
  assert.deepEqual(
    references.map((reference) => reference.sourceRef),
    [
      'figures/header image.png',
      'figures/my image.png',
      'figures/chart_(final).png',
      'figures/reference.png',
      'figures/from-html.png',
    ],
  );
  assert.equal(references[1].line, 6);
  assert.equal(references[3].kind, 'reference');
});

test('image scanner ignores escaped markers, code examples, and HTML comments', () => {
  const markdown = [
    '\\![escaped](escaped.png)',
    '`![inline example](inline-code.png)`',
    '```markdown',
    '![example](inside-code.png)',
    '[sample]: inside-code-reference.png',
    '```',
    '<!-- ![commented](comment.png)',
    '<img src="commented-html.png"> -->',
    '\\\\![even slashes](real-after-backslash.png)',
    '![real](real.png)',
  ].join('\n');

  assert.deepEqual(
    scanImageReferences(markdown).map((reference) => reference.sourceRef),
    ['real-after-backslash.png', 'real.png'],
  );
});

test('image scanner canonicalizes destinations and follows CommonMark first definitions', () => {
  const markdown = [
    '![escaped](figures/a\\(final\\).png)',
    '![entity](figures/a&amp;b.png)',
    '<img src=figures/unquoted.png alt="raw">',
    '![hero][same]',
    '[same]: figures/first.png',
    '[same]: figures/second.png',
  ].join('\n');

  assert.deepEqual(
    scanImageReferences(markdown).map((reference) => reference.sourceRef),
    ['figures/a(final).png', 'figures/a&b.png', 'figures/unquoted.png', 'figures/first.png'],
  );
});
