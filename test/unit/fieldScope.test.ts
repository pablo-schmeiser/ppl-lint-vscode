import { describe, expect, it } from 'vitest';
import { fieldsAt } from '../../src/core/fieldScope';
import { KnownField } from '../../src/core/indexTemplates';

const source = new Map<string, KnownField>([
  ['host.name', { types: ['keyword'], templates: ['auditd'] }],
  ['auditd.data.pid', { types: ['long'], templates: ['auditd'] }],
  ['message', { types: ['text'], templates: ['auditd'] }],
]);

describe('field visibility', () => {
  it('preserves input fields in stats operands and replaces them with grouped and aliased outputs afterward', () => {
    const query = 'source=auditd-reader | stats count(auditd.data.pid) as total by host.name | where total > 0';
    expect([...fieldsAt(query, source, query.indexOf('auditd.data.pid')).keys()]).toContain('auditd.data.pid');
    const after = fieldsAt(query, source, query.indexOf('total > 0'));
    expect([...after.keys()]).toEqual(['total', 'host.name']);
    expect(after.has('auditd.data.pid')).toBe(false);
  });

  it('tracks eval, rename, and fields across pipes without altering the input scope of a stage', () => {
    const query = 'source=auditd-reader | eval size = auditd.data.pid | rename size as bytes | fields bytes, host.name | sort bytes';
    expect(fieldsAt(query, source, query.indexOf('auditd.data.pid', 25)).has('size')).toBe(false);
    const final = fieldsAt(query, source, query.lastIndexOf('bytes'));
    expect([...final.keys()]).toEqual(['bytes', 'host.name']);
  });

  it('offers an aliased group expression after stats, not its input field', () => {
    const query = 'source=auditd-reader | stats count() as total by span(auditd.data.pid, 10) as bucket | where ';
    const output = fieldsAt(query, source, query.length);
    expect([...output.keys()]).toEqual(['total', 'bucket']);
  });

  it('moves mapped descendants when an object path is renamed', () => {
    const query = 'source=auditd-reader | rename host as machine | where ';
    const output = fieldsAt(query, source, query.length);
    expect(output.has('machine.name')).toBe(true);
    expect(output.has('host.name')).toBe(false);
  });
});
