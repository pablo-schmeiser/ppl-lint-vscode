import { describe, expect, it } from 'vitest';
import { fieldsAt } from '../../src/core/fieldScope';
import { KnownField } from '../../src/core/indexTemplates';

const source = new Map<string, KnownField>([
  ['host.name', { types: ['keyword'], templates: ['test-audit'] }],
  ['test-audit.data.pid', { types: ['long'], templates: ['test-audit'] }],
  ['message', { types: ['text'], templates: ['test-audit'] }],
]);

describe('field visibility', () => {
  it('preserves input fields in stats operands and replaces them with grouped and aliased outputs afterward', () => {
    const query = 'source=test-reader | stats count(test-audit.data.pid) as total by host.name | where total > 0';
    expect([...fieldsAt(query, source, query.indexOf('test-audit.data.pid')).keys()]).toContain('test-audit.data.pid');
    const after = fieldsAt(query, source, query.indexOf('total > 0'));
    expect([...after.keys()]).toEqual(['total', 'host.name']);
    expect(after.has('test-audit.data.pid')).toBe(false);
  });

  it('tracks eval, rename, and fields across pipes without altering the input scope of a stage', () => {
    const query = 'source=test-reader | eval size = test-audit.data.pid | rename size as bytes | fields bytes, host.name | sort bytes';
    expect(fieldsAt(query, source, query.indexOf('test-audit.data.pid', 25)).has('size')).toBe(false);
    const final = fieldsAt(query, source, query.lastIndexOf('bytes'));
    expect([...final.keys()]).toEqual(['bytes', 'host.name']);
  });

  it('offers an aliased group expression after stats, not its input field', () => {
    const query = 'source=test-reader | stats count() as total by span(test-audit.data.pid, 10) as bucket | where ';
    const output = fieldsAt(query, source, query.length);
    expect([...output.keys()]).toEqual(['total', 'bucket']);
  });

  it('moves mapped descendants when an object path is renamed', () => {
    const query = 'source=test-reader | rename host as machine | where ';
    const output = fieldsAt(query, source, query.length);
    expect(output.has('machine.name')).toBe(true);
    expect(output.has('host.name')).toBe(false);
  });
});
