import * as YAML from 'yaml';
import { normalizeOpenSearchTypes, PplType } from './pplTypes';

export interface KnownField {
  types: string[];
  pplTypes?: PplType[];
  templates: string[];
}

export interface IndexTemplate {
  name: string;
  patterns: string[];
  aliases: string[];
  fields: Map<string, KnownField>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function flatten(properties: unknown, prefix: string, name: string, fields: Map<string, KnownField>): void {
  for (const [key, value] of Object.entries(object(properties))) {
    const mapping = object(value);
    const path = prefix ? `${prefix}.${key}` : key;
    const hasProperties = mapping.properties !== undefined;
    const mappingType = typeof mapping.type === 'string' ? mapping.type : hasProperties ? 'object' : undefined;
    if (mappingType) {
      fields.set(path, {
        types: [mappingType],
        pplTypes: normalizeOpenSearchTypes([mappingType]),
        templates: [name],
      });
    }
    flatten(mapping.properties, path, name, fields);
    flatten(mapping.fields, path, name, fields);
  }
}

export function parseIndexTemplates(text: string, source: string): IndexTemplate[] {
  const templates: IndexTemplate[] = [];
  for (const document of YAML.parseAllDocuments(text)) {
    if (document.errors.length) continue;
    const root = object(document.toJS());
    if (root.kind !== 'OpensearchIndexTemplate') continue;
    const spec = object(root.spec);
    const template = object(spec.template);
    const patterns = Array.isArray(spec.indexPatterns)
      ? spec.indexPatterns.filter((pattern): pattern is string => typeof pattern === 'string')
      : [];
    if (!patterns.length) continue;
    const name = String(object(root.metadata).name || source);
    const aliases = Object.keys(object(template.aliases));
    const settings = object(template.settings);
    const nestedIsm = object(object(settings.plugins).index_state_management);
    const dottedIsm = object(settings['plugins.index_state_management']);
    const rollover = nestedIsm.rollover_alias ?? dottedIsm.rollover_alias;
    if (typeof rollover === 'string') aliases.push(rollover);
    const fields = new Map<string, KnownField>();
    flatten(object(template.mappings).properties, '', name, fields);
    templates.push({ name, patterns, aliases: [...new Set(aliases)], fields });
  }
  return templates;
}

export function parseOpenSearchIndexTemplates(response: unknown): IndexTemplate[] {
  const responseTemplates = object(response).index_templates;
  const indexTemplates = Array.isArray(responseTemplates) ? responseTemplates : [];
  const templates: IndexTemplate[] = [];

  for (const entry of indexTemplates) {
    const item = object(entry);
    const name = typeof item.name === 'string' ? item.name : '';
    const definition = object(item.index_template);
    const patterns = Array.isArray(definition.index_patterns)
      ? definition.index_patterns.filter((pattern): pattern is string => typeof pattern === 'string')
      : [];
    if (!name || !patterns.length) continue;

    const template = object(definition.template);
    const aliases = Object.keys(object(template.aliases));
    const settings = object(template.settings);
    const nestedIsm = object(object(settings.plugins).index_state_management);
    const dottedIsm = object(settings['plugins.index_state_management']);
    const rollover = nestedIsm.rollover_alias ?? dottedIsm.rollover_alias;
    if (typeof rollover === 'string') aliases.push(rollover);

    const fields = new Map<string, KnownField>();
    flatten(object(template.mappings).properties, '', name, fields);
    templates.push({ name, patterns, aliases: [...new Set(aliases)], fields });
  }

  return templates;
}

export function parseOpenSearchIndexMappings(response: unknown, selector: string): IndexTemplate[] {
  const indexes = object(response);
  const templates: IndexTemplate[] = [];
  for (const [index, value] of Object.entries(indexes)) {
    const mappings = object(object(value).mappings);
    const name = `mapping:${selector}:${index}`;
    const fields = new Map<string, KnownField>();
    flatten(mappings.properties, '', index, fields);
    templates.push({
      name,
      patterns: [index],
      aliases: [selector],
      fields,
    });
  }
  return templates;
}

function patternsOverlap(left: string, right: string): boolean {
  const seen = new Set<string>();
  const pending: Array<[number, number]> = [[0, 0]];
  const alphabet = new Set([...left, ...right].filter((char) => char !== '*' && char !== '?'));
  alphabet.add('\0');
  while (pending.length) {
    const [leftIndex, rightIndex] = pending.pop()!;
    const state = `${leftIndex}:${rightIndex}`;
    if (seen.has(state)) continue;
    seen.add(state);
    if (leftIndex === left.length && rightIndex === right.length) return true;
    if (left[leftIndex] === '*') pending.push([leftIndex + 1, rightIndex]);
    if (right[rightIndex] === '*') pending.push([leftIndex, rightIndex + 1]);
    if (leftIndex === left.length || rightIndex === right.length) continue;
    for (const char of alphabet) {
      const accepts = (token: string): boolean => token === '*' || token === '?' || token === char;
      if (accepts(left[leftIndex]) && accepts(right[rightIndex])) {
        pending.push([
          leftIndex + (left[leftIndex] === '*' ? 0 : 1),
          rightIndex + (right[rightIndex] === '*' ? 0 : 1),
        ]);
      }
    }
  }
  return false;
}

function matchesIndexPattern(index: string, pattern: string): boolean {
  const expression = pattern.split('').map((character) => {
    if (character === '*') return '.*';
    if (character === '?') return '.';
    return character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('');
  return new RegExp(`^${expression}$`).test(index);
}

export function isSourceIncluded(source: string, includedIndexes: readonly string[] = []): boolean {
  const patterns = includedIndexes.map((index) => index.trim()).filter(Boolean);
  if (patterns.length === 0) return true;
  if (/[*?]/.test(source)) return patterns.includes(source);
  return patterns.some((pattern) => matchesIndexPattern(source, pattern));
}

export function resolveSource(
  templates: readonly IndexTemplate[],
  source: string,
  includedIndexes: readonly string[] = []
): Map<string, KnownField> {
  const fields = new Map<string, KnownField>();
  if (!isSourceIncluded(source, includedIndexes)) return fields;
  for (const template of templates) {
    if (!template.aliases.includes(source) && !template.patterns.some((pattern) =>
      patternsOverlap(source, pattern)
    )) continue;
    for (const [path, field] of template.fields) {
      const existing = fields.get(path);
      const existingPplTypes = existing?.pplTypes ?? normalizeOpenSearchTypes(existing?.types || []);
      const fieldPplTypes = field.pplTypes ?? normalizeOpenSearchTypes(field.types);
      fields.set(path, {
        types: [...new Set([...(existing?.types || []), ...field.types])],
        pplTypes: [...new Set([...existingPplTypes, ...fieldPplTypes])],
        templates: [...new Set([...(existing?.templates || []), ...field.templates])],
      });
    }
  }
  return fields;
}