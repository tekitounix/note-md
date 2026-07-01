import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@vscode/test-cli';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  files: 'test/suite/extension.test.js',
  version: process.env.NOTE_MD_VSCODE_TEST_VERSION || '1.85.2',
  extensionDevelopmentPath: dirname,
  mocha: {
    timeout: 20000,
  },
});
