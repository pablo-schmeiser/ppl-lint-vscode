import { LintRule, PipelineNode, RuleContext } from '../../types';

export const PPL002_MissingSource: LintRule = {
  id: 'PPL002',
  name: 'MissingSource',
  description: "Ensures the query begins with 'source=<index>' or 'search [source=]<index>'.",
  defaultSeverity: 'error',
  check(ast: PipelineNode, context: RuleContext): void {
    if (ast.source.type === 'ErrorNode') {
      context.report({
        code: 'PPL002',
        message: "Pipeline must start with 'source=<index>' or 'search [source=]<index>'",
        severity: 'error',
        span: ast.source.span,
        data: {
          suggestion: 'source=',
          replaceSpan: {
            start: ast.source.span.start,
            end: ast.source.span.start,
          },
        },
      });
    }
  },
};
