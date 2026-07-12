import * as vscode from 'vscode';
import * as path from 'path';
import { NotePreviewPanel } from './previewPanel';
import { processImages, resetImageProcessorCache } from './imageProcessor';
import { resetServiceManager } from './services';
import { ensureUploadConsent } from './consent';
import { validate, validateAsync, type NoteDiagnostic } from './validator';
import { NoteCodeActionProvider, diagCache } from './codeActions';
import { resetUploadCache } from './upload';

const validationRequests = new Map<string, number>();
let nextValidationRequest = 0;

export function activate(context: vscode.ExtensionContext): void {
  // DiagnosticCollection
  const diagnostics = vscode.languages.createDiagnosticCollection('note-md');
  context.subscriptions.push(diagnostics);

  // CodeActionProvider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { language: 'markdown' },
      new NoteCodeActionProvider(),
      { providedCodeActionKinds: NoteCodeActionProvider.providedCodeActionKinds },
    ),
  );

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.name = 'note-md';
  context.subscriptions.push(statusBar);
  let statusHideTimer: ReturnType<typeof setTimeout> | undefined;

  // Open preview command
  context.subscriptions.push(
    vscode.commands.registerCommand('note-md.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Markdown ファイルを開いてください');
        return;
      }
      NotePreviewPanel.createOrShow(context, editor.document);
      runValidation(editor.document, 'change', diagnostics);
    }),
  );

  // Process images command
  context.subscriptions.push(
    vscode.commands.registerCommand('note-md.processImages', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('Markdown ファイルを開いてください');
        return;
      }
      if (!(await ensureUploadConsent(context))) return;
      const config = vscode.workspace.getConfiguration('note-md');
      const expiry = config.get<string>('uploadExpiry', '72h');

      statusBar.text = '$(loading~spin) note 画像を処理中...';
      statusBar.show();
      try {
        const result = await processImages(editor.document, expiry, false, context.extensionPath);
        if (result) {
          const count = Object.keys(result).length;
          statusBar.text = `$(check) note 画像処理完了 (${count}件)`;
        } else {
          statusBar.text = '$(check) note 処理対象なし';
        }
      } catch {
        statusBar.text = '$(warning) note 画像処理失敗';
      }
      if (statusHideTimer) clearTimeout(statusHideTimer);
      statusHideTimer = setTimeout(() => {
        statusHideTimer = undefined;
        statusBar.hide();
      }, 5000);
    }),
  );

  // Update preview and diagnostics on editor changes (per-document debounce).
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  context.subscriptions.push({
    dispose() {
      for (const timer of debounceTimers.values()) clearTimeout(timer);
      debounceTimers.clear();
      if (statusHideTimer) clearTimeout(statusHideTimer);
      statusHideTimer = undefined;
    },
  });
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'markdown') {
        const key = e.document.uri.toString();
        const currentTimer = debounceTimers.get(key);
        if (currentTimer) clearTimeout(currentTimer);
        const doc = e.document;
        const timer = setTimeout(() => {
          debounceTimers.delete(key);
          NotePreviewPanel.update(doc);
          runValidation(doc, 'change', diagnostics);
        }, 300);
        debounceTimers.set(key, timer);
      }
    }),
  );

  // Save trigger (runs all rules including I/O-bound ones)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'markdown') {
        const key = doc.uri.toString();
        const timer = debounceTimers.get(key);
        if (timer) clearTimeout(timer);
        debounceTimers.delete(key);
        NotePreviewPanel.update(doc);
        runValidation(doc, 'save', diagnostics);
      }
    }),
  );

  // Clear diagnostics when document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const timer = debounceTimers.get(key);
      if (timer) clearTimeout(timer);
      debounceTimers.delete(key);
      validationRequests.delete(key);
      for (const cacheKey of diagCache.keys()) {
        if (cacheKey.startsWith(`${doc.uri}:`)) diagCache.delete(cacheKey);
      }
      diagnostics.delete(doc.uri);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId === 'markdown') runValidation(doc, 'change', diagnostics);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('note-md.validator')) return;
      for (const doc of vscode.workspace.textDocuments) {
        if (doc.languageId === 'markdown') runValidation(doc, 'change', diagnostics);
      }
    }),
  );

  // Follow active editor — switch preview if open
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        NotePreviewPanel.follow(editor.document);
        runValidation(editor.document, 'change', diagnostics);
      }
    }),
  );

  for (const doc of vscode.workspace.textDocuments) {
    if (doc.languageId === 'markdown') runValidation(doc, 'change', diagnostics);
  }

  // Editor scroll → preview sync
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (e.textEditor.document.languageId === 'markdown' && e.visibleRanges.length > 0) {
        const topLine = e.visibleRanges[0].start.line;
        NotePreviewPanel.scrollToLine(e.textEditor.document.uri, topLine);
      }
    }),
  );
}

// ─── Validation runner ──────────────────────────────────────

const severityMap = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  info: vscode.DiagnosticSeverity.Information,
  hint: vscode.DiagnosticSeverity.Hint,
} as const;

function applyDiagnostics(
  doc: vscode.TextDocument,
  results: NoteDiagnostic[],
  collection: vscode.DiagnosticCollection,
): void {
  const cacheKey = `${doc.uri}:${doc.version}`;
  for (const key of diagCache.keys()) {
    if (key.startsWith(`${doc.uri}:`)) diagCache.delete(key);
  }
  diagCache.set(cacheKey, results);

  if (diagCache.size > 100) {
    const keys = [...diagCache.keys()];
    for (let i = 0; i < keys.length - 100; i++) {
      diagCache.delete(keys[i]);
    }
  }

  const vsDiags = results.map((d) => {
    const range = new vscode.Range(
      d.range.line,
      d.range.column,
      d.range.line,
      d.range.column + d.range.length,
    );
    const diag = new vscode.Diagnostic(
      range,
      d.message,
      severityMap[d.severity as keyof typeof severityMap],
    );
    diag.source = 'note-md';
    diag.code = d.ruleId;
    return diag;
  });

  collection.set(doc.uri, vsDiags);
  NotePreviewPanel.sendDiagnostics(doc.uri, results);
}

function runValidation(
  doc: vscode.TextDocument,
  trigger: 'change' | 'save',
  collection: vscode.DiagnosticCollection,
): void {
  const requestKey = doc.uri.toString();
  const requestId = ++nextValidationRequest;
  validationRequests.set(requestKey, requestId);
  const config = vscode.workspace.getConfiguration('note-md');
  const disabledRules = config.get<string[]>('validator.disabledRules', []);
  const articleDir = path.dirname(doc.fileName);

  if (trigger === 'save') {
    // Use async validation for save to avoid blocking on fs I/O
    const version = doc.version;
    void validateAsync(doc.getText(), articleDir, disabledRules)
      .then((results) => {
        // Discard stale results if document changed during async validation
        if (doc.version !== version || validationRequests.get(requestKey) !== requestId) return;
        applyDiagnostics(doc, results, collection);
      })
      .catch((error: unknown) => {
        console.error('note-md validation failed', error);
      });
  } else {
    const results = validate(doc.getText(), trigger, articleDir, disabledRules);
    applyDiagnostics(doc, results, collection);
  }
}

export function deactivate(): void {
  resetServiceManager();
  resetImageProcessorCache();
  resetUploadCache();
  validationRequests.clear();
  diagCache.clear();
}
