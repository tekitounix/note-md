const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { Buffer } = require('node:buffer');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const messages = {
  errors: [],
  infos: [],
};
let isCancelled = false;
const uploads = [];

function hash(data) {
  return createHash('sha256').update(data).digest('hex');
}

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
              get isCancellationRequested() {
                return isCancelled;
              },
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
  if (request === './upload' && parent?.filename.endsWith('/out/imageProcessor.js')) {
    return {
      sha256: hash,
      loadRegistry() {
        return {};
      },
      rememberSourceRef(entry, sourceRef) {
        if (!entry.sourceRefs.includes(sourceRef)) entry.sourceRefs.push(sourceRef);
      },
      saveRegistry() {},
      async uploadWithRegistry(data, fileName, sourceRef, registry) {
        const digest = hash(data);
        const url = `https://example.com/${encodeURIComponent(fileName)}`;
        uploads.push({ data: Buffer.from(data), fileName, sourceRef });
        registry[digest] = {
          url,
          sourceRefs: [sourceRef],
          uploadedAt: Date.now(),
          expiresAt: Date.now() + 60_000,
          serviceName: 'test-service',
        };
        return {
          fileName,
          url,
          sha256: digest,
          cached: false,
          serviceName: 'test-service',
        };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { processImages, resetImageProcessorCache } = require('../out/imageProcessor.js');

test.beforeEach(() => {
  isCancelled = false;
  uploads.length = 0;
  messages.errors = [];
  messages.infos = [];
  resetImageProcessorCache();
});

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

test('processImages fails closed when image processing is cancelled', async () => {
  isCancelled = true;
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-'));
  try {
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![cancelled](image.png)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /キャンセル/);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages uploads identical supported images once and maps every source reference', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-success-'));
  try {
    const bytes = Buffer.from('same supported image bytes');
    fs.mkdirSync(path.join(articleDir, 'figures'));
    fs.writeFileSync(path.join(articleDir, 'a.png'), bytes);
    fs.writeFileSync(path.join(articleDir, 'figures', 'copy.png'), bytes);
    const markdown = ['![a](a.png)', '![copy](figures/copy.png)'].join('\n\n');

    const urlMap = await processImages(
      makeDocument(path.join(articleDir, 'article.md'), markdown),
      '1h',
      false,
      process.cwd(),
    );

    assert.equal(uploads.length, 1);
    assert.equal(urlMap['a.png'], urlMap['figures/copy.png']);
    assert.ok(messages.infos.some((message) => message.includes('1件アップロード')));
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages converts SVG to a PNG before upload', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-svg-'));
  try {
    fs.copyFileSync(
      path.join(process.cwd(), 'test-workspace', 'figures', 'diagram.svg'),
      path.join(articleDir, 'diagram.svg'),
    );

    const urlMap = await processImages(
      makeDocument(path.join(articleDir, 'article.md'), '![diagram](diagram.svg)'),
      '1h',
      false,
      process.cwd(),
    );

    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].fileName, 'diagram.png');
    assert.deepEqual([...uploads[0].data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(urlMap['diagram.svg'], 'https://example.com/diagram.png');
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});
