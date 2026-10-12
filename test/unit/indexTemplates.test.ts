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
  indexPatterns: ["test-indices-${name}-*"]
  template:
    settings:
      plugins.index_state_management:
        rollover_alias: test-audit-${name}-writer
    aliases:
      test-reader: {}
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
    const fields = resolveSource(templates, 'test-reader');

    expect(fields.get('host.name')?.types).toEqual(['keyword']);
    expect(fields.get('host')?.pplTypes).toEqual(['struct']);
    expect(fields.get('event')?.pplTypes).toEqual(['struct']);
    expect(fields.get('message.keyword')?.types).toEqual(['keyword']);
    expect(fields.get('ticket')?.pplTypes).toEqual(['string']);
    expect(fields.get('event.sequence')?.types).toEqual(['long', 'keyword']);
    expect(fields.get('event.sequence')?.templates).toEqual(['one', 'two']);
    expect(resolveSource(templates, 'test-indices-one-2026').has('host.name')).toBe(true);
    expect(resolveSource(templates, 'test-audit-one-writer').has('host.name')).toBe(true);
    expect(resolveSource(templates, 'unknown').size).toBe(0);
    expect(resolveSource([], 'test-reader').size).toBe(0);
    expect(resolveSource(templates, 'test-indices-*').get('event.sequence')?.types).toEqual(['long', 'keyword']);
  });

  it('parses native OpenSearch index-template responses for patterns, aliases, and mapped fields', () => {
    const templates = parseOpenSearchIndexTemplates({
      index_templates: [{
        name: 'test-audit-template',
        index_template: {
          index_patterns: ['test-audit-*'],
          template: {
            aliases: { 'test-reader': {} },
            settings: { 'plugins.index_state_management': { rollover_alias: 'test-audit-writer' } },
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
    expect(templates[0].patterns).toEqual(['test-audit-*']);
    expect(templates[0].aliases).toEqual(['test-reader', 'test-audit-writer']);
    expect(resolveSource(templates, 'test-audit-2026').get('host.name')?.types).toEqual(['keyword']);
    expect(resolveSource(templates, 'test-reader').get('message.keyword')?.types).toEqual(['keyword']);
  });

  it('parses live index mappings and resolves them by configured wildcard or selector alias', () => {
    const templates = parseOpenSearchIndexMappings({
      'test_users_2026': {
        mappings: {
          properties: {
            id: { type: 'keyword' },
            profile: { properties: { display_name: { type: 'text' } } },
          },
        },
      },
    }, 'test_*');

    expect(templates).toHaveLength(1);
    expect(resolveSource(templates, 'test_*').get('id')?.types).toEqual(['keyword']);
    expect(resolveSource(templates, 'test_users_*').get('profile.display_name')?.types).toEqual(['text']);
  });

  it('limits source resolution to exact names and configured wildcard patterns', () => {
    const templates = parseIndexTemplates(template('one', 'long'), 'one.yaml');

    expect(isSourceIncluded('test-indices-one-2026', ['test-indices-one-*'])).toBe(true);
    expect(isSourceIncluded('test-reader', ['test-reader'])).toBe(true);
    expect(isSourceIncluded('test-indices-one-*', ['test-indices-one-*'])).toBe(true);
    expect(isSourceIncluded('test-indices-one-*', ['test-indices-one-2026'])).toBe(false);
    expect(isSourceIncluded('test-indices-two-2026', ['test-indices-one-*'])).toBe(false);
    expect(resolveSource(templates, 'test-indices-one-2026', ['test-indices-one-*']).has('host.name')).toBe(true);
    expect(resolveSource(templates, 'test-indices-two-2026', ['test-indices-one-*'])).toEqual(new Map());
  });
});
