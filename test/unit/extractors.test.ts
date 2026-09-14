import { describe, expect, it } from 'vitest';
import { extractQueries, resolveKeyPatterns } from '../../src/extractors/extractor';
import { LineOffsetSourceMap } from '../../src/extractors/sourcemap';
import { Span } from '../../src/types';

describe('SourceCoordinateMap', () => {
  it('translates snippet coordinates to host coordinates using line mappings', () => {
    const map = new LineOffsetSourceMap([
      { hostLine: 5, hostColOffset: 4 },
      { hostLine: 6, hostColOffset: 4 },
    ]);

    const span: Span = {
      start: { line: 1, col: 2, offset: 0 },
      end: { line: 1, col: 6, offset: 4 },
    };

    const translated = map.translate(span);
    expect(translated.start).toEqual({ line: 6, col: 6 });
    expect(translated.end).toEqual({ line: 6, col: 10 });
  });
});

describe('YAML Extractor', () => {
  it('extracts queries from YAML block literal with correct host coordinates', () => {
    const yaml = `name: Sample Alert
rule:
  threshold: 10
  query: |
    source=http_logs
    | where status >= 500
`;

    const queries = extractQueries(yaml, 'yaml', ['rule.query'], false);
    expect(queries).toHaveLength(1);
    expect(queries[0].keyPath).toBe('rule.query');
    expect(queries[0].rawText).toContain('source=http_logs');

    // Translate second line ("| where status >= 500", starting at col 2 with 'where')
    const snippetSpan: Span = {
      start: { line: 1, col: 2, offset: 0 },
      end: { line: 1, col: 7, offset: 5 },
    };

    const hostRange = queries[0].sourceMap.translate(snippetSpan);
    // query is on line 3 (0-indexed: 4 for source=http_logs, 5 for | where status >= 500)
    expect(hostRange.start.line).toBe(5);
    // Indentation is 4 spaces + col 2 = col 6
    expect(hostRange.start.col).toBe(6);
  });

  it('extracts multiple queries matching wildcard key patterns', () => {
    const yaml = `detectors:
  primary:
    query: "source=web | where status == 500"
  secondary:
    query: "source=db | stats count()"
`;

    const queries = extractQueries(yaml, 'yaml', ['detectors.*.query'], false);
    expect(queries).toHaveLength(2);
    expect(queries.map((q) => q.keyPath)).toEqual([
      'detectors.primary.query',
      'detectors.secondary.query',
    ]);
  });

  it('handles heuristic detection when key is not explicitly listed', () => {
    const yaml = `custom_config:
  unlisted_key: "source=telemetry | head 10"
`;

    const queries = extractQueries(yaml, 'yaml', [], true);
    expect(queries).toHaveLength(1);
    expect(queries[0].keyPath).toBe('custom_config.unlisted_key');
  });

  it('recovers gracefully from malformed YAML', () => {
    const malformed = `invalid: [unclosed`;
    const queries = extractQueries(malformed, 'yaml', ['*'], true);
    expect(queries).toEqual([]);
  });
});

describe('JSON Extractor', () => {
  it('extracts queries from JSON document with exact quotes offset', () => {
    const json = JSON.stringify(
      {
        id: 'dash-1',
        savedSearch: {
          ppl_query: 'source=metrics | stats avg(cpu)',
        },
      },
      null,
      2
    );

    const queries = extractQueries(json, 'json', ['savedSearch.ppl_query'], false);
    expect(queries).toHaveLength(1);
    expect(queries[0].rawText).toBe('source=metrics | stats avg(cpu)');

    const span: Span = {
      start: { line: 0, col: 0, offset: 0 },
      end: { line: 0, col: 6, offset: 6 },
    };

    const hostRange = queries[0].sourceMap.translate(span);
    expect(hostRange.start.line).toBeGreaterThan(0);
    expect(hostRange.start.col).toBeGreaterThan(0);
  });
});

describe('TOML Extractor', () => {
  it('extracts queries from TOML sections with multiline string literals', () => {
    const toml = `[transforms.filter_logs]
type = "filter"
query = """
source=app_logs
| where level == 'ERROR'
"""
`;

    const queries = extractQueries(toml, 'toml', ['transforms.*.query'], false);
    expect(queries).toHaveLength(1);
    expect(queries[0].keyPath).toBe('transforms.filter_logs.query');
    expect(queries[0].rawText).toContain('source=app_logs');
  });

  it('handles malformed TOML gracefully', () => {
    const malformed = `[invalid toml\nkey = `;
    const queries = extractQueries(malformed, 'toml', ['*'], true);
    expect(queries).toEqual([]);
  });

  it('correctly advances past multiline string and continues parsing subsequent keys', () => {
    const toml = `[section]
query1 = """
source=app_logs
| where level == 'ERROR'
"""
query2 = "source=audit | stats count()"
`;
    const queries = extractQueries(toml, 'toml', ['section.*'], false);
    expect(queries).toHaveLength(2);
    expect(queries[0].keyPath).toBe('section.query1');
    expect(queries[1].keyPath).toBe('section.query2');
  });

  it('extracts single-line queries with varied indentation and whitespace around equals', () => {
    const toml = `
    [telemetry]
      nested.key   =   "source=metrics | head 5"
      other_key='source=events | where code == 200'
`;
    const queries = extractQueries(toml, 'toml', ['telemetry.*'], false);
    expect(queries).toHaveLength(2);
    expect(queries[0].keyPath).toBe('telemetry.nested.key');
    expect(queries[0].rawText).toBe('source=metrics | head 5');
    expect(queries[1].keyPath).toBe('telemetry.other_key');
    expect(queries[1].rawText).toBe('source=events | where code == 200');
  });
});

describe('User-Defined Key Pattern Resolution', () => {
  const defaultPatterns = ['query', 'ppl', 'rule.query', '*.query'];

  it('extends default key patterns when additionalKeyPatterns are provided', () => {
    const resolved = resolveKeyPatterns(defaultPatterns, {
      additional: ['custom_ppl', 'sigma.*.condition'],
    });

    expect(resolved).toContain('query');
    expect(resolved).toContain('custom_ppl');
    expect(resolved).toContain('sigma.*.condition');
    expect(resolved).toHaveLength(6);
  });

  it('excludes specific patterns via excludeKeyPatterns', () => {
    const resolved = resolveKeyPatterns(defaultPatterns, {
      exclude: ['ppl', '*.query'],
    });

    expect(resolved).toContain('query');
    expect(resolved).toContain('rule.query');
    expect(resolved).not.toContain('ppl');
    expect(resolved).not.toContain('*.query');
  });

  it('excludes specific patterns via inline !pattern negation', () => {
    const resolved = resolveKeyPatterns(defaultPatterns, {
      additional: ['my_query', '!query', '!rule.query'],
    });

    expect(resolved).toContain('my_query');
    expect(resolved).toContain('ppl');
    expect(resolved).not.toContain('query');
    expect(resolved).not.toContain('rule.query');
  });

  it('replaces all defaults when overrideDefaults is true', () => {
    const resolved = resolveKeyPatterns(defaultPatterns, {
      overrideDefaults: true,
      additional: ['only_this_key'],
    });

    expect(resolved).toEqual(['only_this_key']);
  });

  it('extracts queries with resolved key patterns in structured documents', () => {
    const yaml = `
custom_key: "source=logs | where code == 200"
default_query: "source=legacy | stats count()"
`;

    // With defaults overridden: only custom_key should be extracted
    const effectivePatterns = resolveKeyPatterns(['default_query'], {
      overrideDefaults: true,
      additional: ['custom_key'],
    });

    const queries = extractQueries(yaml, 'yaml', effectivePatterns, false);
    expect(queries).toHaveLength(1);
    expect(queries[0].keyPath).toBe('custom_key');
    expect(queries[0].rawText).toBe('source=logs | where code == 200');
  });
});

