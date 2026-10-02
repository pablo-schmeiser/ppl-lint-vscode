import * as vscode from 'vscode';
import * as path from 'node:path';
import { IndexTemplate, parseIndexTemplates } from '../core/indexTemplates';
import { absoluteGlobParts, findAbsoluteFiles } from './templateFiles';

export class IndexTemplateCatalog implements vscode.Disposable {
  private readonly watcher?: vscode.FileSystemWatcher;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly templates = new Map<string, IndexTemplate[]>();
  private externalTemplates: IndexTemplate[] = [];
  private remoteTemplates: IndexTemplate[] = [];
  private generation = 0;
  private ready: Promise<void> = Promise.resolve();

  constructor(private readonly glob: string, private readonly onChanged?: () => void) {
    if (glob) {
      const pattern = path.isAbsolute(glob)
        ? new vscode.RelativePattern(vscode.Uri.file(absoluteGlobParts(glob).base), absoluteGlobParts(glob).pattern)
        : glob;
      this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
      this.subscriptions.push(
        this.watcher.onDidCreate(() => this.refresh()),
        this.watcher.onDidChange(() => this.refresh()),
        this.watcher.onDidDelete(() => this.refresh()),
        vscode.workspace.onDidChangeWorkspaceFolders(() => this.refresh())
      );
      this.refresh();
    }
  }

  public async forDocument(document: vscode.TextDocument): Promise<IndexTemplate[]> {
    await this.ready;
    const localTemplates = path.isAbsolute(this.glob)
      ? this.externalTemplates
      : this.templates.get(vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() || '') || [];
    return [...localTemplates, ...this.remoteTemplates];
  }

  public setRemoteTemplates(templates: IndexTemplate[]): void {
    this.remoteTemplates = templates;
    this.onChanged?.();
  }

  private refresh(): void {
    const generation = ++this.generation;
    if (path.isAbsolute(this.glob)) {
      this.ready = (async () => {
        const files = await findAbsoluteFiles(this.glob);
        const templates = await Promise.all(files.map((file) => this.readTemplates(vscode.Uri.file(file))));
        if (generation === this.generation) {
          this.externalTemplates = templates.flat();
          this.onChanged?.();
        }
      })().catch(() => {
        if (generation === this.generation) {
          this.externalTemplates = [];
          this.onChanged?.();
        }
      });
      return;
    }
    this.ready = (async () => {
      const entries = await Promise.all((vscode.workspace.workspaceFolders || []).map(async (folder) => {
        const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, this.glob));
        const files = await Promise.all(uris.map((uri) => this.readTemplates(uri)));
        return [folder.uri.toString(), files.flat()] as const;
      }));
      if (generation === this.generation) {
        this.templates.clear();
        for (const [folder, templates] of entries) this.templates.set(folder, templates);
        this.onChanged?.();
      }
    })();
  }

  private async readTemplates(uri: vscode.Uri): Promise<IndexTemplate[]> {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      return parseIndexTemplates(new TextDecoder().decode(bytes), uri.toString());
    } catch {
      return [];
    }
  }

  public dispose(): void {
    this.generation++;
    this.watcher?.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
