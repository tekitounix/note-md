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

const { countNoteChars } = require('../out/render.js');
const { loadRegistry, loadUrlMap } = require('../out/upload.js');

test('countNoteChars treats halfwidth and fullwidth ruby markers equally', () => {
  const withFullwidth = '# title\n\n｜漢字《かんじ》です\n';
  const withHalfwidth = '# title\n\n|漢字《かんじ》です\n';

  assert.equal(countNoteChars(withFullwidth), countNoteChars(withHalfwidth));
  assert.equal(countNoteChars(withHalfwidth), '漢字です'.length);
});

test('loadUrlMap preserves multiple source refs for the same cached upload', () => {
  const articleDir = '/tmp/note-md-release-test';
  const registry = loadRegistry(articleDir);
  registry.sameHash = {
    url: 'https://example.com/shared.png',
    sourceRefs: ['figures/a.png', 'images/a.png'],
    uploadedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    serviceName: 'example',
  };

  const urlMap = loadUrlMap(articleDir);
  assert.deepEqual(urlMap, {
    'figures/a.png': 'https://example.com/shared.png',
    'images/a.png': 'https://example.com/shared.png',
  });
});
