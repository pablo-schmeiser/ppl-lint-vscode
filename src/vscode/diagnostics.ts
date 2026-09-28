import * as vscode from 'vscode';
import { PplLinter } from '../core/linter';
import { CoreDiagnostic, PplLinterConfig } from '../types';
import { getPplConfig } from './config';
import { IndexTemplateCatalog } from './indexTemplateCatalog';
import { embeddedQueries, isStandalone } from './queryDocument';

export class PplDiagnosticManager implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private linter: PplLinter;
  private config: PplLinterConfig;
  private onTotalDiagnosticsChanged?: (totalErrors: number) => void;

  constructor(
    onTotalDiagnosticsChanged?: (totalErrors: number) => void,
    private readonly getIndexTemplateCatalog?: () => IndexTemplateCatalog | undefined
  ) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('ppl');
    this.config = getPplConfig();
    this.linter = new PplLinter({
      openSearchVersion: this.config.openSearchVersion,
      rules: this.config.rules,
      customCommands: this.config.customCommands,
      customFunctions: this.config.customFunctions,
    });
    this.onTotalDiagnosticsChanged = onTotalDiagnosticsChanged;
  }

  public reloadConfig(): void {
    this.config = getPplConfig();
    this.linter = new PplLinter({
      openSearchVersion: this.config.openSearchVersion,
      rules: this.config.rules,
      customCommands: this.config.customCommands,
      customFunctions: this.config.customFunctions,
    });
    this.reLintOpenDocuments();
  }

  public async lintDocument(document: vscode.TextDocument): Promise<void> {
    if (!this.config.enabled) {
      this.diagnosticCollection.delete(document.uri);
      this.updateStatus();
      return;
    }

    const uriString = document.uri.toString();
    const existingTimer = this.debounceTimers.get(uriString);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.debounceTimers.delete(uriString);
    }

    const documentVersion = document.version;
    const documentText = document.getText();
    const standalone = isStandalone(document, this.config);
    const embedded = standalone ? undefined : embeddedQueries(document, this.config);
    if (!standalone && !embedded?.matched) return;

    const schemaEnabled = this.config.indexTemplateGlob.length > 0;
    const templates = schemaEnabled
      ? (await this.getIndexTemplateCatalog?.()?.forDocument(document)) || []
      : [];
    if (document.version !== documentVersion) return;

    if (standalone) {
      const coreDiagnostics = this.linter.lint(documentText, templates, schemaEnabled);
      const vsDiagnostics = coreDiagnostics.map((d) => this.toVsCodeDiagnostic(d));
      this.diagnosticCollection.set(document.uri, vsDiagnostics);
      this.updateStatus();
      return;
    }

    const vsDiagnostics: vscode.Diagnostic[] = [];
    for (const query of embedded!.queries) {
      const coreDiagnostics = this.linter.lint(query.rawText, templates, schemaEnabled);
      for (const coreDiag of coreDiagnostics) {
        const hostRange = query.sourceMap.translate(coreDiag.span);
        if (!hostRange) continue;
        vsDiagnostics.push(this.createVsCodeDiagnostic(
          hostRange.start.line, hostRange.start.col, hostRange.end.line, hostRange.end.col, coreDiag
        ));
      }
    }

    this.diagnosticCollection.set(document.uri, vsDiagnostics);
    this.updateStatus();
  }

  public scheduleLint(document: vscode.TextDocument): void {
    if (!this.config.enabled) return;

    if (!this.config.lintOnType) {
      return;
    }

    const uriString = document.uri.toString();
    const existing = this.debounceTimers.get(uriString);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(uriString);
      void this.lintDocument(document);
    }, this.config.debounceMs);

    this.debounceTimers.set(uriString, timer);
  }

  public clearDocument(document: vscode.TextDocument): void {
    const uriString = document.uri.toString();
    const timer = this.debounceTimers.get(uriString);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(uriString);
    }
    this.diagnosticCollection.delete(document.uri);
    this.updateStatus();
  }

  public reLintOpenDocuments(): void {
    for (const doc of vscode.workspace.textDocuments) {
      void this.lintDocument(doc);
    }
  }

  public dispose(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.diagnosticCollection.dispose();
  }

  private toVsCodeDiagnostic(core: CoreDiagnostic): vscode.Diagnostic {
    return this.createVsCodeDiagnostic(
      core.span.start.line,
      core.span.start.col,
      core.span.end.line,
      core.span.end.col,
      core
    );
  }

  private createVsCodeDiagnostic(
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    core: CoreDiagnostic
  ): vscode.Diagnostic {
    const range = new vscode.Range(
      new vscode.Position(startLine, startCol),
      new vscode.Position(endLine, endCol)
    );

    let severity = vscode.DiagnosticSeverity.Error;
    if (core.severity === 'warning') {
      severity = vscode.DiagnosticSeverity.Warning;
    } else if (core.severity === 'info') {
      severity = vscode.DiagnosticSeverity.Information;
    }

    const diag = new vscode.Diagnostic(range, core.message, severity);
    diag.code = core.code;
    diag.source = 'PPL';
    if (core.data) {
      (diag as any).data = core.data;
    }

    return diag;
  }

  private updateStatus(): void {
    if (!this.onTotalDiagnosticsChanged) return;

    let totalErrors = 0;
    this.diagnosticCollection.forEach((_uri, diagnostics) => {
      for (const d of diagnostics) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          totalErrors++;
        }
      }
    });

    this.onTotalDiagnosticsChanged(totalErrors);
  }
}
