import { ExtractedQuery } from '../types';
import { jsonExtractor } from './json';
import { tomlExtractor } from './toml';
import { yamlExtractor } from './yaml';

export function extractQueries(
  documentText: string,
  format: 'yaml' | 'toml' | 'json',
  keyPatterns: string[] = [],
  heuristic: boolean = true
): ExtractedQuery[] {
  switch (format) {
    case 'yaml':
      return yamlExtractor.extract(documentText, keyPatterns, heuristic);
    case 'toml':
      return tomlExtractor.extract(documentText, keyPatterns, heuristic);
    case 'json':
      return jsonExtractor.extract(documentText, keyPatterns, heuristic);
    default:
      return [];
  }
}
