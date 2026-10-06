import { minimatch } from 'minimatch';
import * as path from 'path';
import * as vscode from 'vscode';
import { extractQueries, resolveKeyPatterns } from '../extractors/extractor';
import { ExtractedQuery, PplLinterConfig } from '../types';

export function isStandalone(document: vscode.TextDocument, config: PplLinterConfig): boolean {
  const ext = path.extname(document.uri.fsPath || document.fileName).toLowerCase();
  return document.languageId === 'ppl' || config.standalone.languageIds.includes(document.languageId) ||
    config.standalone.fileExtensions.includes(ext);
}

export function embeddedQueries(document: vscode.TextDocument, config: PplLinterConfig): {
  matched: boolean;
  queries: ExtractedQuery[];
} {
  const docPath = document.uri.fsPath || document.fileName;
  const queries: ExtractedQuery[] = [];
  let matched = false;
  for (const rule of config.embedded) {
    if (!minimatch(docPath, rule.filePattern, { dot: true, matchBase: true })) continue;
    matched = true;
    const patterns = resolveKeyPatterns(rule.keyPatterns, {
      additional: config.additionalKeyPatterns,
      exclude: config.excludeKeyPatterns,
      overrideDefaults: config.overrideDefaultKeyPatterns,
    });
    queries.push(...extractQueries(document.getText(), rule.format, patterns, rule.heuristicDetection));
  }
  return { matched, queries };
}
