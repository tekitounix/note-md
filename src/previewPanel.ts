import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fsp from 'fs/promises';
import { randomBytes } from 'node:crypto';
import { renderPreview, renderBody } from './render';
import { loadUrlMap } from './upload';
import { ensureUploadConsent } from './consent';
import { extractImageRefs } from './imageProcessor';
import { resolveLocalImageRef, resolveMappedImageUrl } from './imageRefs';
import type { NoteDiagnostic } from './validator';

/**
 * Build a fingerprint string from local image references.
 * Uses mtime+size instead of reading full file contents — avoids
 * expensive blocking I/O on every keystroke.
 */
async function computeImageFingerprint(
  markdown: string,
  articleDir: string,
): Promise<string | null> {
  const refs = extractImageRefs(markdown);
  if (refs.local.length === 0) return null;
  const parts: string[] = [];
  for (const imgRef of [...refs.local].sort()) {
    const resolved = resolveLocalImageRef(articleDir, imgRef);
    if (!resolved) continue;
    try {
      if (!resolved.exists) {
        parts.push(`${resolved.sourceRef}:MISSING`);
        continue;
      }
      const stat = await fsp.stat(resolved.diskPath);
      parts.push(`${resolved.sourceRef}:${stat.mtimeMs}:${stat.size}`);
    } catch {
      parts.push(`${resolved.sourceRef}:MISSING`);
    }
  }
  return parts.length > 0 ? parts.join('\n') : null;
}

export class NotePreviewPanel {
  /** Singleton instance — one preview panel follows the active editor. */
  private static instance: NotePreviewPanel | undefined;
  private static readonly viewType = 'notePreview';

  private readonly panel: vscode.WebviewPanel;
  private documentUri: vscode.Uri;
  private disposables: vscode.Disposable[] = [];
  private uploadTimer: ReturnType<typeof setTimeout> | undefined;
  private uploading = false;
  private pendingUpload = false;
  private consentGranted: boolean | undefined;
  /** Fingerprint of the last successfully processed image set. */
  private lastImageFingerprint: string | null = null;
  /** Monotonic counter — incremented on fullRender to reject stale Webview messages. */
  private generation = 0;
  /** Document version of the last incremental render — skip if unchanged. */
  private lastRenderedVersion = -1;
  /** Temp HTML files created for browser preview — cleaned up on dispose. */
  private tempPreviewFiles: string[] = [];
  /** Callbacks invoked when the panel is disposed. */
  private static onDisposeCallbacks: Array<() => void> = [];

  private constructor(
    panel: vscode.WebviewPanel,
    private readonly context: vscode.ExtensionContext,
    document: vscode.TextDocument,
  ) {
    this.panel = panel;
    this.documentUri = document.uri;

    // Register message listener BEFORE setting HTML.
    // VS Code queues messages sent before the webview is ready,
    // but the extension-side listener must already exist.
    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      null,
      this.disposables,
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    this.fullRender(document);

    // checkAndUpload is triggered by the 'webview-ready' message
    // from the Webview JS after its message listener is set up.
  }

  /** Returns true if the preview panel exists (visible or hidden). */
  static get isActive(): boolean {
    return NotePreviewPanel.instance !== undefined;
  }

  /** Register a callback to be invoked when the panel is disposed. */
  static onDidDispose(callback: () => void): void {
    NotePreviewPanel.onDisposeCallbacks.push(callback);
  }

  static createOrShow(context: vscode.ExtensionContext, document: vscode.TextDocument): void {
    const existing = NotePreviewPanel.instance;
    if (existing) {
      // Switch to different document in the same panel
      existing.switchDocument(document);
      // Only reveal if the panel is not already visible — calling reveal()
      // on an already-visible panel causes VS Code to resize it.
      if (!existing.panel.visible) {
        existing.panel.reveal(vscode.ViewColumn.Beside);
      }
      return;
    }

    // Build localResourceRoots from workspace folders + document directory
    const roots: vscode.Uri[] = [];
    if (vscode.workspace.workspaceFolders) {
      for (const wf of vscode.workspace.workspaceFolders) {
        roots.push(wf.uri);
      }
    }
    // Always include the document's directory (may be outside workspace)
    roots.push(vscode.Uri.file(path.dirname(document.fileName)));

    const panel = vscode.window.createWebviewPanel(
      NotePreviewPanel.viewType,
      `note プレビュー: ${path.basename(document.fileName)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: roots,
      },
    );

    NotePreviewPanel.instance = new NotePreviewPanel(panel, context, document);
  }

  /** Incremental update for the currently tracked document. */
  static update(document: vscode.TextDocument): void {
    const inst = NotePreviewPanel.instance;
    if (inst && inst.documentUri.toString() === document.uri.toString()) {
      inst.incrementalUpdate(document);
      inst.checkAndUpload(document, 2000);
    }
  }

  /**
   * Switch the preview to follow a different document.
   * Called when the active editor changes.
   */
  static follow(document: vscode.TextDocument): void {
    const inst = NotePreviewPanel.instance;
    if (!inst) return; // no preview open — nothing to do
    inst.switchDocument(document);
  }

  /** Scroll the preview to align with the given editor source line. */
  static scrollToLine(documentUri: vscode.Uri, line: number): void {
    const inst = NotePreviewPanel.instance;
    if (inst && inst.documentUri.toString() === documentUri.toString()) {
      inst.panel.webview.postMessage({ type: 'scroll-to-line', line });
    }
  }

  /** Update diagnostics (kept for extension.ts API — no longer rendered in webview). */
  static sendDiagnostics(_documentUri: vscode.Uri, _diagnostics: NoteDiagnostic[]): void {
    // Diagnostics are shown only in the VS Code Problems panel.
  }

  /**
   * Check if image references have changed; if so, schedule upload.
   * If no changes (or all already cached), send existing urlMap to keep
   * the copy button enabled without triggering the upload dialog.
   */
  private async checkAndUpload(document: vscode.TextDocument, delayMs: number): Promise<void> {
    const articleDir = path.dirname(document.fileName);
    const fp = await computeImageFingerprint(document.getText(), articleDir);
    const gen = this.generation;

    if (fp === null) {
      // No local images — enable copy immediately
      this.lastImageFingerprint = null;
      this.panel.webview.postMessage({ type: 'url-map-updated', gen, urlMap: {} });
      return;
    }

    if (fp === this.lastImageFingerprint) {
      // No change — send existing urlMap
      const urlMap = loadUrlMap(articleDir) ?? {};
      this.panel.webview.postMessage({ type: 'url-map-updated', gen, urlMap });
      return;
    }

    // Fingerprint differs
    // Only trust cache on document switch (lastImageFingerprint was null).
    // When tracking the same document, a fingerprint change means image
    // content was modified — always re-upload in that case.
    if (this.lastImageFingerprint === null) {
      const urlMap = loadUrlMap(articleDir);
      if (urlMap && this.allImagesCovered(document.getText(), articleDir, urlMap)) {
        this.lastImageFingerprint = fp;
        this.panel.webview.postMessage({ type: 'url-map-updated', gen, urlMap });
        return;
      }
    }

    // Truly need upload — schedule it
    this.scheduleUpload(delayMs);
  }

  /**
   * Check if the upload cache already has URLs for all local images.
   */
  private allImagesCovered(
    markdown: string,
    articleDir: string,
    urlMap: Record<string, string>,
  ): boolean {
    const refs = extractImageRefs(markdown);
    for (const imgRef of refs.local) {
      const resolved = resolveLocalImageRef(articleDir, imgRef);
      if (!resolved || !resolved.exists) continue;
      if (!resolveMappedImageUrl(urlMap, resolved.sourceRef)) return false;
    }
    return true;
  }

  /** Schedule an auto-upload with debounce. */
  private scheduleUpload(delayMs: number): void {
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.uploadTimer = setTimeout(() => this.runUpload(false), delayMs);
  }

  /** Run image processing. If force=true, ignore cache. */
  private async runUpload(force: boolean): Promise<void> {
    if (this.uploading) {
      this.pendingUpload = true;
      return;
    }

    // Check consent lazily (cached after first grant)
    if (this.consentGranted === undefined) {
      this.consentGranted = await ensureUploadConsent(this.context);
    }
    if (!this.consentGranted) return;

    const editor = vscode.window.visibleTextEditors.find(
      (e) => e.document.uri.toString() === this.documentUri.toString(),
    );
    if (!editor) return;

    // Capture the target document URI to detect stale results after switch
    const targetUri = this.documentUri.toString();
    const gen = this.generation;

    this.uploading = true;
    this.panel.webview.postMessage({ type: 'upload-started', gen });

    try {
      const config = vscode.workspace.getConfiguration('note-md');
      const expiry = config.get<string>('uploadExpiry', '72h');
      const { processImages } = await import('./imageProcessor');
      const urlMap = await processImages(
        editor.document,
        expiry,
        force,
        this.context.extensionPath,
      );

      // Discard results if document was switched during upload
      if (this.documentUri.toString() !== targetUri) return;

      if (urlMap) {
        this.panel.webview.postMessage({ type: 'url-map-updated', gen, urlMap });
      } else {
        this.panel.webview.postMessage({ type: 'url-map-updated', gen, urlMap: {} });
      }
      // Update fingerprint on success
      const articleDir = path.dirname(editor.document.fileName);
      this.lastImageFingerprint = await computeImageFingerprint(
        editor.document.getText(),
        articleDir,
      );
    } catch {
      // Discard error if document was switched during upload
      if (this.documentUri.toString() !== targetUri) return;
      this.panel.webview.postMessage({ type: 'upload-failed', gen });
    } finally {
      this.uploading = false;
      if (this.pendingUpload) {
        this.pendingUpload = false;
        this.scheduleUpload(500);
      }
    }
  }

  /**
   * Switch the panel to display a different document.
   * Performs a full re-render (new nonce, new CSP).
   */
  private switchDocument(document: vscode.TextDocument): void {
    if (this.documentUri.toString() === document.uri.toString()) return;
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    this.pendingUpload = false;
    this.documentUri = document.uri;
    this.lastImageFingerprint = null; // reset for new document
    this.lastRenderedVersion = -1;
    this.panel.title = `note プレビュー: ${path.basename(document.fileName)}`;
    this.fullRender(document);
    // checkAndUpload will be triggered by the 'webview-ready' message
    // after the new page's JS initializes.
  }

  /** Full-page render (initial load or document switch). */
  private fullRender(document: vscode.TextDocument): void {
    this.generation++;
    const markdown = document.getText();
    const articleDir = path.dirname(document.fileName);
    const urlMap = loadUrlMap(articleDir) ?? undefined;
    const webview = this.panel.webview;
    const baseUri = webview.asWebviewUri(vscode.Uri.file(articleDir));
    const nonce = getNonce();
    const html = renderPreview(markdown, {
      urlMap,
      nonce,
      cspSource: webview.cspSource,
      baseUri: baseUri.toString(),
      generation: this.generation,
    });
    webview.html = html;
  }

  /** Incremental DOM update (same document edited). */
  private incrementalUpdate(document: vscode.TextDocument): void {
    if (document.version === this.lastRenderedVersion) return;
    this.lastRenderedVersion = document.version;
    const markdown = document.getText();
    const articleDir = path.dirname(document.fileName);
    const urlMap = loadUrlMap(articleDir) ?? undefined;
    const webview = this.panel.webview;
    const baseUri = webview.asWebviewUri(vscode.Uri.file(articleDir));
    const result = renderBody(markdown, {
      urlMap,
      baseUri: baseUri.toString(),
    });
    webview.postMessage({
      type: 'update',
      gen: this.generation,
      titleHtml: result.titleHtml,
      bodyHtml: result.bodyHtml,
      headerHtml: result.headerHtml,
      tocHtml: result.tocHtml,
      urlMapJson: result.urlMapJson,
      charCount: result.charCount,
    });
  }

  private async handleMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'webview-ready': {
        // Webview JS has initialized and its message listener is active.
        // Now it's safe to send url-map-updated via checkAndUpload.
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === this.documentUri.toString(),
        );
        if (editor) this.checkAndUpload(editor.document, 0);
        break;
      }
      case 'copy': {
        // Webview sends copy data via postMessage because
        // navigator.clipboard.write is not available in Webview iframes.
        const text = String(msg.text ?? '');
        try {
          await vscode.env.clipboard.writeText(text);
          // VS Code API only supports writeText; html is best-effort
          this.panel.webview.postMessage({
            type: 'copy-result',
            ok: true,
            label: String(msg.label ?? ''),
          });
        } catch {
          this.panel.webview.postMessage({
            type: 'copy-result',
            ok: false,
            label: String(msg.label ?? ''),
          });
        }
        break;
      }
      case 'force-upload':
        if (this.consentGranted === false) this.consentGranted = undefined;
        await this.runUpload(true);
        break;
      case 'open-in-browser': {
        const editor = vscode.window.visibleTextEditors.find(
          (e) => e.document.uri.toString() === this.documentUri.toString(),
        );
        if (!editor) return;
        const markdown = editor.document.getText();
        const articleDir = path.dirname(editor.document.fileName);
        const urlMap = loadUrlMap(articleDir) ?? undefined;
        const html = renderPreview(markdown, { urlMap });
        const tmpPath = path.join(os.tmpdir(), `note-md-preview-${randomBytes(4).toString('hex')}.html`);
        await fsp.writeFile(tmpPath, html, 'utf-8');
        this.tempPreviewFiles.push(tmpPath);
        vscode.env.openExternal(vscode.Uri.file(tmpPath));
        break;
      }
      case 'open-cheatsheet': {
        const docPath = path.join(this.context.extensionPath, 'docs', 'format-reference.md');
        try {
          const doc = await vscode.workspace.openTextDocument(docPath);
          NotePreviewPanel.createOrShow(this.context, doc);
        } catch {
          vscode.window.showErrorMessage('書式リファレンスを開けませんでした');
        }
        break;
      }
      case 'show-info':
        vscode.window.showInformationMessage(String(msg.text));
        break;
      case 'show-error':
        vscode.window.showErrorMessage(String(msg.text));
        break;
    }
  }

  private dispose(): void {
    if (this.uploadTimer) clearTimeout(this.uploadTimer);
    NotePreviewPanel.instance = undefined;
    for (const cb of NotePreviewPanel.onDisposeCallbacks) {
      cb();
    }
    for (const f of this.tempPreviewFiles) {
      fsp.unlink(f).catch(() => {});
    }
    this.tempPreviewFiles = [];
    this.panel.dispose();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables = [];
  }
}

function getNonce(): string {
  return randomBytes(16).toString('base64url');
}
