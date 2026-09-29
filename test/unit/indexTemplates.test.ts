import { describe, expect, it } from 'vitest';
import {
  isSourceIncluded,
  parseOpenSearchIndexMappings,
  parseIndexTemplates,
  parseOpenSearchIndexTemplates,
  resolveSource,
} from '../../src/core/indexTemplates';

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

  it('parses native OpenSearch index-template responses for patterns, aliases, and mapped fields', () => {
    const templates = parseOpenSearchIndexTemplates({
      index_templates: [{
        name: 'auditd-template',
        index_template: {
          index_patterns: ['auditd-*'],
          template: {
            aliases: { 'auditd-reader': {} },
            settings: { 'plugins.index_state_management': { rollover_alias: 'auditd-writer' } },
            mappings: {
              properties: {
                host: { properties: { name: { type: 'keyword' } } },
                message: { type: 'text', fields: { keyword: { type: 'keyword' } } },
              },
            },
          },
        },
      }],
    });

    expect(templates).toHaveLength(1);
    expect(templates[0].patterns).toEqual(['auditd-*']);
    expect(templates[0].aliases).toEqual(['auditd-reader', 'auditd-writer']);
    expect(resolveSource(templates, 'auditd-2026').get('host.name')?.types).toEqual(['keyword']);
    expect(resolveSource(templates, 'auditd-reader').get('message.keyword')?.types).toEqual(['keyword']);
  });

  it('parses live index mappings and resolves them by configured wildcard or selector alias', () => {
    const templates = parseOpenSearchIndexMappings({
      'mam_users_2026': {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            profile: { properties: { display_name: { type: 'text' } } },
          },
        },
      },
    }, 'mam_*');

    expect(templates).toHaveLength(1);
    expect(resolveSource(templates, 'mam_*').get('id')?.types).toEqual(['keyword']);
    expect(resolveSource(templates, 'mam_users_*').get('profile.display_name')?.types).toEqual(['text']);
  });

  it('limits source resolution to exact names and configured wildcard patterns', () => {
    const templates = parseIndexTemplates(template('one', 'long'), 'one.yaml');

    expect(isSourceIncluded('indices-one-2026', ['indices-one-*'])).toBe(true);
    expect(isSourceIncluded('auditd-reader', ['auditd-reader'])).toBe(true);
    expect(isSourceIncluded('indices-one-*', ['indices-one-*'])).toBe(true);
    expect(isSourceIncluded('indices-one-*', ['indices-one-2026'])).toBe(false);
    expect(isSourceIncluded('indices-two-2026', ['indices-one-*'])).toBe(false);
    expect(resolveSource(templates, 'indices-one-2026', ['indices-one-*']).has('host.name')).toBe(true);
    expect(resolveSource(templates, 'indices-two-2026', ['indices-one-*'])).toEqual(new Map());
  });
});