import * as vscode from 'vscode';
import { COMMAND_DOCS } from '../core/catalog/commands';
import {
  FunctionHoverInfo,
  functionInfoAt,
  renderFunctionDocumentation,
} from '../core/catalog/functionDocumentation';
import { fieldInfoAt } from '../core/fieldHover';
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

    if (standalone) {
      const query = document.getText();
      const hover = this.functionHoverAt(query, document.offsetAt(position), (start, end) =>
        new vscode.Range(document.positionAt(start), document.positionAt(end))
      );
      if (hover) return hover;
    } else {
      for (const query of queries) {
        const offset = this.embeddedOffset(query, position);
        if (offset === undefined) continue;
        const hover = this.functionHoverAt(query.rawText, offset, (start, end) =>
          this.embeddedRange(query, start, end)
        );
        if (hover) return hover;
      }
    }

    if (config.enabled) {
      const templates = await this.catalog().forDocument(document);
      if (templates.length) {
        if (standalone) {
          const hover = this.fieldHover(
            document.getText(),
            document.offsetAt(position),
            templates,
            config.includedIndexes,
            (start, end) => new vscode.Range(document.positionAt(start), document.positionAt(end))
          );
          if (hover) return hover;
        } else {
          for (const query of queries) {
            const offset = this.embeddedOffset(query, position);
            if (offset === undefined) continue;
            const hover = this.fieldHover(
              query.rawText,
              offset,
              templates,
              config.includedIndexes,
              (start, end) => this.embeddedRange(query, start, end)
            );
            if (hover) return hover;
          }
        }
      }
    }

    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange).toLowerCase();
    const doc = COMMAND_DOCS[word];
    if (!doc) {
      return undefined;
    }

    const md = new vscode.MarkdownString();
    md.isTrusted = true;
    md.appendMarkdown(`### PPL Command: \`${doc.name}\`\n\n`);
    md.appendCodeblock(doc.syntax, 'ppl');
    md.appendMarkdown(`${doc.description}\n\n`);
    md.appendMarkdown(`**Example:**\n`);
    md.appendCodeblock(doc.example, 'ppl');
    md.appendMarkdown(`[OpenSearch PPL Documentation](${doc.docUrl})`);

    return new vscode.Hover(md, wordRange);
  }

  private functionHoverAt(
    query: string,
    offset: number,
    rangeFor: (start: number, end: number) => vscode.Range | undefined
  ): vscode.Hover | undefined {
    const info = functionInfoAt(query, offset);
    if (!info) return undefined;
    const range = rangeFor(info.span.start, info.span.end);
    return range ? this.functionHover(info, range) : undefined;
  }

  private functionHover(info: FunctionHoverInfo, range: vscode.Range): vscode.Hover {
    const markdown = new vscode.MarkdownString(renderFunctionDocumentation(info.documentation));
    markdown.isTrusted = true;
    return new vscode.Hover(markdown, range);
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

  private fieldHover(
    query: string,
    offset: number,
    templates: readonly IndexTemplate[],
    includedIndexes: readonly string[],
    rangeFor: (start: number, end: number) => vscode.Range | undefined
  ): vscode.Hover | undefined {
    const info = fieldInfoAt(query, offset, templates, includedIndexes);
    if (!info) return undefined;
    const range = rangeFor(info.span.start, info.span.end);
    if (!range) return undefined;

    const md = new vscode.MarkdownString();
    md.appendMarkdown('**Field:** ');
    md.appendText(info.name);
    md.appendMarkdown('\n\n**PPL type:** ');
    md.appendText(info.types.join(' | '));
    if (info.templates.length > 0) {
      md.appendMarkdown('\n\n**Template:** ');
      md.appendText(info.templates.join(', '));
    } else {
      md.appendMarkdown('\n\n**Origin:** Computed by PPL pipeline');
    }
    return new vscode.Hover(md, range);
  }
}
