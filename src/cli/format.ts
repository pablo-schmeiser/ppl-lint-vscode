import { CliDiagnostic, OutputFormat } from './types';

export function formatDiagnostics(diagnostics: CliDiagnostic[], format: OutputFormat): string {
  if (format === 'json') return `${JSON.stringify(diagnostics, null, 2)}\n`;
  return diagnostics.map((diagnostic) => {
    const context = [
      diagnostic.keyPath,
      diagnostic.corpusId ? `id=${diagnostic.corpusId}` : undefined,
      diagnostic.family ? `family=${diagnostic.family}` : undefined,
    ].filter((item): item is string => item !== undefined);
    const keyPath = context.length > 0 ? ` [${context.join('; ')}]` : '';
    return `${diagnostic.file}${keyPath}:${diagnostic.line}:${diagnostic.column}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
  }).join('\n') + (diagnostics.length > 0 ? '\n' : '');
}

export function formatTextSummary(queryCount: number, diagnostics: CliDiagnostic[]): string {
  if (queryCount === 0) return 'No PPL queries found in the input.\n';
  const queryLabel = queryCount === 1 ? 'PPL query' : 'PPL queries';
  if (diagnostics.length === 0) return `Checked ${queryCount} ${queryLabel}: no diagnostics.\n`;

  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning').length;
  const information = diagnostics.filter((diagnostic) => diagnostic.severity === 'info').length;
  const count = (value: number, singular: string, plural: string): string =>
    `${value} ${value === 1 ? singular : plural}`;
  return `Checked ${queryCount} ${queryLabel}: ${count(errors, 'error', 'errors')}, ` +
    `${count(warnings, 'warning', 'warnings')}, ` +
    `${count(information, 'informational diagnostic', 'informational diagnostics')}.\n`;
}
