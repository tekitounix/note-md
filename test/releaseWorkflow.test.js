const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workflowDir = path.join(__dirname, '..', '.github', 'workflows');

test('external GitHub Actions are pinned to immutable commit SHAs', () => {
  for (const name of fs.readdirSync(workflowDir).filter((file) => file.endsWith('.yml'))) {
    const source = fs.readFileSync(path.join(workflowDir, name), 'utf8');
    for (const match of source.matchAll(/^\s*-?\s*uses:\s*([^\s#]+)/gm)) {
      const action = match[1];
      if (action.startsWith('./')) continue;
      assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${name}: ${action}`);
    }
  }
});

test('release workflow resolves an exact main-ancestor tag to one commit SHA', () => {
  const source = fs.readFileSync(path.join(workflowDir, 'release.yml'), 'utf8');
  assert.match(source, /fetch-depth: 0/);
  assert.match(source, /git show-ref --verify --quiet "refs\/tags\/\$TAG"/);
  assert.match(source, /git merge-base --is-ancestor "\$release_sha" origin\/main/);
  assert.match(source, /git checkout --detach "\$release_sha"/);
  assert.match(source, /ref: \$\{\{ needs\.release\.outputs\.release_sha \}\}/);
});

test('workflows install the non-npm local gate tools with a pinned checksum', () => {
  for (const name of ['ci.yml', 'release.yml']) {
    const source = fs.readFileSync(path.join(workflowDir, name), 'utf8');
    assert.match(source, /sudo apt-get install -y shellcheck xvfb/);
    assert.match(source, /actionlint_1\.7\.12_linux_amd64\.tar\.gz/);
    assert.match(source, /8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8/);
    assert.match(source, /sha256sum --check --strict/);
  }
});
