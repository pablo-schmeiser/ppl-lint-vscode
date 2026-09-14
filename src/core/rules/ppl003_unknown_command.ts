import { LintRule, PipelineNode, RuleContext } from '../../types';
import { DEFAULT_KNOWN_COMMANDS } from '../catalog/commands';
import { findClosestMatch } from './rule';

export const PPL003_UnknownCommand: LintRule = {
  id: 'PPL003',
  name: 'UnknownCommand',
  description: 'Flags unknown PPL command names and suggests the closest known command.',
  defaultSeverity: 'error',
  check(ast: PipelineNode, context: RuleContext): void {
    const customCommands = (context.getCustomCommands?.() || []).map((c) => c.toLowerCase());
    const knownCommands = [...DEFAULT_KNOWN_COMMANDS, ...customCommands];

    for (const stage of ast.stages) {
      const cmd = stage.commandName.toLowerCase();
      if (!knownCommands.includes(cmd)) {
        const suggestion = findClosestMatch(cmd, knownCommands, 3);
        const message = suggestion
          ? `Unknown command '${stage.commandName}'. Did you mean '${suggestion}'?`
          : `Unknown command '${stage.commandName}'.`;

        // Command span: from stage.span.start up to start.col + stage.commandName.length
        const cmdSpan = {
          start: stage.span.start,
          end: {
            line: stage.span.start.line,
            col: stage.span.start.col + stage.commandName.length,
            offset: stage.span.start.offset + stage.commandName.length,
          },
        };

        context.report({
          code: 'PPL003',
          message,
          severity: 'error',
          span: cmdSpan,
          data: suggestion
            ? {
                suggestion,
                replaceSpan: cmdSpan,
              }
            : undefined,
        });
      }
    }
  },
};
