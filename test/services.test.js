const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const Module = require('node:module');

let enabledServices = ['litterbox.catbox.moe'];
const messages = { warnings: [], infos: [] };

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration() {
          return {
            get(_key, defaultValue) {
              return enabledServices ?? defaultValue;
            },
          };
        },
      },
      window: {
        showWarningMessage(message) {
          messages.warnings.push(String(message));
        },
        showInformationMessage(message) {
          messages.infos.push(String(message));
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ServiceManager } = require('../out/services.js');
Module._load = originalLoad;

const originalFetch = globalThis.fetch;

test.beforeEach(() => {
  enabledServices = ['litterbox.catbox.moe'];
  messages.warnings = [];
  messages.infos = [];
});

test.after(() => {
  globalThis.fetch = originalFetch;
});

function response(body, init = {}) {
  return new globalThis.Response(body, init);
}

test('ServiceManager uploads to Litterbox and verifies the served image contract', async () => {
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, method: init.method ?? 'GET' });
    if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
    if (url.includes('/resources/internals/api.php')) {
      return response('https://files.catbox.moe/article.png\n', { status: 200 });
    }
    if (url === 'https://files.catbox.moe/article.png') {
      return response(null, {
        status: 200,
        headers: {
          'access-control-allow-origin': '*',
          'content-type': 'image/png',
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const before = Date.now();
  const outcome = await new ServiceManager().upload(Buffer.from('png'), 'article.png', '1h');

  assert.equal(outcome.url, 'https://files.catbox.moe/article.png');
  assert.equal(outcome.serviceName, 'litterbox.catbox.moe');
  assert.ok(outcome.expiresAt >= before + 3_600_000);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['HEAD', 'POST', 'HEAD'],
  );
});

test('ServiceManager rejects an unexpected upload domain and falls back to ImgBB', async () => {
  enabledServices = ['litterbox.catbox.moe', 'imgbb.com'];
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    calls.push({ url, method });
    if (url === 'https://litterbox.catbox.moe/' || url === 'https://imgbb.com/') {
      return response(null, { status: 200 });
    }
    if (url.includes('/resources/internals/api.php')) {
      return response('https://attacker.example/article.png', { status: 200 });
    }
    if (url === 'https://imgbb.com/json') {
      return response(
        JSON.stringify({
          status_code: 200,
          image: { image: { url: 'https://i.ibb.co/article.png' } },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === 'https://i.ibb.co/article.png' && method === 'HEAD') {
      return response(null, { status: 405 });
    }
    if (url === 'https://i.ibb.co/article.png' && method === 'GET') {
      return response(null, {
        status: 206,
        headers: {
          'access-control-allow-origin': 'https://note.com',
          'content-type': 'image/webp',
        },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const outcome = await new ServiceManager().upload(Buffer.from('image'), 'article.webp', '12h');

  assert.equal(outcome.url, 'https://i.ibb.co/article.png');
  assert.equal(outcome.serviceName, 'imgbb.com');
  assert.ok(calls.some(({ url, method }) => url === outcome.url && method === 'GET'));
});

test('ServiceManager fails closed when the served image has no usable CORS response', async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
    if (url.includes('/resources/internals/api.php')) {
      return response('https://files.catbox.moe/article.png', { status: 200 });
    }
    if (url === 'https://files.catbox.moe/article.png') {
      return response(null, {
        status: init.method === 'GET' ? 206 : 200,
        headers: { 'content-type': 'image/png' },
      });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('png'), 'article.png'),
    /CORS/,
  );
});

test('ServiceManager rejects upload when no service is enabled', async () => {
  enabledServices = [];
  globalThis.fetch = async () => {
    throw new Error('fetch must not run');
  };

  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('png'), 'article.png'),
    /有効なアップロードサービスが設定されていません/,
  );
});
