import { minimatch } from 'minimatch';
import { IndexTemplate } from '../core/indexTemplates';
import { PplLinter } from '../core/linter';
import { extractQueries, resolveKeyPatterns } from '../extractors/extractor';
import { CoreDiagnostic, Position, PplLinterConfig } from '../types';
import { CliDiagnostic, CliLintResult, CliSource } from './types';

function makeDiagnostic(
  file: string,
  keyPath: string | undefined,
  diagnostic: CoreDiagnostic,
  start: Position,
  end: Position,
  corpusMetadata?: Pick<CliSource, 'corpusId' | 'family'>
): CliDiagnostic {
  return {
    file,
    ...(keyPath ? { keyPath } : {}),
    line: start.line + 1,
    column: start.col + 1,
    endLine: end.line + 1,
    endColumn: end.col + 1,
    severity: diagnostic.severity,
    code: diagnostic.code,
    message: diagnostic.message,
    ...(corpusMetadata?.corpusId ? { corpusId: corpusMetadata.corpusId } : {}),
    ...(corpusMetadata?.family ? { family: corpusMetadata.family } : {}),
  };
}

export function lintSources(
  sources: CliSource[],
  linter: PplLinter,
  templates: IndexTemplate[],
  schemaEnabled: boolean,
  config: PplLinterConfig
): CliLintResult {
  const diagnostics: CliDiagnostic[] = [];
  let queryCount = 0;
  const embeddedRules = config.embedded;

  for (const source of sources) {
    if (source.format === 'ppl') {
      queryCount++;
      for (const diagnostic of linter.lint(source.text, templates, schemaEnabled)) {
        diagnostics.push(makeDiagnostic(
          source.label,
          source.keyPath,
          diagnostic,
          diagnostic.span.start,
          diagnostic.span.end,
          source
        ));
      }
      continue;
    }

    const rule = embeddedRules.find((candidate) => candidate.format === source.format &&
      (!source.filePath || minimatch(source.filePath, candidate.filePattern, { dot: true, matchBase: true })));
    if (!rule) continue;
    const patterns = resolveKeyPatterns(rule.keyPatterns, {
      additional: config.additionalKeyPatterns,
      exclude: config.excludeKeyPatterns,
      overrideDefaults: config.overrideDefaultKeyPatterns,
    });
    const queries = extractQueries(source.text, source.format, patterns, rule.heuristicDetection);
    queryCount += queries.length;
    for (const query of queries) {
      for (const diagnostic of linter.lint(query.rawText, templates, schemaEnabled)) {
        const hostRange = query.sourceMap.translate(diagnostic.span);
        if (!hostRange) continue;
        diagnostics.push(makeDiagnostic(
          source.label,
          query.keyPath,
          diagnostic,
          { ...hostRange.start, offset: 0 },
          { ...hostRange.end, offset: 0 }
        ));
      }
    }
  }
  return { diagnostics, queryCount };
}
