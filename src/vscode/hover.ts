import * as vscode from 'vscode';
import { COMMAND_DOCS } from '../core/catalog/commands';

export class PplHoverProvider implements vscode.HoverProvider {
  public provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.ProviderResult<vscode.Hover> {
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
}
