const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');
const { RULE_IDS } = require('../out/validator.js');

const cli = path.join(__dirname, '..', 'dist', 'cli.js');

test('CLI rule IDs stay aligned with the VS Code configuration enum', () => {
  const configured =
    manifest.contributes.configuration.properties['note-md.validator.disabledRules'].items.enum;
  assert.deepEqual(configured, RULE_IDS);
});

test('extension manifest keeps external image upload opt-in and disables Restricted Mode', () => {
  const upload = manifest.contributes.configuration.properties['note-md.enabledUploadServices'];
  assert.deepEqual(upload.default, []);
  assert.deepEqual(upload.items.enum, ['litterbox.catbox.moe']);
  assert.equal(manifest.capabilities.untrustedWorkspaces.supported, false);
  assert.ok(
    manifest.contributes.commands.some(
      (command) => command.command === 'note-md.revokeUploadConsent',
    ),
  );
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
  assert.deepEqual(parsedSarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation, {
    uri: 'stdin.md',
    uriBaseId: '%SRCROOT%',
  });
});

test('CLI SARIF uses an encoded repository-relative artifact URI', () => {
  const file = path.join(__dirname, 'sarif file #.md');
  fs.writeFileSync(file, '# T\n\n#### deep\n');
  try {
    const result = runCli(['check', '--format', 'sarif', file]);
    assert.equal(result.status, 0);
    const sarif = JSON.parse(result.stdout);
    const location = sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation;
    assert.deepEqual(location, {
      uri: 'test/sarif%20file%20%23.md',
      uriBaseId: '%SRCROOT%',
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('CLI rejects unknown rule IDs as usage errors', () => {
  const result = runCli(['check', '--stdin', '--disable', 'note/not-a-rule'], '# title\n\nbody\n');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /不明なルール ID/);
});
