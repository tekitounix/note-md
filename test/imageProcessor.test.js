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
let cancelOnUpload = false;
let cancellationListeners = [];
const uploads = [];
const VALID_PNG = fs.readFileSync(path.join(__dirname, '..', 'media', 'icon-marketplace.png'));

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
              onCancellationRequested(listener) {
                cancellationListeners.push(listener);
                return { dispose() {} };
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
      async uploadWithRegistry(
        data,
        fileName,
        sourceRef,
        registry,
        _expiry,
        _force,
        signal,
        resource,
      ) {
        if (cancelOnUpload) {
          isCancelled = true;
          for (const listener of cancellationListeners) listener();
          signal?.throwIfAborted();
        }
        const digest = hash(data);
        const url = `https://example.com/${encodeURIComponent(fileName)}`;
        uploads.push({ data: Buffer.from(data), fileName, sourceRef, signal, resource });
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
  cancelOnUpload = false;
  cancellationListeners = [];
  uploads.length = 0;
  messages.errors = [];
  messages.infos = [];
  resetImageProcessorCache();
});

function makeDocument(fileName, text) {
  return {
    fileName,
    uri: { fsPath: fileName },
    getText() {
      return text;
    },
  };
}

test('processImages carries the document URI into the upload service scope', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-'));
  try {
    fs.writeFileSync(path.join(articleDir, 'image.png'), VALID_PNG);
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![image](image.png)');
    await processImages(doc, '1h', false, process.cwd());
    assert.equal(uploads[0].resource, doc.uri);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages rejects missing local images instead of returning a partial urlMap', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-'));
  try {
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![missing](missing.png)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /未処理/);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages rejects a symlink that escapes the article directory', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-symlink-'));
  const articleDir = path.join(root, 'article');
  try {
    fs.mkdirSync(articleDir);
    fs.writeFileSync(path.join(root, 'outside.png'), VALID_PNG);
    fs.symlinkSync(path.join(root, 'outside.png'), path.join(articleDir, 'linked.png'));
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![linked](linked.png)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /未処理/);
    assert.equal(uploads.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
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

test('processImages rejects more than 50 images before reading files', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-count-'));
  try {
    const markdown = Array.from({ length: 51 }, (_, i) => `![${i}](${i}.png)`).join('\n');
    const doc = makeDocument(path.join(articleDir, 'article.md'), markdown);
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /50 件/);
    assert.equal(uploads.length, 0);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages rejects dangerous dimensions before decode or upload', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-dimension-'));
  try {
    const png = Buffer.from(VALID_PNG);
    png.writeUInt32BE(9000, 16);
    fs.writeFileSync(path.join(articleDir, 'huge.png'), png);
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![huge](huge.png)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /未処理/);
    assert.equal(uploads.length, 0);
    assert.ok(messages.errors.some((message) => message.includes('画像寸法')));
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages rejects extension spoofing and undecidable raster dimensions before decode', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-magic-'));
  try {
    const jpegHeader = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x02, 0x03, 0x01, 0x11, 0x00,
      0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
    ]);
    fs.writeFileSync(path.join(articleDir, 'spoofed.png'), jpegHeader);
    const tiffWithoutDimensions = Buffer.from('49492a00080000000000000000000000', 'hex');
    fs.writeFileSync(path.join(articleDir, 'unknown.tiff'), tiffWithoutDimensions);

    const markdown = '![spoofed](spoofed.png)\n\n![tiff](unknown.tiff)';
    await assert.rejects(
      () => processImages(makeDocument(path.join(articleDir, 'article.md'), markdown)),
      /未処理/,
    );
    assert.equal(uploads.length, 0);
    assert.ok(messages.errors.some((message) => message.includes('拡張子と実際の画像形式')));
    assert.ok(messages.errors.some((message) => message.includes('デコード前に画像寸法')));
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages stops immediately when aggregate source bytes exceed 100MB', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-total-'));
  try {
    const refs = [];
    for (let i = 0; i < 6; i++) {
      const data = Buffer.alloc(18 * 1024 * 1024, i);
      VALID_PNG.copy(data);
      const name = `large-${i}.png`;
      fs.writeFileSync(path.join(articleDir, name), data);
      refs.push(`![${i}](${name})`);
    }
    await assert.rejects(
      () =>
        processImages(
          makeDocument(path.join(articleDir, 'article.md'), refs.join('\n\n')),
          '1h',
          false,
          process.cwd(),
        ),
      /合計サイズが 100MB/,
    );
    assert.equal(uploads.length, 0);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages strips JPEG EXIF metadata and the original basename before upload', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-exif-'));
  try {
    const { Jimp } = require('jimp');
    const image = new Jimp({ width: 2, height: 2, color: 0xffffffff });
    const jpeg = Buffer.from(await image.getBuffer('image/jpeg'));
    const exifPayload = Buffer.concat([
      Buffer.from('Exif\0\0', 'binary'),
      Buffer.from('GPSLatitude=35.0000;OriginalSecretName', 'ascii'),
    ]);
    const app1 = Buffer.alloc(exifPayload.length + 4);
    app1[0] = 0xff;
    app1[1] = 0xe1;
    app1.writeUInt16BE(exifPayload.length + 2, 2);
    exifPayload.copy(app1, 4);
    const withExif = Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
    fs.writeFileSync(path.join(articleDir, 'private-location.jpg'), withExif);

    await processImages(
      makeDocument(path.join(articleDir, 'article.md'), '![photo](private-location.jpg)'),
      '1h',
      false,
      process.cwd(),
    );

    assert.equal(uploads.length, 1);
    assert.match(uploads[0].fileName, /^note-md-[0-9a-f]{16}\.png$/);
    assert.equal(uploads[0].data.includes(Buffer.from('Exif')), false);
    assert.equal(uploads[0].data.includes(Buffer.from('GPSLatitude')), false);
    assert.equal(uploads[0].fileName.includes('private-location'), false);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages rejects GIF and HEIC instead of sending original metadata', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-format-'));
  try {
    fs.writeFileSync(path.join(articleDir, 'animated.gif'), Buffer.from('GIF89a'));
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![gif](animated.gif)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /未処理/);
    assert.equal(uploads.length, 0);
    assert.ok(messages.errors.some((message) => message.includes('安全に送信できない')));
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages uploads identical supported images once and maps every source reference', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-success-'));
  try {
    const bytes = VALID_PNG;
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
    assert.match(uploads[0].fileName, /^note-md-[0-9a-f]{16}\.png$/);
    assert.ok(!uploads[0].fileName.includes('a.png'));
    assert.equal(urlMap['a.png'], urlMap['figures/copy.png']);
    assert.ok(messages.infos.some((message) => message.includes('1件アップロード')));
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages propagates cancellation to an in-flight upload', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-abort-'));
  try {
    fs.writeFileSync(path.join(articleDir, 'image.png'), VALID_PNG);
    cancelOnUpload = true;
    const doc = makeDocument(path.join(articleDir, 'article.md'), '![image](image.png)');
    await assert.rejects(() => processImages(doc, '1h', false, process.cwd()), /キャンセル/);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('processImages resolves Markdown escapes and HTML entities like the renderer', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-canonical-'));
  try {
    fs.writeFileSync(path.join(articleDir, 'a(final).png'), VALID_PNG);
    fs.writeFileSync(path.join(articleDir, 'a&b.png'), VALID_PNG);
    const markdown = '![escaped](a\\(final\\).png)\n\n![entity](a&amp;b.png)';
    const urlMap = await processImages(
      makeDocument(path.join(articleDir, 'article.md'), markdown),
      '1h',
      false,
      process.cwd(),
    );
    assert.deepEqual(Object.keys(urlMap).sort(), ['a&b.png', 'a(final).png']);
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
    assert.match(uploads[0].fileName, /^note-md-[0-9a-f]{16}\.png$/);
    assert.deepEqual([...uploads[0].data.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(urlMap['diagram.svg'], `https://example.com/${uploads[0].fileName}`);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});

test('resetImageProcessorCache does not reinitialize process-wide WASM modules', async () => {
  const articleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'note-md-images-svg-reset-'));
  try {
    fs.copyFileSync(
      path.join(process.cwd(), 'test-workspace', 'figures', 'diagram.svg'),
      path.join(articleDir, 'first.svg'),
    );
    fs.copyFileSync(
      path.join(process.cwd(), 'test-workspace', 'figures', 'diagram.svg'),
      path.join(articleDir, 'second.svg'),
    );
    await processImages(
      makeDocument(path.join(articleDir, 'first.md'), '![first](first.svg)'),
      '1h',
      false,
      process.cwd(),
    );
    resetImageProcessorCache();
    await processImages(
      makeDocument(path.join(articleDir, 'second.md'), '![second](second.svg)'),
      '1h',
      false,
      process.cwd(),
    );
    assert.equal(uploads.length, 2);
  } finally {
    fs.rmSync(articleDir, { recursive: true, force: true });
  }
});
