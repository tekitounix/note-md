const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const messages = {
  errors: [],
  infos: [],
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      ProgressLocation: {
        Notification: 15,
      },
      window: {
        showErrorMessage(message) {
          messages.errors.push(String(message));
        },
        showInformationMessage(message) {
          messages.infos.push(String(message));
        },
        withProgress(_options, task) {
          return task(
            { report() {} },
            {
              isCancellationRequested: false,
            },
          );
        },
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

const { processImages } = require('../out/imageProcessor.js');

function makeDocument(fileName, text) {
  return {
    fileName,
    getText() {
      return text;
    },
  };
}

test('processImages rejects missing local images instead of returning a partial urlMap', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-'));
  try {
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![missing](missing.png)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /未処理/);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages rejects supported images larger than the note 20MB limit before upload', async () => {
  messages.errors = [];
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-'));
  try {
    fs.writeFileSync(path.join(articleDir, 'big.png'), Buffer.alloc(20 * 1024 * 1024 + 1));
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![big](big.png)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /未処理/);
    assert.ok(messages.errors.some((m) => m.includes('20MB')));
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});
