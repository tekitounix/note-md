/* global suite, test */

const { run } = require('./index');

suite('note-md Extension Host', () => {
  test('runs commands, diagnostics, QuickFix, and preview wiring', async () => {
    await run();
  });
});
