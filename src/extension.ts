import * as vscode from 'vscode';
import { IndexTemplate } from './core/indexTemplates';
import { PplCodeActionProvider } from './vscode/codeActions';
import { getPplConfig } from './vscode/config';
import { PplDiagnosticManager } from './vscode/diagnostics';
import { PplHoverProvider } from './vscode/hover';
import { PplCompletionProvider } from './vscode/completion';
import { IndexTemplateCatalog } from './vscode/indexTemplateCatalog';
import {
  OpenSearchTemplatePrompts,
  OpenSearchTemplateSource,
  validateOpenSearchDomain,
} from './vscode/openSearchTemplates';

let diagnosticManager: PplDiagnosticManager | undefined;
let statusBarItem: vscode.StatusBarItem | undefined;
let indexTemplateCatalog: IndexTemplateCatalog | undefined;
let openSearchTemplateSource: OpenSearchTemplateSource | undefined;

function createOpenSearchTemplatePrompts(output: vscode.OutputChannel): OpenSearchTemplatePrompts {
  return {
    domain: async (defaultValue) => vscode.window.showInputBox({
      title: 'PPL: OpenSearch Domain',
      prompt: 'Enter the OpenSearch domain URL.',
      value: defaultValue || '',
      placeHolder: 'https://opensearch.example.com',
      ignoreFocusOut: true,
      validateInput: validateOpenSearchDomain,
    }),
    username: async (defaultValue) => vscode.window.showInputBox({
      title: 'PPL: OpenSearch Username',
      prompt: 'Enter your OpenSearch username.',
      value: defaultValue || '',
      ignoreFocusOut: true,
      validateInput: (value) => value.trim() ? undefined : 'Username is required.',
    }),
    password: async () => vscode.window.showInputBox({
      title: 'PPL: OpenSearch Password',
      prompt: 'Enter your password. It will not be stored.',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value ? undefined : 'Password is required.',
    }),
    error: (message) => { void vscode.window.showErrorMessage(`PPL OpenSearch: ${message}`); },
    log: (message) => output.appendLine(`[OpenSearch] ${message}`),
  };
}

export function activate(context: vscode.ExtensionContext): void {
  let remoteTemplates: IndexTemplate[] = [];
  const openSearchOutput = vscode.window.createOutputChannel('PPL Linter: OpenSearch');
  context.subscriptions.push(openSearchOutput);
  const onTemplatesChanged = (): void => diagnosticManager?.reLintOpenDocuments();
  indexTemplateCatalog = new IndexTemplateCatalog(getPplConfig().indexTemplateGlob, onTemplatesChanged);
  indexTemplateCatalog.setRemoteTemplates(remoteTemplates);
  context.subscriptions.push(indexTemplateCatalog);
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
  diagnosticManager = new PplDiagnosticManager(updateStatusBar, () => indexTemplateCatalog);
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
        indexTemplateCatalog?.dispose();
        indexTemplateCatalog = new IndexTemplateCatalog(getPplConfig().indexTemplateGlob, onTemplatesChanged);
        indexTemplateCatalog.setRemoteTemplates(remoteTemplates);
        context.subscriptions.push(indexTemplateCatalog);
        void openSearchTemplateSource?.setTemplateNames(getPplConfig().openSearchTemplateNames);
        void openSearchTemplateSource?.setMappingIndexPatterns(getPplConfig().openSearchMappingIndexes);
        updateStatusBar(0);
      }
    })
  );

  openSearchTemplateSource = new OpenSearchTemplateSource(
    context.globalState,
    createOpenSearchTemplatePrompts(openSearchOutput),
    (templates) => {
      remoteTemplates = templates;
      indexTemplateCatalog?.setRemoteTemplates(templates);
    }
  );
  context.subscriptions.push(openSearchTemplateSource);
  void openSearchTemplateSource.setTemplateNames(getPplConfig().openSearchTemplateNames);
  void openSearchTemplateSource.setMappingIndexPatterns(getPplConfig().openSearchMappingIndexes);
  void openSearchTemplateSource.initialize();

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
      new PplHoverProvider(() => indexTemplateCatalog!)
    ),
    vscode.languages.registerCompletionItemProvider(
      supportedLanguages,
      new PplCompletionProvider(() => indexTemplateCatalog!),
      '.', '=', '|', '(', ',', ' '
    )
  );

  // 6. Registered Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('pplLinter.lintCurrentFile', async () => {
      const activeEditor = vscode.window.activeTextEditor;
      if (activeEditor) {
        await diagnosticManager?.lintDocument(activeEditor.document);
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
    }),
    vscode.commands.registerCommand('pplLinter.refreshOpenSearchIndexTemplates', async () => {
      await openSearchTemplateSource?.refresh(true);
    }),
    vscode.commands.registerCommand('pplLinter.showOpenSearchLogs', () => {
      openSearchOutput.show(true);
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
  if (indexTemplateCatalog) {
    indexTemplateCatalog.dispose();
    indexTemplateCatalog = undefined;
  }
  if (openSearchTemplateSource) {
    openSearchTemplateSource.dispose();
    openSearchTemplateSource = undefined;
  }
}
