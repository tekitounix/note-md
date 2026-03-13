import * as vscode from 'vscode';
import * as path from 'path';
import { NotePreviewPanel } from './previewPanel';
import { processImages } from './imageProcessor';
import { getServiceManager, resetServiceManager } from './services';
import { ensureUploadConsent } from './consent';
import { validate, validateAsync, type NoteDiagnostic } from './validator';
import { NoteCodeActionProvider, diagCache } from './codeActions';
import { resetUploadCache } from './upload';

export function activate(context: vscode.ExtensionContext): void {
  // Start upload service health check in the background
  getServiceManager().initialize();

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

  // Clear diagnostics when preview panel is closed
  NotePreviewPanel.onDidDispose(() => {
    diagnostics.clear();
  });

  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.name = 'note-md';
  context.subscriptions.push(statusBar);

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
      setTimeout(() => statusBar.hide(), 5000);
    }),
  );

  // Update preview on editor changes (debounce 300ms)
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'markdown') {
        if (debounceTimer) clearTimeout(debounceTimer);
        const doc = e.document;
        debounceTimer = setTimeout(() => {
          NotePreviewPanel.update(doc);
          if (NotePreviewPanel.isActive) {
            runValidation(doc, 'change', diagnostics);
          }
        }, 300);
      }
    }),
  );

  // Save trigger (runs all rules including I/O-bound ones)
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.languageId === 'markdown' && NotePreviewPanel.isActive) {
        setTimeout(() => runValidation(doc, 'save', diagnostics), 0);
      }
    }),
  );

  // Clear diagnostics when document is closed
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnostics.delete(doc.uri);
    }),
  );

  // Follow active editor — switch preview if open
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.languageId === 'markdown') {
        if (NotePreviewPanel.isActive) {
          NotePreviewPanel.follow(editor.document);
          runValidation(editor.document, 'change', diagnostics);
        }
      }
    }),
  );

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
  diagCache.set(cacheKey, results);

  if (diagCache.size > 10) {
    const keys = [...diagCache.keys()];
    for (let i = 0; i < keys.length - 10; i++) {
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
  const config = vscode.workspace.getConfiguration('note-md');
  const disabledRules = config.get<string[]>('validator.disabledRules', []);
  const articleDir = path.dirname(doc.fileName);

  if (trigger === 'save') {
    // Use async validation for save to avoid blocking on fs I/O
    const version = doc.version;
    void validateAsync(doc.getText(), articleDir, disabledRules).then((results) => {
      // Discard stale results if document changed during async validation
      if (doc.version !== version) return;
      applyDiagnostics(doc, results, collection);
    });
  } else {
    const results = validate(doc.getText(), trigger, articleDir, disabledRules);
    applyDiagnostics(doc, results, collection);
  }
}

export function deactivate(): void {
  resetServiceManager();
  resetUploadCache();
  diagCache.clear();
}
