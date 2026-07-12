const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const manifest = require('../package.json');
const { RULE_IDS } = require('../out/validator.js');

const cli = path.join(__dirname, '..', 'dist', 'cli.js');

test('CLI rule IDs stay aligned with the VS Code configuration enum', () => {
  const configured =
    manifest.contributes.configuration.properties['note-md.validator.disabledRules'].items.enum;
  assert.deepEqual(configured, RULE_IDS);
});

function runCli(args, input = '') {
  return spawnSync(process.execPath, [cli, ...args], {
    input,
    encoding: 'utf8',
  });
}

test('CLI checks stdin and returns a validation exit code', () => {
  const result = runCli(['check', '--stdin', '--strict'], '# title\n\n*italic*\n');
  assert.equal(result.status, 1);
  assert.match(result.stdout, /note\/no-italic/);
  assert.equal(result.stderr, '');
});

test('CLI emits machine-readable JSON and SARIF', () => {
  const json = runCli(['check', '--stdin', '--format', 'json'], '# title\n\n#### deep\n');
  assert.equal(json.status, 0);
  const parsedJson = JSON.parse(json.stdout);
  assert.equal(parsedJson[0].diagnostics[0].ruleId, 'note/no-h456');

  const sarif = runCli(['check', '--stdin', '--format', 'sarif'], '# title\n\n#### deep\n');
  assert.equal(sarif.status, 0);
  const parsedSarif = JSON.parse(sarif.stdout);
  assert.equal(parsedSarif.version, '2.1.0');
  assert.equal(parsedSarif.runs[0].results[0].ruleId, 'note/no-h456');
});

test('CLI rejects unknown rule IDs as usage errors', () => {
  const result = runCli(['check', '--stdin', '--disable', 'note/not-a-rule'], '# title\n\nbody\n');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /不明なルール ID/);
});
