const test = require('node:test');
const assert = require('node:assert/strict');
const { Buffer } = require('node:buffer');
const Module = require('node:module');

let enabledServices = ['litterbox.catbox.moe'];
const enabledServicesByFolder = new Map();
const messages = { warnings: [], infos: [] };

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration(_section, resource) {
          return {
            get(_key, defaultValue) {
              return (
                enabledServicesByFolder.get(resource?.folder) ?? enabledServices ?? defaultValue
              );
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
  enabledServicesByFolder.clear();
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
    calls.push({ url, method: init.method ?? 'GET', redirect: init.redirect });
    if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
    if (url.includes('/resources/internals/api.php')) {
      return response('https://litter.catbox.moe/article.png\n', { status: 200 });
    }
    if (url === 'https://litter.catbox.moe/article.png') {
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

  assert.equal(outcome.url, 'https://litter.catbox.moe/article.png');
  assert.equal(outcome.serviceName, 'litterbox.catbox.moe');
  assert.ok(outcome.expiresAt >= before + 3_600_000);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['HEAD', 'POST', 'GET'],
  );
  assert.ok(calls.every(({ redirect }) => redirect === 'error'));
});

test('ServiceManager rejects comma-separated CORS origins that browsers reject', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
    if (url.includes('/resources/internals/api.php')) {
      return response('https://litter.catbox.moe/article.png', { status: 200 });
    }
    return response(null, {
      status: 206,
      headers: {
        'access-control-allow-origin': '*, https://note.com',
        'content-type': 'image/png',
      },
    });
  };

  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('png'), 'article.png'),
    /CORS/,
  );
});

test('ServiceManager discards stale health checks after service settings change', async () => {
  const manager = new ServiceManager();
  const [litterbox] = manager.services;
  let resolveLitterbox;
  litterbox.healthCheck = () => new Promise((resolve) => (resolveLitterbox = resolve));

  enabledServices = ['litterbox.catbox.moe'];
  const oldInitialization = manager.initialize();
  enabledServices = [];
  const currentInitialization = manager.initialize();

  await currentInitialization;
  resolveLitterbox(true);
  await oldInitialization;

  assert.deepEqual(manager.healthyNames(), []);
});

test('ServiceManager uses the resource-scoped service configuration', async () => {
  const resource = { folder: 'disabled-workspace' };
  enabledServicesByFolder.set(resource.folder, []);

  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('png'), 'article.png', '1h', undefined, resource),
    /有効なアップロードサービス/,
  );
});

test('ServiceManager rejects an unexpected upload domain without fallback', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
    if (url.includes('/resources/internals/api.php')) {
      return response('https://attacker.example/article.png', { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('image'), 'article.webp', '12h'),
    /応答ドメイン/,
  );
});

test('ServiceManager fails closed when the served image has no usable CORS response', async () => {
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
    if (url.includes('/resources/internals/api.php')) {
      return response('https://litter.catbox.moe/article.png', { status: 200 });
    }
    if (url === 'https://litter.catbox.moe/article.png') {
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

test('ServiceManager rejects invalid expiry before upload fetch', async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return response(null, { status: 200 });
  };

  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('png'), 'article.png', 'forever'),
    /保存期間が不正/,
  );
  assert.equal(calls, 1, 'only the health check may run before expiry validation');
});

test('ServiceManager bounds the upload response body', async () => {
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
    return response('x'.repeat(20_000), {
      status: 200,
      headers: { 'content-length': '20000' },
    });
  };

  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('png'), 'article.png'),
    /応答が上限/,
  );
});

test('ServiceManager bounds a chunked upload response without Content-Length', async () => {
  globalThis.fetch = async () => response('x'.repeat(20_000), { status: 200 });
  const controller = new globalThis.AbortController();
  await assert.rejects(
    () => new ServiceManager().upload(Buffer.from('png'), 'article.png', '1h', controller.signal),
    /応答が上限/,
  );
});

test('ServiceManager propagates cancellation into an in-flight fetch', async () => {
  globalThis.fetch = async (_input, init = {}) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        'abort',
        () => reject(new globalThis.DOMException('cancelled', 'AbortError')),
        { once: true },
      );
    });

  const controller = new globalThis.AbortController();
  const pending = new ServiceManager().upload(
    Buffer.from('png'),
    'article.png',
    '1h',
    controller.signal,
  );
  controller.abort();
  await assert.rejects(() => pending, /cancelled|aborted/i);
});

test('ServiceManager rejects credentials, query strings, and sibling origins', async () => {
  for (const returnedUrl of [
    'https://user@litter.catbox.moe/article.png',
    'https://litter.catbox.moe/article.png?token=secret',
    'https://evil.litter.catbox.moe/article.png',
  ]) {
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === 'https://litterbox.catbox.moe/') return response(null, { status: 200 });
      if (url.includes('/resources/internals/api.php'))
        return response(returnedUrl, { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    };
    await assert.rejects(
      () => new ServiceManager().upload(Buffer.from('png'), 'article.png'),
      /想定外|応答ドメイン/,
    );
  }
});
