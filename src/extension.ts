import * as vscode from 'vscode';
import { PplCodeActionProvider } from './vscode/codeActions';
import { getPplConfig } from './vscode/config';
import { PplDiagnosticManager } from './vscode/diagnostics';
import { PplHoverProvider } from './vscode/hover';

let diagnosticManager: PplDiagnosticManager | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // 1. Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  statusBarItem.command = 'pplLinter.lintCurrentFile';
  context.subscriptions.push(statusBarItem);

  const updateStatusBar = (totalErrors: number): void => {
    if (!statusBarItem) return;
    const config = getPplConfig();
    if (!config.enabled) {
      statusBarItem.text = '$(circle-slash) PPL';
      statusBarItem.tooltip = 'PPL Linter is disabled';
      statusBarItem.show();
      return;
    }

    if (totalErrors > 0) {
      statusBarItem.text = `$(alert) PPL (${totalErrors})`;
      statusBarItem.tooltip = `PPL Linter: ${totalErrors} issue(s) detected. Click to re-lint.`;
    } else {
      statusBarItem.text = '$(check) PPL';
      statusBarItem.tooltip = 'PPL Linter: No issues detected. Click to re-lint.';
    }
    statusBarItem.show();
  };

  // 2. Diagnostic Manager
  diagnosticManager = new PplDiagnosticManager(updateStatusBar);
  context.subscriptions.push(diagnosticManager);

  // 3. Document Listeners
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument((event) => {
      diagnosticManager?.scheduleLint(event.document);
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      diagnosticManager?.lintDocument(doc);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      diagnosticManager?.lintDocument(doc);
    }),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      diagnosticManager?.clearDocument(doc);
    })
  );

  // 4. Configuration Change Listener
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('pplLinter')) {
        diagnosticManager?.reloadConfig();
        const config = getPplConfig();
        updateStatusBar(0);
      }
    })
  );

  // 5. Code Actions & Hover Providers
  const supportedLanguages = ['ppl', 'yaml', 'toml', 'json'];

  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      supportedLanguages,
      new PplCodeActionProvider(),
      {
        providedCodeActionKinds: PplCodeActionProvider.providedCodeActionKinds,
      }
    ),
    vscode.languages.registerHoverProvider(
      supportedLanguages,
      new PplHoverProvider()
    )
  );

  // 6. Registered Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('pplLinter.lintCurrentFile', () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        diagnosticManager?.lintDocument(activeEditor.document);
        vscode.window.showInformationMessage('PPL: Linted current document.');
      } else {
        vscode.window.showInformationMessage('PPL: No active editor to lint.');
      }
    }),
    vscode.commands.registerCommand('pplLinter.toggleEnabled', async () => {
      const config = vscode.workspace.getConfiguration('pplLinter');
      const current = config.get<boolean>('enabled', true);
      await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage(
        `PPL Linter ${!current ? 'enabled' : 'disabled'}.`
      );
    })
  );

  // Initial pass on currently open documents
  diagnosticManager.reLintOpenDocuments();
  updateStatusBar(0);
}

export function deactivate(): void {
  if (diagnosticManager) {
    diagnosticManager.dispose();
    diagnosticManager = undefined;
  }
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
}
