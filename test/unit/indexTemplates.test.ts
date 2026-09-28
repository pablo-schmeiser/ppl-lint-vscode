import { describe, expect, it } from 'vitest';
import { parseIndexTemplates, resolveSource } from '../../src/core/indexTemplates';

const template = (name: string, type: string) => `---
kind: OpensearchIndexTemplate
metadata:
  name: ${name}
spec:
  indexPatterns: ["indices-${name}-*"]
  template:
    settings:
      plugins.index_state_management:
        rollover_alias: auditd-${name}-writer
    aliases:
      auditd-reader: {}
    mappings:
      dynamic: false
      properties:
        host:
          properties:
            name: { type: keyword }
        message:
          type: text
          fields:
            keyword: { type: keyword }
        event:
          properties:
            sequence: { type: ${type} }
        ticket: { type: wildcard }
`;

describe('workspace index templates', () => {
  it('normalizes nested and multifields and unions alias members without hiding conflicts', () => {
    const templates = [
      ...parseIndexTemplates(template('one', 'long'), 'one.yaml'),
      ...parseIndexTemplates(template('two', 'keyword'), 'two.yaml'),
    ];
    const fields = resolveSource(templates, 'auditd-reader');

    expect(fields.get('host.name')?.types).toEqual(['keyword']);
    expect(fields.get('host')?.pplTypes).toEqual(['struct']);
    expect(fields.get('event')?.pplTypes).toEqual(['struct']);
    expect(fields.get('message.keyword')?.types).toEqual(['keyword']);
    expect(fields.get('ticket')?.pplTypes).toEqual(['string']);
    expect(fields.get('event.sequence')?.types).toEqual(['long', 'keyword']);
    expect(fields.get('event.sequence')?.templates).toEqual(['one', 'two']);
    expect(resolveSource(templates, 'indices-one-2026').has('host.name')).toBe(true);
    expect(resolveSource(templates, 'auditd-one-writer').has('host.name')).toBe(true);
    expect(resolveSource(templates, 'unknown').size).toBe(0);
    expect(resolveSource([], 'auditd-reader').size).toBe(0);
    expect(resolveSource(templates, 'indices-*').get('event.sequence')?.types).toEqual(['long', 'keyword']);
  });
});