import { ExtractedQuery } from '../types';
import { jsonExtractor } from './json';
import { tomlExtractor } from './toml';
import { yamlExtractor } from './yaml';

export interface KeyPatternOptions {
  additional?: string[];
  exclude?: string[];
  overrideDefaults?: boolean;
}

/**
 * Resolves effective key patterns by taking base patterns, optionally overriding defaults,
 * appending additional patterns, and applying exclusions or leading `!` negation patterns.
 */
export function resolveKeyPatterns(
  basePatterns: string[] = [],
  options: KeyPatternOptions = {}
): string[] {
  let patterns: string[] = options.overrideDefaults ? [] : [...basePatterns];

  const additional = options.additional || [];
  const exclusions = new Set<string>((options.exclude || []).map((p) => p.trim()));

  for (const pattern of additional) {
    const trimmed = pattern.trim();
    if (trimmed.startsWith('!')) {
      exclusions.add(trimmed.slice(1).trim());
    } else if (trimmed.length > 0) {
      patterns.push(trimmed);
    }
  }

  if (exclusions.size > 0) {
    patterns = patterns.filter((p) => !exclusions.has(p));
  }

  return Array.from(new Set(patterns));
}

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
