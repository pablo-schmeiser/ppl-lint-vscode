import { EvalStageNode, FieldsStageNode, PipeStageNode, RenameStageNode, StatsStageNode } from '../types';
import { KnownField } from './indexTemplates';
import { parsePpl } from './parser/parser';

function project(fields: Map<string, KnownField>, stage: FieldsStageNode): Map<string, KnownField> {
  const selected = stage.fields.map((field) => field.name);
  if (stage.mode === '-') {
    return new Map([...fields].filter(([name]) => !selected.some((prefix) => name === prefix || name.startsWith(`${prefix}.`))));
  }
  return new Map(selected.flatMap((prefix) => [...fields].filter(([name]) => name === prefix || name.startsWith(`${prefix}.`))));
}

function applyStage(fields: Map<string, KnownField>, stage: PipeStageNode): Map<string, KnownField> {
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
    default:
      return next;
  }
}

export function fieldsAt(query: string, sourceFields: Map<string, KnownField>, offset: number): Map<string, KnownField> {
  const ast = parsePpl(query);
  let fields = new Map(sourceFields);
  for (const stage of ast.stages) {
    if (offset <= stage.span.end.offset) return fields;
    fields = applyStage(fields, stage);
  }
  return fields;
}

export function fieldsBeforeStageAt(
  query: string,
  sourceFields: Map<string, KnownField>,
  offset: number,
  commands: readonly string[]
): Map<string, KnownField> {
  const ast = parsePpl(query);
  let fields = new Map(sourceFields);
  const selected = new Set(commands.map((command) => command.toLowerCase()));
  for (let index = 0; index < ast.stages.length; index++) {
    const stage = ast.stages[index];
    const nextStageStart = ast.stages[index + 1]?.span.start.offset ?? query.length;
    const cursorIsInStage = stage.span.start.offset <= offset && offset <= nextStageStart;
    if (cursorIsInStage && selected.has(stage.commandName.toLowerCase())) return fields;
    if (offset <= stage.span.end.offset) return fields;
    fields = applyStage(fields, stage);
  }
  return fields;
}