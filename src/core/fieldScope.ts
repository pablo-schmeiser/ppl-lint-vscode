import { EvalStageNode, FieldsStageNode, JoinStageNode, LookupStageNode, PipeStageNode, RenameStageNode, StatsStageNode } from '../types';
import { KnownField } from './indexTemplates';
import { parsePpl } from './parser/parser';

function project(fields: Map<string, KnownField>, stage: FieldsStageNode): Map<string, KnownField> {
  const selected = stage.fields.map((field) => field.name);
  if (stage.mode === '-') {
    return new Map([...fields].filter(([name]) => !selected.some((prefix) => name === prefix || name.startsWith(`${prefix}.`))));
  }
  return new Map(selected.flatMap((prefix) => [...fields].filter(([name]) => name === prefix || name.startsWith(`${prefix}.`))));
}

type LookupFields = (source: string) => Map<string, KnownField>;

export function joinDatasetFields(
  query: string, dataset: JoinStageNode['dataset'], resolveFields: LookupFields
): Map<string, KnownField> {
  const source = dataset?.type === 'Identifier'
    ? dataset.name
    : dataset?.type === 'Pipeline' && dataset.source.type === 'SourceStage'
      ? dataset.source.indexName
      : undefined;
  if (!source) return new Map();
  const fields = resolveFields(source);
  if (dataset?.type !== 'Pipeline' || fields.size === 0) return fields;
  const innerQuery = query.slice(dataset.span.start.offset, dataset.span.end.offset);
  return fieldsAt(innerQuery, fields, innerQuery.length + 1, resolveFields);
}

function applyStage(
  fields: Map<string, KnownField>, stage: PipeStageNode, lookupFields?: LookupFields,
  query = '', sourceName = ''
): Map<string, KnownField> {
  const next = new Map(fields);
  switch (stage.type) {
    case 'EvalStage':
      for (const assignment of (stage as EvalStageNode).assignments) {
        next.set(assignment.field.name, { types: [], templates: [] });
      }
      return next;
    case 'RenameStage':
      for (const pair of (stage as RenameStageNode).pairs) {
        const renamed = [...next].filter(([name]) =>
          name === pair.from.name || name.startsWith(`${pair.from.name}.`)
        );
        for (const [name] of renamed) next.delete(name);
        for (const [name, field] of renamed) {
          next.set(pair.to.name + name.slice(pair.from.name.length), field);
        }
      }
      return next;
    case 'FieldsStage':
      return project(next, stage as FieldsStageNode);
    case 'StatsStage': {
      const output = new Map<string, KnownField>();
      for (const aggregation of (stage as StatsStageNode).aggregations) {
        const name = aggregation.alias;
        if (name) output.set(name, { types: [], templates: [] });
      }
      for (const field of (stage as StatsStageNode).groupBy) {
        output.set(field.name, fields.get(field.name) || { types: [], templates: [] });
      }
      return output;
    }
    case 'LookupStage': {
      const lookup = stage as LookupStageNode;
      const mapped = lookupFields?.(lookup.index.name);
      if (!mapped?.size) return next;
      const keys = new Set(lookup.mappings.map((mapping) => mapping.lookup.name));
      const outputs = lookup.outputs.length > 0
        ? lookup.outputs.map(({ input, output }) => [input.name, output?.name ?? input.name] as const)
        : [...mapped.keys()].filter((name) => !keys.has(name)).map((name) => [name, name] as const);
      for (const [input, output] of outputs) {
        const field = mapped.get(input);
        if (!field || (lookup.outputMode === 'append' && !next.has(output))) continue;
        if (lookup.outputMode !== 'append') next.set(output, field);
      }
      return next;
    }
    case 'JoinStage': {
      const join = stage as JoinStageNode;
      if (!lookupFields || /(?:^|\s)(?:semi|anti)$/.test(join.joinType ?? '')) return next;
      const right = joinDatasetFields(query, join.dataset, lookupFields);
      const rightSource = join.dataset?.type === 'Identifier'
        ? join.dataset.name
        : join.dataset?.type === 'Pipeline' && join.dataset.source.type === 'SourceStage'
          ? join.dataset.source.indexName
          : '';
      for (const [name, field] of right) {
        if (join.criteria && next.has(name)) {
          const left = next.get(name)!;
          next.delete(name);
          next.set(`${join.options.left ?? sourceName}.${name}`, left);
          next.set(`${join.options.right ?? join.datasetAlias?.name ?? rightSource}.${name}`, field);
          continue;
        }
        if (!next.has(name) || (join.fields.length > 0 && join.options.overwrite !== 'false')) {
          next.set(name, field);
        }
      }
      return next;
    }
    default:
      return next;
  }
}

export function fieldsAt(
  query: string, sourceFields: Map<string, KnownField>, offset: number, lookupFields?: LookupFields
): Map<string, KnownField> {
  const ast = parsePpl(query);
  const sourceName = ast.source.type === 'SourceStage' ? ast.source.indexName : '';
  let fields = new Map(sourceFields);
  for (const stage of ast.stages) {
    if (offset <= stage.span.end.offset) return fields;
    fields = applyStage(fields, stage, lookupFields, query, sourceName);
  }
  return fields;
}

export function fieldsBeforeStageAt(
  query: string,
  sourceFields: Map<string, KnownField>,
  offset: number,
  commands: readonly string[],
  lookupFields?: LookupFields
): Map<string, KnownField> {
  const ast = parsePpl(query);
  const sourceName = ast.source.type === 'SourceStage' ? ast.source.indexName : '';
  let fields = new Map(sourceFields);
  const selected = new Set(commands.map((command) => command.toLowerCase()));
  for (let index = 0; index < ast.stages.length; index++) {
    const stage = ast.stages[index];
    const nextStageStart = ast.stages[index + 1]?.span.start.offset ?? query.length;
    const cursorIsInStage = stage.span.start.offset <= offset && offset <= nextStageStart;
    if (cursorIsInStage && selected.has(stage.commandName.toLowerCase())) return fields;
    if (offset <= stage.span.end.offset) return fields;
    fields = applyStage(fields, stage, lookupFields, query, sourceName);
  }
  return fields;
}
