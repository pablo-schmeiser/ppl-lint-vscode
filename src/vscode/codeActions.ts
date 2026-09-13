import * as vscode from 'vscode';

export class PplCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  public provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'PPL') {
        continue;
      }

      const rawCode =
        typeof diagnostic.code === 'object' && diagnostic.code !== null
          ? diagnostic.code.value
          : diagnostic.code;
      const code = rawCode !== undefined ? String(rawCode) : undefined;
      const data = (diagnostic as any).data;

      // PPL003: Unknown command
      if (code === 'PPL003') {
        const suggestion = data?.suggestion;
        if (suggestion) {
          const action = new vscode.CodeAction(
            `Change to '${suggestion}'`,
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, diagnostic.range, suggestion);
          actions.push(action);
        }
      }

      // PPL002: Missing source
      if (code === 'PPL002') {
        const action = new vscode.CodeAction(
          "Prepend 'source='",
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        action.edit.insert(document.uri, diagnostic.range.start, 'source=');
        actions.push(action);
      }

      // PPL007: Assignment in condition
      if (code === 'PPL007') {
        const textAtRange = document.getText(diagnostic.range);
        const eqIdx = textAtRange.indexOf('=');
        if (eqIdx >= 0) {
          const eqPos = new vscode.Position(
            diagnostic.range.start.line,
            diagnostic.range.start.character + eqIdx
          );
          const eqEndPos = new vscode.Position(
            diagnostic.range.start.line,
            diagnostic.range.start.character + eqIdx + 1
          );

          const action = new vscode.CodeAction(
            "Replace '=' with '=='",
            vscode.CodeActionKind.QuickFix
          );
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, new vscode.Range(eqPos, eqEndPos), '==');
          actions.push(action);
        }
      }

      // PPL005: Unknown function
      if (code === 'PPL005' && data?.suggestion) {
        const action = new vscode.CodeAction(
          `Change to function '${data.suggestion}'`,
          vscode.CodeActionKind.QuickFix
        );
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        action.edit = new vscode.WorkspaceEdit();
        action.edit.replace(document.uri, diagnostic.range, data.suggestion);
        actions.push(action);
      }
    }

    return actions;
  }
}
