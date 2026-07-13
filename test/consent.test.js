const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let enabledServices = ['litterbox.catbox.moe'];
let trusted = true;
let modalPrompts = 0;
let deferredChoice;
const messages = [];

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        get isTrusted() {
          return trusted;
        },
        getConfiguration() {
          return { get: (_key, fallback) => enabledServices ?? fallback };
        },
        getWorkspaceFolder(resource) {
          return resource?.folder
            ? { uri: { toString: () => `file://${resource.folder}` } }
            : undefined;
        },
      },
      window: {
        async showWarningMessage(message, options) {
          messages.push(String(message));
          if (options?.detail) messages.push(String(options.detail));
          if (options?.modal) {
            modalPrompts++;
            return deferredChoice ? deferredChoice.promise : '商用条件を含む規約を確認済み';
          }
          return undefined;
        },
        showInformationMessage(message) {
          messages.push(String(message));
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ensureUploadConsent, revokeUploadConsent } = require('../out/consent.js');
Module._load = originalLoad;

function resource(folder) {
  return { folder, toString: () => `file://${folder}/article.md` };
}

function createContext() {
  const state = new Map();
  return {
    state,
    workspaceState: {
      get(key) {
        return state.get(key);
      },
      async update(key, value) {
        if (value === undefined) state.delete(key);
        else state.set(key, value);
      },
      keys() {
        return [...state.keys()];
      },
    },
  };
}

test.beforeEach(() => {
  enabledServices = ['litterbox.catbox.moe'];
  trusted = true;
  modalPrompts = 0;
  deferredChoice = undefined;
  messages.length = 0;
});

test('consent is scoped by workspace folder and provider without storing raw paths', async () => {
  const context = createContext();
  const one = resource('/private/project-one');
  const two = resource('/private/project-two');

  assert.equal(await ensureUploadConsent(context, one), true);
  assert.equal(await ensureUploadConsent(context, one), true);
  assert.equal(await ensureUploadConsent(context, two), true);
  assert.equal(modalPrompts, 2);
  assert.ok([...context.state.keys()].every((key) => !key.includes('/private/')));
});

test('disabled, unknown, untrusted, and automatic paths never prompt or persist', async () => {
  const context = createContext();
  const uri = resource('/project');

  enabledServices = [];
  assert.equal(await ensureUploadConsent(context, uri, { interactive: false }), false);

  enabledServices = ['imgbb.com'];
  assert.equal(await ensureUploadConsent(context, uri), false);

  enabledServices = ['litterbox.catbox.moe'];
  trusted = false;
  assert.equal(await ensureUploadConsent(context, uri), false);

  trusted = true;
  assert.equal(await ensureUploadConsent(context, uri, { interactive: false }), false);
  assert.equal(modalPrompts, 0);
  assert.equal(context.state.size, 0);
});

test('files outside a workspace folder are rejected and never share consent', async () => {
  const context = createContext();
  const looseOne = { toString: () => 'file:///private/one/article.md' };
  const looseTwo = { toString: () => 'file:///private/two/article.md' };

  assert.equal(await ensureUploadConsent(context, looseOne), false);
  assert.equal(await ensureUploadConsent(context, looseTwo), false);
  assert.equal(modalPrompts, 0);
  assert.equal(context.state.size, 0);
  assert.ok(messages.every((message) => !message.includes('/private/')));
});

test('consent prompt states the Catbox terms and commercial approval condition', async () => {
  const context = createContext();
  assert.equal(await ensureUploadConsent(context, resource('/project')), true);
  assert.ok(messages.some((message) => message.includes('https://catbox.moe/legal.php')));
  assert.ok(messages.some((message) => message.includes('書面による明示的な事前許可')));
});

test('concurrent requests share one modal and setting changes invalidate the result', async () => {
  const context = createContext();
  const uri = resource('/project');
  let resolveChoice;
  deferredChoice = {
    promise: new Promise((resolve) => {
      resolveChoice = resolve;
    }),
  };

  const first = ensureUploadConsent(context, uri);
  const second = ensureUploadConsent(context, uri);
  enabledServices = [];
  resolveChoice('商用条件を含む規約を確認済み');

  assert.equal(await first, false);
  assert.equal(await second, false);
  assert.equal(modalPrompts, 1);
  assert.equal(context.state.size, 0);
});

test('revocation removes only the active folder scope', async () => {
  const context = createContext();
  const one = resource('/project-one');
  const two = resource('/project-two');
  await ensureUploadConsent(context, one);
  await ensureUploadConsent(context, two);

  await revokeUploadConsent(context, one);

  assert.equal(await ensureUploadConsent(context, one, { interactive: false }), false);
  assert.equal(await ensureUploadConsent(context, two, { interactive: false }), true);
  assert.match(messages.at(-1), /外部 URL/);
});
