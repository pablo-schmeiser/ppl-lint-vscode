import { LintRule, PipelineNode, RuleContext } from '../../types';

const HEAVY_OPERATIONS = new Set(['sort', 'stats', 'dedup']);

export const PPL006_LateFilterWarning: LintRule = {
  id: 'PPL006',
  name: 'LateFilterWarning',
  description: "Flags 'where' filter stages placed after heavy operations ('sort', 'stats', 'dedup').",
  defaultSeverity: 'warning',
  check(ast: PipelineNode, context: RuleContext): void {
    let lastHeavyOp: string | null = null;

    for (const stage of ast.stages) {
      const cmd = stage.commandName.toLowerCase();

      if (HEAVY_OPERATIONS.has(cmd)) {
        lastHeavyOp = cmd;
      } else if (cmd === 'where' && lastHeavyOp) {
        context.report({
          code: 'PPL006',
          message: `Late filter: 'where' placed after heavy command '${lastHeavyOp}' reduces query performance. Consider placing 'where' earlier in the pipeline.`,
          severity: 'warning',
          span: stage.span,
        });
      }
    }
  },
};
