import * as vscode from 'vscode';

interface CommandDoc {
  name: string;
  syntax: string;
  description: string;
  example: string;
  docUrl: string;
}

const COMMAND_DOCS: Record<string, CommandDoc> = {
  source: {
    name: 'source',
    syntax: 'source = <table_or_index>',
    description: 'Specifies the source index or relation to search and process in the pipeline.',
    example: 'source = accounts | where age > 30',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/source/',
  },
  search: {
    name: 'search',
    syntax: 'search [source =] <table_or_index>',
    description: 'Alternative syntax to specify the source data for the pipeline.',
    example: 'search source = logs | where status == 200',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/search/',
  },
  where: {
    name: 'where',
    syntax: 'where <boolean_expression>',
    description: 'Filters search results using a boolean expression.',
    example: 'where status >= 400 AND response_time > 500',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/where/',
  },
  stats: {
    name: 'stats',
    syntax: 'stats <aggregation_function>... [by <field_list>]',
    description: 'Calculates aggregations (e.g. count, avg, sum, min, max) grouped by one or more fields.',
    example: 'stats count(), avg(bytes) by status, host',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/stats/',
  },
  fields: {
    name: 'fields',
    syntax: 'fields [+|-] <field_list>',
    description: 'Keeps (+) or removes (-) specific fields from the search results.',
    example: 'fields + timestamp, user_id, action',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/fields/',
  },
  eval: {
    name: 'eval',
    syntax: 'eval <field_expression>...',
    description: 'Calculates new fields or transforms existing fields using expressions.',
    example: 'eval duration_sec = duration_ms / 1000',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/eval/',
  },
  sort: {
    name: 'sort',
    syntax: 'sort [+|-] <field_list>',
    description: 'Sorts search results by specified fields in ascending (+) or descending (-) order.',
    example: 'sort - timestamp, + host',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/sort/',
  },
  rename: {
    name: 'rename',
    syntax: 'rename <old_field> as <new_field>...',
    description: 'Renames one or more fields in the search results.',
    example: 'rename ip_address as client_ip',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/rename/',
  },
  dedup: {
    name: 'dedup',
    syntax: 'dedup [count] <field_list>',
    description: 'Removes duplicate results based on specific fields.',
    example: 'dedup 1 user_id',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/dedup/',
  },
  head: {
    name: 'head',
    syntax: 'head <number>',
    description: 'Returns the first N search results.',
    example: 'head 10',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/head/',
  },
  top: {
    name: 'top',
    syntax: 'top [N] <field_list>',
    description: 'Finds the most common values of specified fields.',
    example: 'top 5 user_agent',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/top/',
  },
  rare: {
    name: 'rare',
    syntax: 'rare [N] <field_list>',
    description: 'Finds the least common values of specified fields.',
    example: 'rare 5 http_status',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/rare/',
  },
  grok: {
    name: 'grok',
    syntax: 'grok <field> <pattern>',
    description: 'Parses unstructured text fields into structured fields using Grok patterns.',
    example: 'grok message \'%{IP:client_ip} %{WORD:method}\'',
    docUrl: 'https://opensearch.org/docs/latest/search-plugins/ppl/commands/grok/',
  },
};

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
