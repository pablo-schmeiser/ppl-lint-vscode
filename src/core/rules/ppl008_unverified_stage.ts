import { LintRule, PipelineNode, RuleContext } from '../../types';
import { DEFAULT_KNOWN_COMMANDS } from '../catalog/commands';

export const PPL008_UnverifiedStage: LintRule = {
  id: 'PPL008',
  name: 'UnverifiedStage',
  description: 'Rejects stages whose arguments are not represented in the syntax tree.',
  defaultSeverity: 'error',
  check(ast: PipelineNode, context: RuleContext): void {
    for (const stage of ast.stages) {
      if (stage.type !== 'GenericStage') continue;
      const command = stage.commandName.toLowerCase();
        if (!DEFAULT_KNOWN_COMMANDS.includes(command) &&
          !context.getCustomCommands?.().some((name) => name.toLowerCase() === command)) continue;
      context.report({
        code: 'PPL008',
        message: `Validation not implemented for '${stage.commandName}' arguments; this does not mean the query is invalid PPL.`,
        severity: 'error',
        span: stage.span,
      });
    }
  },
};
