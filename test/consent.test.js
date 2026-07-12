const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let enabledServices = ['litterbox.catbox.moe'];
let prompts = 0;
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration() {
          return { get: (_key, fallback) => enabledServices ?? fallback };
        },
      },
      window: {
        async showWarningMessage() {
          prompts++;
          return '同意して続行';
        },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { ensureUploadConsent } = require('../out/consent.js');
Module._load = originalLoad;

test('upload consent is reused only for the same configured service set', async () => {
  const state = new Map();
  const context = {
    globalState: {
      get(key) {
        return state.get(key);
      },
      async update(key, value) {
        state.set(key, value);
      },
    },
  };

  enabledServices = ['litterbox.catbox.moe'];
  assert.equal(await ensureUploadConsent(context), true);
  assert.equal(await ensureUploadConsent(context), true);
  assert.equal(prompts, 1);

  enabledServices = ['litterbox.catbox.moe', 'imgbb.com'];
  assert.equal(await ensureUploadConsent(context), true);
  assert.equal(prompts, 2);
});
