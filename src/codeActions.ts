import * as vscode from 'vscode';
import type { NoteDiagnostic } from './validator';

/** Diagnostic cache (URI:version → NoteDiagnostic[]) — shared with extension.ts */
export const diagCache = new Map<string, NoteDiagnostic[]>();

export class NoteCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  provideCodeActions(
    document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext,
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const cacheKey = `${document.uri}:${document.version}`;
    const cached = diagCache.get(cacheKey) ?? [];

    for (const vsdiag of context.diagnostics) {
      if (vsdiag.source !== 'note-md') continue;

      const noteDiag = cached.find(
        (d) =>
          d.ruleId === vsdiag.code &&
          d.range.line === vsdiag.range.start.line &&
          d.range.column === vsdiag.range.start.character,
      );
      if (!noteDiag?.fixes) continue;

      for (const fix of noteDiag.fixes) {
        const action = new vscode.CodeAction(fix.title, vscode.CodeActionKind.QuickFix);
        action.diagnostics = [vsdiag];
        const edit = new vscode.WorkspaceEdit();
        for (const e of fix.edits) {
          edit.replace(
            document.uri,
            new vscode.Range(
              e.range.line,
              e.range.column,
              e.range.line,
              e.range.column + e.range.length,
            ),
            e.newText,
          );
        }
        action.edit = edit;
        actions.push(action);
      }
    }
    return actions;
  }
}
