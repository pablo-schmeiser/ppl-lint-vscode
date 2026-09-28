import {
  DedupStageNode,
  EvalStageNode,
  FieldsStageNode,
  HeadStageNode,
  LintRule,
  PipelineNode,
  RenameStageNode,
  RuleContext,
  SortStageNode,
  StatsStageNode,
} from '../../types';

export const PPL004_InvalidArguments: LintRule = {
  id: 'PPL004',
  name: 'InvalidArguments',
  description: 'Flags standard commands that have missing or malformed required arguments.',
  defaultSeverity: 'error',
  check(ast: PipelineNode, context: RuleContext): void {
    for (const stage of ast.stages) {
      if (stage.type === 'DedupStage') {
        const dedup = stage as DedupStageNode;
        if (dedup.fields.length === 0 || (dedup.count !== undefined && (!Number.isInteger(dedup.count) || dedup.count < 1))) {
          context.report({ code: 'PPL004', message: "'dedup' requires fields and an optional positive integer count.", severity: 'error', span: stage.span });
        }
      }
      if (stage.type === 'EvalStage' && (stage as EvalStageNode).assignments.length === 0) {
        context.report({ code: 'PPL004', message: "'eval' requires at least one assignment.", severity: 'error', span: stage.span });
      }

      if (stage.type === 'HeadStage' && (!Number.isInteger((stage as HeadStageNode).count) || (stage as HeadStageNode).count! < 1)) {
        context.report({ code: 'PPL004', message: "'head' requires a positive integer count.", severity: 'error', span: stage.span });
      }

      if (stage.type === 'StatsStage') {
        const stats = stage as StatsStageNode;
        if (stats.aggregations.length === 0) {
          context.report({
            code: 'PPL004',
            message: "'stats' command requires at least one aggregation function (e.g. count(), avg(field)).",
            severity: 'error',
            span: stage.span,
          });
        }
      }

      if (stage.type === 'FieldsStage') {
        const fields = stage as FieldsStageNode;
        if (fields.fields.length === 0) {
          context.report({
            code: 'PPL004',
            message: "'fields' command requires at least one field identifier.",
            severity: 'error',
            span: stage.span,
          });
        }
      }

      if (stage.type === 'SortStage') {
        const sort = stage as SortStageNode;
        if (sort.fields.length === 0) {
          context.report({
            code: 'PPL004',
            message: "'sort' command requires at least one sort field.",
            severity: 'error',
            span: stage.span,
          });
        }
      }

      if (stage.type === 'RenameStage') {
        const rename = stage as RenameStageNode;
        if (rename.pairs.length === 0) {
          context.report({
            code: 'PPL004',
            message: "'rename' command requires at least one 'field as alias' mapping.",
            severity: 'error',
            span: stage.span,
          });
        }
      }
    }
  },
};
