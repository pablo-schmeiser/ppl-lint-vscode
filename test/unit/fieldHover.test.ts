import { describe, expect, it } from 'vitest';
import { fieldInfoAt } from '../../src/core/fieldHover';
import { parseIndexTemplates } from '../../src/core/indexTemplates';
import { typedFieldScopeAt } from '../../src/core/schemaTypeChecker';
import { extractQueries } from '../../src/extractors/extractor';
import { offsetToPosition } from '../../src/extractors/sourcemap';

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: auditd }
spec:
  indexPatterns: ['auditd-*']
  template:
    aliases: { auditd-reader: {} }
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
    const query = 'source=auditd-reader | where event.type == "login"';
    const start = query.indexOf('event.type');
    expect(fieldInfoAt(query, start + 7, templates)).toEqual({
      name: 'event.type',
      types: ['string'],
      templates: ['auditd'],
      span: { start, end: start + 'event.type'.length },
    });
    expect(fieldInfoAt(query, query.indexOf('auditd-reader'), templates)).toBeUndefined();
    expect(fieldInfoAt(query, query.indexOf('login'), templates)).toBeUndefined();
  });

  it('does not offer a source field after stats removes it', () => {
    const query = 'source=auditd-reader | stats count(pid) as total | where pid > 0';
    expect(fieldInfoAt(query, query.lastIndexOf('pid'), templates)).toBeUndefined();
    expect(fieldInfoAt(query, query.indexOf('pid'), templates)?.types).toEqual(['bigint']);
  });

  it('shows inferred types for eval and stats output fields', () => {
    const evalQuery = 'source=auditd-reader | eval magnitude = abs(event.sequence) | where magnitude > 0';
    const evalOffset = evalQuery.lastIndexOf('magnitude');
    expect(typedFieldScopeAt(evalQuery, templates, evalOffset + 2)?.get('magnitude')?.pplTypes).toEqual(['bigint']);
    expect(fieldInfoAt(evalQuery, evalOffset + 2, templates)?.types).toEqual(['bigint']);
    expect(fieldInfoAt(evalQuery, evalQuery.indexOf('magnitude') + 2, templates)?.types).toEqual(['bigint']);

    const statsQuery = 'source=auditd-reader | stats count() as total by event.type | where total > 0';
    const statsOffset = statsQuery.lastIndexOf('total');
    expect(fieldInfoAt(statsQuery, statsOffset + 1, templates)?.types).toEqual(['bigint']);
    expect(fieldInfoAt(statsQuery, statsQuery.indexOf('total') + 1, templates)?.types).toEqual(['bigint']);

    const bucketQuery = 'source=auditd-reader | stats count() by span(event.sequence, 10) as bucket | where bucket > 0';
    expect(fieldInfoAt(bucketQuery, bucketQuery.indexOf('bucket') + 2, templates)?.types).toEqual(['bigint']);
  });

  it('shows inferred types for streamstats outputs and rex captures', () => {
    const streamQuery = 'source=auditd-reader | streamstats count() as running_total by event.type | where running_total > 0';
    const streamOffset = streamQuery.lastIndexOf('running_total');
    expect(fieldInfoAt(streamQuery, streamOffset + 2, templates)?.types).toEqual(['bigint']);

    const rexQuery = 'source=auditd-reader | rex field=event.type "(?<login>\\w+)" | where login == \'admin\'';
    const rexOffset = rexQuery.lastIndexOf('login');
    expect(fieldInfoAt(rexQuery, rexOffset + 2, templates)?.types).toEqual(['string']);
  });

  it('does not claim a type when the template catalog is empty', () => {
    const query = 'source=unknown | where event.type == 1';
    expect(fieldInfoAt(query, query.indexOf('event.type'), [])).toBeUndefined();
  });

  it('does not show fields for sources excluded by the configured index allowlist', () => {
    const query = 'source=auditd-reader | where event.type == "login"';
    const offset = query.indexOf('event.type');

    expect(fieldInfoAt(query, offset, templates, ['other-*'])).toBeUndefined();
    expect(fieldInfoAt(query, offset, templates, ['auditd-*'])?.types).toEqual(['string']);
  });

  it('preserves conflicting types on a shared alias', () => {
    const second = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: other }
spec:
  indexPatterns: ['other-*']
  template:
    aliases: { auditd-reader: {} }
    mappings:
      properties:
        event:
          properties:
            type: { type: text }
`, 'other.yaml');
    const query = 'source=auditd-reader | where event.type == 1';
    const info = fieldInfoAt(query, query.indexOf('event.type'), [...templates, ...second]);
    expect(info?.types).toEqual(['string']);
    expect(info?.templates).toEqual(['auditd', 'other']);
  });

  it('maps the entire field token in a YAML block query back to the host', () => {
    const yaml = 'rule:\n  query: |\n    source=auditd-reader | where event.type == "login"\n';
    const [query] = extractQueries(yaml, 'yaml', ['rule.query'], false);
    const info = fieldInfoAt(query.rawText, query.rawText.indexOf('event.type') + 7, templates)!;
    const hostRange = query.sourceMap.translate({
      start: { ...offsetToPosition(query.rawText, info.span.start), offset: info.span.start },
      end: { ...offsetToPosition(query.rawText, info.span.end), offset: info.span.end },
    });
    expect(hostRange?.start).toEqual({ line: 2, col: 33 });
    expect(hostRange?.end).toEqual({ line: 2, col: 43 });
  });
});
