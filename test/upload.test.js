const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const Module = require('node:module');
const { setTimeout } = require('node:timers');

let uploadCalls = 0;
let enabledServiceNames = ['test-service'];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === './services' && parent?.filename.endsWith('/out/upload.js')) {
    return {
      getEnabledUploadServiceNames() {
        return new Set(enabledServiceNames);
      },
      getServiceManager() {
        return {
          async upload() {
            uploadCalls++;
            const serviceName = enabledServiceNames[0];
            await new Promise((resolve) => setTimeout(resolve, 20));
            return {
              url: 'https://example.com/shared.png',
              serviceName,
              expiresAt: Date.now() + 60_000,
            };
          },
        };
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  loadRegistry,
  loadUrlMap,
  rememberSourceRef,
  resetUploadCache,
  saveRegistry,
  uploadWithRegistry,
} = require('../out/upload.js');

test.beforeEach(() => {
  uploadCalls = 0;
  enabledServiceNames = ['test-service'];
  resetUploadCache();
});

test('identical uploads are not shared across different enabled service scopes', async () => {
  const registry = loadRegistry('/tmp/note-md-upload-service-scope');
  const data = Buffer.from('same bytes');

  enabledServiceNames = ['service-a'];
  const first = uploadWithRegistry(data, 'a.png', 'a.png', registry, '1h');
  enabledServiceNames = ['service-b'];
  const second = uploadWithRegistry(data, 'b.png', 'b.png', registry, '1h');

  await assert.rejects(first, /サービス設定が変更/);
  const result = await second;
  assert.equal(result.serviceName, 'service-b');
  assert.equal(uploadCalls, 2);
});

test('loadUrlMap preserves multiple source refs for the same cached upload', () => {
  const articleDir = '/tmp/note-md-upload-test';
  const registry = loadRegistry(articleDir);
  registry.sameHash = {
    url: 'https://example.com/shared.png',
    sourceRefs: ['figures/a.png', 'images/a.png'],
    uploadedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    serviceName: 'test-service',
  };

  assert.deepEqual(loadUrlMap(articleDir), {
    'figures/a.png': 'https://example.com/shared.png',
    'images/a.png': 'https://example.com/shared.png',
  });
});

test('saveRegistry invalidates materialized urlMap snapshots after source refs change', () => {
  const articleDir = '/tmp/note-md-upload-snapshot';
  const registry = loadRegistry(articleDir);
  registry.sameHash = {
    url: 'https://example.com/shared.png',
    sourceRefs: ['figures/a.png'],
    uploadedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    serviceName: 'test-service',
  };
  loadUrlMap(articleDir);
  rememberSourceRef(registry.sameHash, 'images/a.png');
  saveRegistry(articleDir, registry);

  assert.deepEqual(loadUrlMap(articleDir), {
    'figures/a.png': 'https://example.com/shared.png',
    'images/a.png': 'https://example.com/shared.png',
  });
});

test('concurrent identical uploads share one network request and retain every source ref', async () => {
  const articleDir = '/tmp/note-md-upload-concurrent';
  const registry = loadRegistry(articleDir);
  const data = Buffer.from('same image bytes');

  await Promise.all([
    uploadWithRegistry(data, 'a.png', 'figures/a.png', registry, '1h'),
    uploadWithRegistry(data, 'b.png', 'images/b.png', registry, '1h'),
  ]);

  assert.equal(uploadCalls, 1);
  assert.deepEqual(loadUrlMap(articleDir), {
    'figures/a.png': 'https://example.com/shared.png',
    'images/b.png': 'https://example.com/shared.png',
  });
});
