import * as vscode from 'vscode';
import { COMMAND_DOCS } from '../core/catalog/commands';
import { fieldInfoAt } from '../core/fieldHover';
import { IndexTemplate } from '../core/indexTemplates';
import { offsetToPosition } from '../extractors/sourcemap';
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
    if (config.enabled && config.indexTemplateGlob) {
      const templates = await this.catalog().forDocument(document);
      if (templates.length) {
        if (isStandalone(document, config)) {
          const hover = this.fieldHover(document.getText(), document.offsetAt(position), templates, (start, end) =>
            new vscode.Range(document.positionAt(start), document.positionAt(end))
          );
          if (hover) return hover;
        } else {
          for (const query of embeddedQueries(document, config).queries) {
            const snippet = query.sourceMap.toSnippet({ line: position.line, col: position.character }, query.rawText);
            if (!snippet) continue;
            const lines = query.rawText.split(/\r?\n/);
            const offset = lines.slice(0, snippet.line).reduce((total, line) => total + line.length + 1, 0) + snippet.col;
            const hover = this.fieldHover(query.rawText, offset, templates, (start, end) => {
              const range = query.sourceMap.translate({
                start: { ...offsetToPosition(query.rawText, start), offset: start },
                end: { ...offsetToPosition(query.rawText, end), offset: end },
              });
              return range && new vscode.Range(
                new vscode.Position(range.start.line, range.start.col),
                new vscode.Position(range.end.line, range.end.col)
              );
            });
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

  private fieldHover(
    query: string,
    offset: number,
    templates: readonly IndexTemplate[],
    rangeFor: (start: number, end: number) => vscode.Range | undefined
  ): vscode.Hover | undefined {
    const info = fieldInfoAt(query, offset, templates);
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
