import { describe, expect, it } from 'vitest';
import { fieldInfoAt } from '../../src/core/fieldHover';
import { parseIndexTemplates } from '../../src/core/indexTemplates';
import { typedFieldScopeAt } from '../../src/core/schemaTypeChecker';
import { extractQueries } from '../../src/extractors/extractor';
import { offsetToPosition } from '../../src/extractors/sourcemap';

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: test-audit }
spec:
  indexPatterns: ['test-audit-*']
  template:
    aliases: { test-reader: {} }
    mappings:
      properties:
        event:
          properties:
            type: { type: keyword }
            sequence: { type: long }
        pid: { type: long }
`, 'template.yaml');

describe('field hover lookup', () => {
  it('resolves a dotted field and its whole token span in the current source', () => {
    const query = 'source=test-reader | where event.type == "login"';
    const start = query.indexOf('event.type');
    expect(fieldInfoAt(query, start + 7, templates)).toEqual({
      name: 'event.type',
      types: ['string'],
      templates: ['test-audit'],
      span: { start, end: start + 'event.type'.length },
    });
    expect(fieldInfoAt(query, query.indexOf('test-reader'), templates)).toBeUndefined();
    expect(fieldInfoAt(query, query.indexOf('login'), templates)).toBeUndefined();
  });

  it('does not offer a source field after stats removes it', () => {
    const query = 'source=test-reader | stats count(pid) as total | where pid > 0';
    expect(fieldInfoAt(query, query.lastIndexOf('pid'), templates)).toBeUndefined();
    expect(fieldInfoAt(query, query.indexOf('pid'), templates)?.types).toEqual(['bigint']);
  });

  it('shows inferred types for eval and stats output fields', () => {
    const evalQuery = 'source=test-reader | eval magnitude = abs(event.sequence) | where magnitude > 0';
    const evalOffset = evalQuery.lastIndexOf('magnitude');
    expect(typedFieldScopeAt(evalQuery, templates, evalOffset + 2)?.get('magnitude')?.pplTypes).toEqual(['bigint']);
    expect(fieldInfoAt(evalQuery, evalOffset + 2, templates)?.types).toEqual(['bigint']);
    expect(fieldInfoAt(evalQuery, evalQuery.indexOf('magnitude') + 2, templates)?.types).toEqual(['bigint']);

    const statsQuery = 'source=test-reader | stats count() as total by event.type | where total > 0';
    const statsOffset = statsQuery.lastIndexOf('total');
    expect(fieldInfoAt(statsQuery, statsOffset + 1, templates)?.types).toEqual(['bigint']);
    expect(fieldInfoAt(statsQuery, statsQuery.indexOf('total') + 1, templates)?.types).toEqual(['bigint']);

    const bucketQuery = 'source=test-reader | stats count() by span(event.sequence, 10) as bucket | where bucket > 0';
    expect(fieldInfoAt(bucketQuery, bucketQuery.indexOf('bucket') + 2, templates)?.types).toEqual(['bigint']);
  });

  it('shows inferred types for streamstats outputs and rex captures', () => {
    const streamQuery = 'source=test-reader | streamstats count() as running_total by event.type | where running_total > 0';
    const streamOffset = streamQuery.lastIndexOf('running_total');
    expect(fieldInfoAt(streamQuery, streamOffset + 2, templates)?.types).toEqual(['bigint']);

    const rexQuery = 'source=test-reader | rex field=event.type "(?<login>\\w+)" | where login == \'admin\'';
    const rexOffset = rexQuery.lastIndexOf('login');
    expect(fieldInfoAt(rexQuery, rexOffset + 2, templates)?.types).toEqual(['string']);
  });

  it('does not claim a type when the template catalog is empty', () => {
    const query = 'source=test-unknown | where event.type == 1';
    expect(fieldInfoAt(query, query.indexOf('event.type'), [])).toBeUndefined();
  });

  it('does not show fields for sources excluded by the configured index allowlist', () => {
    const query = 'source=test-reader | where event.type == "login"';
    const offset = query.indexOf('event.type');

    expect(fieldInfoAt(query, offset, templates, ['test-other-*'])).toBeUndefined();
    expect(fieldInfoAt(query, offset, templates, ['test-reader'])?.types).toEqual(['string']);
  });

  it('preserves conflicting types on a shared alias', () => {
    const second = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: other }
spec:
  indexPatterns: ['test-other-*']
  template:
    aliases: { test-reader: {} }
    mappings:
      properties:
        event:
          properties:
            type: { type: text }
`, 'other.yaml');
    const query = 'source=test-reader | where event.type == 1';
    const info = fieldInfoAt(query, query.indexOf('event.type'), [...templates, ...second]);
    expect(info?.types).toEqual(['string']);
    expect(info?.templates).toEqual(['test-audit', 'other']);
  });

  it('maps the entire field token in a YAML block query back to the host', () => {
    const yaml = 'rule:\n  query: |\n    source=test-reader | where event.type == "login"\n';
    const [query] = extractQueries(yaml, 'yaml', ['rule.query'], false);
    const info = fieldInfoAt(query.rawText, query.rawText.indexOf('event.type') + 7, templates)!;
    const hostRange = query.sourceMap.translate({
      start: { ...offsetToPosition(query.rawText, info.span.start), offset: info.span.start },
      end: { ...offsetToPosition(query.rawText, info.span.end), offset: info.span.end },
    });
    expect(hostRange?.start).toEqual({ line: 2, col: 31 });
    expect(hostRange?.end).toEqual({ line: 2, col: 41 });
  });
});
