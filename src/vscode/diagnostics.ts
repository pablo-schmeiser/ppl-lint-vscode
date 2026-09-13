import { minimatch } from 'minimatch';
import * as path from 'path';
import * as vscode from 'vscode';
import { PplLinter } from '../core/linter';
import { extractQueries } from '../extractors/extractor';
import { CoreDiagnostic, PplLinterConfig } from '../types';
import { getPplConfig } from './config';

export class PplDiagnosticManager implements vscode.Disposable {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private linter: PplLinter;
  private config: PplLinterConfig;
  private onTotalDiagnosticsChanged?: (totalErrors: number) => void;

  constructor(onTotalDiagnosticsChanged?: (totalErrors: number) => void) {
    this.diagnosticCollection = vscode.languages.createDiagnosticCollection('ppl');
    this.config = getPplConfig();
    this.linter = new PplLinter({ rules: this.config.rules });
    this.onTotalDiagnosticsChanged = onTotalDiagnosticsChanged;
  }

  public reloadConfig(): void {
    this.config = getPplConfig();
    this.linter = new PplLinter({ rules: this.config.rules });
    this.reLintOpenDocuments();
  }

  public lintDocument(document: vscode.TextDocument): void {
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

    const docText = document.getText();
    const docPath = document.uri.fsPath || document.fileName;
    const ext = path.extname(docPath).toLowerCase();

    // 1. Check if Standalone PPL
    const isStandalone =
      document.languageId === 'ppl' ||
      this.config.standalone.languageIds.includes(document.languageId) ||
      this.config.standalone.fileExtensions.includes(ext);

    if (isStandalone) {
      const coreDiagnostics = this.linter.lint(docText);
      const vsDiagnostics = coreDiagnostics.map((d) => this.toVsCodeDiagnostic(d));
      this.diagnosticCollection.set(document.uri, vsDiagnostics);
      this.updateStatus();
      return;
    }

    // 2. Check if Structured Host Document (YAML, TOML, JSON)
    const vsDiagnostics: vscode.Diagnostic[] = [];
    let matchedEmbeddedRule = false;

    for (const rule of this.config.embedded) {
      const matchesGlob = minimatch(docPath, rule.filePattern, {
        dot: true,
        matchBase: true,
      });

      if (matchesGlob) {
        matchedEmbeddedRule = true;
        const extracted = extractQueries(
          docText,
          rule.format,
          rule.keyPatterns,
          rule.heuristicDetection
        );

        for (const query of extracted) {
          const coreDiagnostics = this.linter.lint(query.rawText);
          for (const coreDiag of coreDiagnostics) {
            const hostRange = query.sourceMap.translate(coreDiag.span);
            const vsDiag = this.createVsCodeDiagnostic(
              hostRange.start.line,
              hostRange.start.col,
              hostRange.end.line,
              hostRange.end.col,
              coreDiag
            );
            vsDiagnostics.push(vsDiag);
          }
        }
      }
    }

    if (matchedEmbeddedRule) {
      this.diagnosticCollection.set(document.uri, vsDiagnostics);
      this.updateStatus();
    }
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
      this.lintDocument(document);
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
      this.lintDocument(doc);
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
