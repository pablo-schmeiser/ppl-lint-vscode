import * as vscode from 'vscode';
import { completionCandidates } from '../core/completion';
import { offsetToPosition } from '../extractors/sourcemap';
import { ExtractedQuery, PplLinterConfig, Span } from '../types';
import { getPplConfig } from './config';
import { IndexTemplateCatalog } from './indexTemplateCatalog';
import { embeddedQueries, isStandalone } from './queryDocument';

export class PplCompletionProvider implements vscode.CompletionItemProvider {
  constructor(private readonly catalog: () => IndexTemplateCatalog) {}

  public async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
    const config: PplLinterConfig = getPplConfig();
    if (!config.enabled) return [];
    const templates = await this.catalog().forDocument(document);

    if (isStandalone(document, config)) {
      return this.items(
        document.getText(),
        document.offsetAt(position),
        templates,
        (span) => new vscode.Range(
          document.positionAt(span.start.offset),
          document.positionAt(span.end.offset)
        ),
        config.includedIndexes
      );
    }

    for (const query of embeddedQueries(document, config).queries) {
      const snippet = query.sourceMap.toSnippet({ line: position.line, col: position.character }, query.rawText);
      if (!snippet) continue;
      const lines = query.rawText.split(/\r?\n/);
      const offset = lines.slice(0, snippet.line).reduce((total, line) => total + line.length + 1, 0) + snippet.col;
      return this.items(query.rawText, offset, templates, (span) => this.hostRange(query, span), config.includedIndexes);
    }
    return [];
  }

  private hostRange(query: ExtractedQuery, span: Span): vscode.Range | undefined {
    const range = query.sourceMap.translate(span);
    return range && new vscode.Range(
      new vscode.Position(range.start.line, range.start.col),
      new vscode.Position(range.end.line, range.end.col)
    );
  }

  private items(
    query: string,
    offset: number,
    templates: Awaited<ReturnType<IndexTemplateCatalog['forDocument']>>,
    rangeFor: (span: Span) => vscode.Range | undefined,
    includedIndexes: readonly string[]
  ): vscode.CompletionItem[] {
    let start = offset;
    let end = offset;
    while (start > 0 && /[\w.@*-]/.test(query[start - 1])) start--;
    while (end < query.length && /[\w.@*-]/.test(query[end])) end++;
    const toPosition = (at: number) => ({ ...offsetToPosition(query, at), offset: at });
    const range = rangeFor({ start: toPosition(start), end: toPosition(end) });
    if (!range) return [];
    return completionCandidates(query, offset, templates, includedIndexes).map((candidate) => {
      const kind = {
        field: vscode.CompletionItemKind.Field,
        function: vscode.CompletionItemKind.Function,
        source: vscode.CompletionItemKind.Reference,
        type: vscode.CompletionItemKind.TypeParameter,
        constant: vscode.CompletionItemKind.EnumMember,
        command: vscode.CompletionItemKind.Keyword,
        keyword: vscode.CompletionItemKind.Keyword,
        operator: vscode.CompletionItemKind.Operator,
      }[candidate.kind];
      const item = new vscode.CompletionItem(candidate.label, kind);
      item.detail = candidate.detail;
      if (candidate.documentation) item.documentation = new vscode.MarkdownString(candidate.documentation);
      item.range = range;
      item.insertText = candidate.insertText || candidate.label;
      if (candidate.retriggerAfterAccept) {
        item.command = {
          command: 'editor.action.triggerSuggest',
          title: 'Continue PPL suggestions',
        };
      }
      return item;
    });
  }
}