import { LintRule, PipelineNode, RuleContext } from '../../types';

export const PPL001_SyntaxError: LintRule = {
  id: 'PPL001',
  name: 'SyntaxError',
  description: 'Reports syntax errors captured during parsing.',
  defaultSeverity: 'error',
  check(ast: PipelineNode, context: RuleContext): void {
    for (const err of ast.syntaxErrors) {
      // Do not duplicate missing source error if PPL002 handles it
      if (err.message.includes('Missing source command')) {
        continue;
      }

      context.report({
        code: 'PPL001',
        message: err.message,
        severity: 'error',
        span: err.span,
      });
    }
  },
};
