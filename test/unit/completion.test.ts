import { describe, expect, it } from 'vitest';
import { completionCandidates } from '../../src/core/completion';
import { parseIndexTemplates } from '../../src/core/indexTemplates';
import { PPL_TYPES } from '../../src/core/pplTypes';

const templates = parseIndexTemplates(`kind: OpensearchIndexTemplate
metadata: { name: auditd }
spec:
  indexPatterns: ['auditd-*']
  template:
    aliases: { auditd-reader: {} }
    mappings:
      properties:
        host:
          properties:
            name: { type: keyword }
        pid: { type: long }
`, 'template.yaml');

describe('completion candidates', () => {
  it('offers aliases at source and fields visible at the current stage', () => {
    expect(completionCandidates('source=aud', 10, templates).map((item) => item.label)).toContain('auditd-reader');
    const input = 'source=auditd-reader | stats count(pid) as total by host.name';
    expect(completionCandidates(input, input.indexOf('pid'), templates).map((item) => item.label)).toContain('pid');
    const output = `${input} | where `;
    expect(completionCandidates(output, output.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label)).toEqual(['total', 'host.name']);
  });

  it('offers every input field in fields projections, including after commas', () => {
    const emptyProjection = 'source=auditd-reader | fields ';
    const allFields = completionCandidates(emptyProjection, emptyProjection.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label);
    expect(allFields).toContain('host.name');
    expect(allFields).toContain('pid');

    const partialProjection = `${emptyProjection}host.name, `;
    const remaining = completionCandidates(partialProjection, partialProjection.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label);
    expect(remaining).toContain('pid');
  });

  it('only excludes fields selected in the current fields stage', () => {
    const query = 'source=auditd-reader | where pid > 0 | fields host.name, ';
    const labels = completionCandidates(query, query.length, templates)
      .filter((item) => item.kind === 'field')
      .map((item) => item.label);
    expect(labels).toContain('pid');
    expect(labels).not.toContain('host.name');
  });

  it('keeps schema fields unavailable without templates but still suggests built-ins', () => {
    const candidates = completionCandidates('source=missing | where ', 23, []);
    expect(candidates.some((candidate) => candidate.kind === 'field')).toBe(false);
    expect(candidates.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
  });

  it('limits source and field suggestions to the configured index allowlist', () => {
    const sourceCandidates = completionCandidates('source=aud', 10, templates, ['auditd-reader']);
    expect(sourceCandidates.map((candidate) => candidate.label)).toEqual(['auditd-reader']);

    const query = 'source=other-index | where ';
    const fieldCandidates = completionCandidates(query, query.length, templates, ['auditd-*']);
    expect(fieldCandidates.some((candidate) => candidate.kind === 'field')).toBe(false);
    expect(fieldCandidates.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(true);
  });

  it('suggests functions without loading index templates', () => {
    const query = 'source=missing | eval label = lo';
    const candidates = completionCandidates(query, query.length, []);
    const lower = candidates.find((candidate) => candidate.label === 'lower' && candidate.kind === 'function');
    expect(lower?.detail).toBe('lower(string)');
    expect(lower?.documentation).toContain('Converts a string to lowercase.');
    expect(lower?.documentation).toContain('OpenSearch PPL reference');
  });

  it('suggests pipeline commands after a pipe and aggregations after stats', () => {
    const afterPipe = 'source=auditd-reader | ';
    const commands = completionCandidates(afterPipe, afterPipe.length, templates);
    expect(commands.find((candidate) => candidate.label === 'stats' && candidate.kind === 'command')?.retriggerAfterAccept).toBe(true);

    const stats = 'source=auditd-reader | stats ';
    const aggregations = completionCandidates(stats, stats.length, templates);
    expect(aggregations.find((candidate) => candidate.label === 'count' && candidate.kind === 'function')?.retriggerAfterAccept).toBe(true);
    expect(aggregations.some((candidate) => candidate.label === 'sum' && candidate.kind === 'function')).toBe(true);
    expect(aggregations.some((candidate) => candidate.label === 'lower' && candidate.kind === 'function')).toBe(false);
  });

  it('suggests logical and pipeline continuations after a where comparison', () => {
    const query = 'source=auditd-reader | where event.type="login"';
    const candidates = completionCandidates(query, query.length, templates);

    expect(candidates.map((candidate) => candidate.label)).toEqual(['AND', 'OR', '|']);
  });

  it('filters function argument fields by the current signature', () => {
    const numericQuery = 'source=auditd-reader | where abs(';
    const numeric = completionCandidates(numericQuery, numericQuery.length, templates);
    expect(numeric.some((candidate) => candidate.label === 'pid' && candidate.kind === 'field')).toBe(true);
    expect(numeric.find((candidate) => candidate.label === 'host.name')?.detail).toContain('implicit conversion');

    const stringQuery = 'source=auditd-reader | where length(';
    const strings = completionCandidates(stringQuery, stringQuery.length, templates);
    expect(strings.some((candidate) => candidate.label === 'host.name')).toBe(true);
    expect(strings.some((candidate) => candidate.label === 'pid')).toBe(false);
  });

  it('suggests nested functions by expected argument type and cast target types', () => {
    const numericQuery = 'source=auditd-reader | where abs(sq';
    const numeric = completionCandidates(numericQuery, numericQuery.length, templates);
    expect(numeric.some((candidate) => candidate.label === 'sqrt' && candidate.kind === 'function')).toBe(true);
    expect(numeric.some((candidate) => candidate.label === 'lower')).toBe(false);

    const castQuery = 'source=auditd-reader | eval value = CAST(event.sequence AS ';
    const castTypes = completionCandidates(castQuery, castQuery.length, templates);
    expect(castTypes.map((candidate) => candidate.label)).toEqual([...PPL_TYPES]);
  });

  it('does not suggest fields or functions inside strings and comments', () => {
    const literal = "source=missing | where message == 'lo";
    const comment = 'source=missing | where status == 1 // low';
    expect(completionCandidates(literal, literal.length, [])).toEqual([]);
    expect(completionCandidates(comment, comment.length, [])).toEqual([]);
  });
});