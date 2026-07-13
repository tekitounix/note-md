const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const vscode = require('vscode');

let tempRoot;

async function run() {
  tempRoot = path.join(os.tmpdir(), `note-md-extension-host-${crypto.randomUUID()}`);
  await fsp.mkdir(tempRoot, { recursive: true });

  try {
    await runNamed('diagnostics stay active independently from preview', testOpenPreview);
    await runNamed('QuickFix applies from Problems diagnostics', testQuickFix);
    await writeSentinel();
  } finally {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

async function writeSentinel() {
  const sentinelPath = process.env.NOTE_MD_EXTENSION_TEST_SENTINEL;
  if (!sentinelPath) return;
  await fsp.mkdir(path.dirname(sentinelPath), { recursive: true });
  await fsp.writeFile(
    sentinelPath,
    JSON.stringify({ ok: true, completedAt: new Date().toISOString() }),
    'utf8',
  );
}

async function runNamed(name, fn) {
  console.log(`Extension Host test: ${name}`);
  await fn();
}

async function testOpenPreview() {
  const doc = await openMarkdown(
    'preview-diagnostics.md',
    [
      '---',
      'note-md:',
      '---',
      '',
      '# テスト記事',
      '',
      '#### 深すぎる見出し',
      '',
      '本文に *斜体* を含める。',
      '',
    ].join('\n'),
  );

  const extension = vscode.extensions.getExtension('tekitounix.note-md');
  assert.ok(extension, 'extension should be installed in test host');
  await waitFor(() => extension.isActive, 'extension activation');

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes('note-md.openPreview'));
  assert.ok(commands.includes('note-md.processImages'));
  assert.ok(commands.includes('note-md.addHeader'));

  // A plain Markdown file without the note-md marker must NOT be validated.
  const plainDoc = await openMarkdown(
    'plain.md',
    ['# 普通のメモ', '', '#### 深い見出し', '', '*斜体* もある。', ''].join('\n'),
  );
  await delay(500);
  const plainDiags = vscode.languages
    .getDiagnostics(plainDoc.uri)
    .filter((diag) => diag.source === 'note-md');
  assert.equal(plainDiags.length, 0, 'unmarked Markdown must produce no note-md diagnostics');
  await vscode.window.showTextDocument(doc, { preview: false });

  // Problems must appear before the preview is opened.
  const diagnostics = await waitForDiagnostics(doc.uri, ['note/no-h456', 'note/no-italic']);
  assert.ok(diagnostics.some((diag) => diag.source === 'note-md'));

  await vscode.commands.executeCommand('note-md.openPreview');

  const initialPreviewTabs = await waitFor(() => {
    const tabs = previewTabs();
    return tabs.length > 0 ? tabs : false;
  }, 'note preview webview tab');
  assert.equal(initialPreviewTabs.length, 1);
  if (initialPreviewTabs[0].input instanceof vscode.TabInputWebview) {
    assert.ok(initialPreviewTabs[0].input.viewType.endsWith('notePreview'));
  }
  assert.match(initialPreviewTabs[0].label, /^note プレビュー:/);

  await vscode.commands.executeCommand('note-md.openPreview');
  await delay(100);
  assert.equal(previewTabs().length, 1);

  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await waitFor(() => previewTabs().length === 0, 'preview tab close');
  const afterClose = await waitForDiagnostics(doc.uri, ['note/no-h456', 'note/no-italic']);
  assert.ok(afterClose.length > 0, 'closing preview must not clear Problems diagnostics');
}

async function testQuickFix() {
  const doc = await openMarkdown(
    'quickfix.md',
    ['---', 'note-md:', '---', '', '# テスト記事', '', '#### 修正対象の見出し', ''].join('\n'),
  );

  await vscode.commands.executeCommand('note-md.openPreview');
  await waitForDiagnostics(doc.uri, ['note/no-h456']);

  // The `#### 修正対象の見出し` heading is on line 6 (after the 4-line header).
  const action = await waitFor(async () => {
    const actions =
      (await vscode.commands.executeCommand(
        'vscode.executeCodeActionProvider',
        doc.uri,
        new vscode.Range(6, 0, 6, 4),
        vscode.CodeActionKind.QuickFix.value,
      )) ?? [];
    return actions.find((item) => item.title === 'h3 (###) に変換') ?? false;
  }, 'h3 quickfix action');
  assert.ok(action?.edit, 'expected h3 quickfix edit');

  const applied = await vscode.workspace.applyEdit(action.edit);
  assert.equal(applied, true);
  assert.match(doc.lineAt(6).text, /^###\s/);
}

async function openMarkdown(fileName, content) {
  const filePath = path.join(tempRoot, fileName);
  await fsp.writeFile(filePath, content, 'utf8');
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath));
  assert.equal(doc.languageId, 'markdown');
  await vscode.window.showTextDocument(doc, { preview: false });
  return doc;
}

async function waitForDiagnostics(uri, expectedCodes) {
  return waitFor(
    () => {
      const diagnostics = vscode.languages.getDiagnostics(uri);
      const codes = new Set(diagnostics.map((diag) => String(diag.code)));
      return expectedCodes.every((code) => codes.has(code)) ? diagnostics : false;
    },
    `diagnostics: ${expectedCodes.join(', ')}`,
  );
}

function previewTabs() {
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter((tab) => tab.label.startsWith('note プレビュー:'));
}

async function waitFor(predicate, description, timeoutMs = 8000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await delay(50);
  }

  throw new Error(`Timed out waiting for ${description}`);
}

module.exports = { run };
