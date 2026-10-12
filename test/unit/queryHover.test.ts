import { describe, expect, it } from 'vitest';
import { queryHoverAt } from '../../src/core/queryHover';
import { parseIndexTemplates } from '../../src/core/indexTemplates';

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: test-audit }
spec:
  indexPatterns: ['test-audit-*']
  template:
    aliases: { test-reader: {} }
    mappings:
      properties:
        pid: { type: long }
        message: { type: keyword }
        by: { type: keyword }
`, 'test-audit.yaml');
const lookupTemplates = [...templates, ...parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: test_workers }
spec:
  indexPatterns: ['test_workers-*']
  template:
    aliases: { test_workers-reader: {} }
    mappings:
      properties:
        employee_id: { type: keyword }
        department: { type: keyword }
`, 'test_workers.yaml')];

describe('PPL query hover', () => {
  it('documents a string value and BY without a schema', () => {
    const query = 'source=test_logs | stats count() by message | where message = "test"';
    expect(queryHoverAt(query, query.indexOf('"test"') + 1, [])?.markdown).toContain('User input value of type `String`');
    expect(queryHoverAt(query, query.indexOf(' by ') + 2, [])?.markdown).toContain('Groups aggregation results');
  });

  it('shows the mapped type of a source field', () => {
    const query = 'source=test-reader | where pid = 1';
    expect(queryHoverAt(query, query.indexOf('pid'), templates)?.markdown).toContain('**PPL type:** `bigint`');
  });

  it('documents numbers, booleans, null and every logical keyword', () => {
    const query = 'source=test_logs | where pid = 1 AND message = "test" OR pid > 1.5';
    expect(queryHoverAt(query, query.indexOf(' = 1') + 3, [])?.markdown).toContain('`Integer`');
    expect(queryHoverAt(query, query.indexOf('1.5'), [])?.markdown).toContain('`Double`');
    for (const keyword of ['AND', 'OR']) {
      expect(queryHoverAt(query, query.indexOf(keyword), [])?.markdown).toContain(`**PPL keyword:** \`${keyword}\``);
    }
    const boolean = 'source=test_logs | where flag = true';
    expect(queryHoverAt(boolean, boolean.indexOf('true'), [])?.markdown).toContain('`Boolean`');
    const nullable = 'source=test_logs | where flag = null';
    expect(queryHoverAt(nullable, nullable.indexOf('null'), [])?.markdown).toContain('`Null`');
  });

  it('distinguishes index names, lookup fields and field names matching keywords', () => {
    const query = 'source="test-reader" | lookup test_workers-reader employee_id as pid replace department as team | where team = "test"';
    expect(queryHoverAt(query, query.indexOf('test-reader'), lookupTemplates)?.markdown).toContain('**Index:**');
    expect(queryHoverAt(query, query.indexOf('test_workers-reader'), lookupTemplates)?.markdown).toContain('**Index:**');
    expect(queryHoverAt(query, query.indexOf('employee_id'), lookupTemplates)?.markdown).toContain('**PPL type:** `string`');
    expect(queryHoverAt(query, query.indexOf('department'), lookupTemplates)?.markdown).toContain('**PPL type:** `string`');
    expect(queryHoverAt(query, query.lastIndexOf('team'), lookupTemplates)?.markdown).toContain('**PPL type:** `string`');
    const field = 'source=test-reader | where by = 1';
    expect(queryHoverAt(field, field.indexOf('by'), templates)?.markdown).toContain('**PPL type:** `string`');
  });

  it('lists resolved lookup fields with types and honors the index allowlist', () => {
    const query = 'source=test-reader | lookup test_workers-reader employee_id as pid';
    const offset = query.indexOf('test_workers-reader');
    const hover = queryHoverAt(query, offset, lookupTemplates)?.markdown;
    expect(hover).toContain('**Index:** `test_workers-reader`');
    expect(hover).toContain('**Available fields:**');
    expect(hover).toContain('`employee_id`');
    expect(hover).toContain('`department`');
    expect(hover).toContain('`string`');
    expect(hover).not.toContain('`pid`');
    expect(queryHoverAt(query, offset, lookupTemplates, ['test-reader'])?.markdown)
      .toContain('No matching mapped fields');
  });

  it('preserves function and command docs and excludes comments', () => {
    const query = 'source=test-reader | where lower(message) = "test" // AND';
    expect(queryHoverAt(query, query.indexOf('lower'), templates)?.markdown).toContain('PPL Function');
    expect(queryHoverAt(query, query.indexOf('where'), templates)?.markdown).toContain('PPL Command');
    expect(queryHoverAt(query, query.lastIndexOf('AND'), templates)).toBeUndefined();
  });

  it('types computed, joined and unverified fields without inventing types', () => {
    const computed = 'source=test-reader | eval size = pid + 1 | where size > 0';
    expect(queryHoverAt(computed, computed.lastIndexOf('size'), lookupTemplates)?.markdown).toContain('**PPL type:** `bigint`');
    const joined = 'source=test-reader | join pid test_workers-reader | where department = "test"';
    expect(queryHoverAt(joined, joined.indexOf('department'), lookupTemplates)?.markdown).toContain('**PPL type:** `string`');
    const unknown = 'source=test-reader | where missing = 1';
    expect(queryHoverAt(unknown, unknown.indexOf('missing'), lookupTemplates)?.markdown).toContain('**PPL type:** Unknown');
    const bare = 'source=test-reader | stats count by message';
    expect(queryHoverAt(bare, bare.indexOf('count'), lookupTemplates)?.markdown).toContain('PPL Function');
  });

  it('types both sides of an aliased join condition and the source mapping key', () => {
    const query = 'source=test-reader | join left=l right=r on l.pid = r.employee_id test_workers-reader';
    expect(queryHoverAt(query, query.indexOf('l.pid'), lookupTemplates)?.markdown).toContain('**PPL type:** `bigint`');
    expect(queryHoverAt(query, query.indexOf('r.employee_id'), lookupTemplates)?.markdown).toContain('**PPL type:** `string`');
    const lookup = 'source=test-reader | lookup test_workers-reader employee_id as pid';
    expect(queryHoverAt(lookup, lookup.lastIndexOf('pid'), lookupTemplates)?.markdown).toContain('**PPL type:** `bigint`');
    const named = 'source=test-reader | join on pid = test_workers-reader.employee_id test_workers-reader';
    expect(queryHoverAt(named, named.indexOf('test_workers-reader.employee_id'), lookupTemplates)?.markdown)
      .toContain('**PPL type:** `string`');
  });

  it('uses exact token ranges for literals and documents join and lookup keywords', () => {
    const query = 'source=test-reader | left join left=l right=r on l.pid = r.employee_id test_workers-reader';
    expect(queryHoverAt(query, query.indexOf('left join'), lookupTemplates)?.markdown).toContain('PPL keyword');
    expect(queryHoverAt(query, query.indexOf(' on ') + 1, lookupTemplates)?.markdown).toContain('join condition');
    const lookup = 'source=test-reader | lookup test_workers-reader employee_id as pid append department';
    expect(queryHoverAt(lookup, lookup.indexOf('append'), lookupTemplates)?.markdown).toContain('lookup values');
    const input = 'source=test-reader | where message = "hello world"';
    const start = input.indexOf('"hello world"');
    expect(queryHoverAt(input, start + 4, lookupTemplates)?.span).toEqual({ start, end: start + '"hello world"'.length });
  });
});
