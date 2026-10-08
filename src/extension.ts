import * as vscode from 'vscode';
import * as path from 'node:path';
import { IndexTemplate } from './core/indexTemplates';
import { PplCodeActionProvider } from './vscode/codeActions';
import { getPplConfig, getSharedConfigUri, loadSharedConfig } from './vscode/config';
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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  let remoteTemplates: IndexTemplate[] = [];
  const openSearchOutput = vscode.window.createOutputChannel('PPL Linter: OpenSearch');
  context.subscriptions.push(openSearchOutput);
  const sharedConfigResult = await loadSharedConfig();
  if (sharedConfigResult.error) openSearchOutput.appendLine(`[Config] ${sharedConfigResult.error}`);

  let configWatcher: vscode.FileSystemWatcher | undefined;
  let configWatcherSubscriptions: vscode.Disposable[] = [];
  const disposeConfigWatcher = (): void => {
    configWatcher?.dispose();
    configWatcher = undefined;
    for (const subscription of configWatcherSubscriptions) subscription.dispose();
    configWatcherSubscriptions = [];
  };
  const installConfigWatcher = (): void => {
    disposeConfigWatcher();
    const uri = getSharedConfigUri();
    if (!uri) return;
    const parent = uri.with({ path: path.posix.dirname(uri.path) });
    configWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(parent, path.posix.basename(uri.path))
    );
    const reloadFromFile = (): void => { void applyConfiguration(true); };
    configWatcherSubscriptions = [
      configWatcher.onDidCreate(reloadFromFile),
      configWatcher.onDidChange(reloadFromFile),
      configWatcher.onDidDelete(reloadFromFile),
    ];
  };
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

  let configReloadGeneration = 0;
  const applyConfiguration = async (reloadFile: boolean): Promise<void> => {
    const generation = ++configReloadGeneration;
    if (reloadFile) {
      const result = await loadSharedConfig();
      if (result.error) openSearchOutput.appendLine(`[Config] ${result.error}`);
      installConfigWatcher();
      if (generation !== configReloadGeneration) return;
    }

    const config = getPplConfig();
    diagnosticManager?.reloadConfig();
    indexTemplateCatalog?.dispose();
    indexTemplateCatalog = new IndexTemplateCatalog(config.indexTemplateGlob, onTemplatesChanged);
    indexTemplateCatalog.setRemoteTemplates(remoteTemplates);
    context.subscriptions.push(indexTemplateCatalog);
    const connectionDefaultsChanged = openSearchTemplateSource?.setConnectionDefaults(
      config.openSearchUrl,
      config.openSearchUsername
    ) ?? false;
    const selectionsRefreshed = openSearchTemplateSource
      ? await openSearchTemplateSource.setSelections(
        config.openSearchTemplateNames,
        config.openSearchMappingIndexes
      )
      : false;
    if (connectionDefaultsChanged && !selectionsRefreshed) void openSearchTemplateSource?.refresh(true);
    updateStatusBar(0);
  };

  installConfigWatcher();

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
        void applyConfiguration(event.affectsConfiguration('pplLinter.configFile'));
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => { void applyConfiguration(true); })
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
  const initialConfig = getPplConfig();
  openSearchTemplateSource.setConnectionDefaults(initialConfig.openSearchUrl, initialConfig.openSearchUsername);
  void openSearchTemplateSource.setSelections(
    initialConfig.openSearchTemplateNames,
    initialConfig.openSearchMappingIndexes
  );
  void openSearchTemplateSource.initialize();
  context.subscriptions.push({ dispose: disposeConfigWatcher });

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
      const current = getPplConfig().enabled;
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
