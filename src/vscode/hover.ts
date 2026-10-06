import * as vscode from 'vscode';
import { queryHoverAt } from '../core/queryHover';
import { IndexTemplate } from '../core/indexTemplates';
import { offsetToPosition } from '../extractors/sourcemap';
import { ExtractedQuery } from '../types';
import { getPplConfig } from './config';
import { IndexTemplateCatalog } from './indexTemplateCatalog';
import { embeddedQueries, isStandalone } from './queryDocument';

export class PplHoverProvider implements vscode.HoverProvider {
  constructor(private readonly catalog: () => IndexTemplateCatalog) {}

  public async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const config = getPplConfig();
    const standalone = isStandalone(document, config);
    const queries = standalone ? [] : embeddedQueries(document, config).queries;
    const templates = config.enabled ? await this.catalog().forDocument(document) : [];
    if (standalone) return this.queryHover(document.getText(), document.offsetAt(position), templates,
      config.includedIndexes, (start, end) => new vscode.Range(document.positionAt(start), document.positionAt(end)));
    for (const query of queries) {
      const offset = this.embeddedOffset(query, position);
      if (offset === undefined) continue;
      return this.queryHover(query.rawText, offset, templates, config.includedIndexes,
        (start, end) => this.embeddedRange(query, start, end));
    }
    return undefined;
  }

  private embeddedOffset(query: ExtractedQuery, position: vscode.Position): number | undefined {
    const snippet = query.sourceMap.toSnippet({ line: position.line, col: position.character }, query.rawText);
    if (!snippet) return undefined;
    const lines = query.rawText.split(/\r?\n/);
    return lines.slice(0, snippet.line).reduce((total, line) => total + line.length + 1, 0) + snippet.col;
  }

  private embeddedRange(query: ExtractedQuery, start: number, end: number): vscode.Range | undefined {
    const range = query.sourceMap.translate({
      start: { ...offsetToPosition(query.rawText, start), offset: start },
      end: { ...offsetToPosition(query.rawText, end), offset: end },
    });
    return range && new vscode.Range(
      new vscode.Position(range.start.line, range.start.col),
      new vscode.Position(range.end.line, range.end.col)
    );
  }

  private queryHover(
    query: string,
    offset: number,
    templates: readonly IndexTemplate[],
    includedIndexes: readonly string[],
    rangeFor: (start: number, end: number) => vscode.Range | undefined
  ): vscode.Hover | undefined {
    const info = queryHoverAt(query, offset, templates, includedIndexes);
    if (!info) return undefined;
    const range = rangeFor(info.span.start, info.span.end);
    if (!range) return undefined;

    return new vscode.Hover(new vscode.MarkdownString(info.markdown), range);
  }
}
