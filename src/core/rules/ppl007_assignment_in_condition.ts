import {
  BinaryExpressionNode,
  ExpressionNode,
  FunctionCallNode,
  LintRule,
  PipelineNode,
  RuleContext,
  UnaryExpressionNode,
  WhereStageNode,
} from '../../types';

export const PPL007_AssignmentInCondition: LintRule = {
  id: 'PPL007',
  name: 'AssignmentInCondition',
  description: "Flags assignment operator '=' in boolean conditions where equality '==' was likely intended.",
  defaultSeverity: 'warning',
  check(ast: PipelineNode, context: RuleContext): void {
    function inspectExpression(expr: ExpressionNode | undefined): void {
      if (!expr) return;

      if (expr.type === 'BinaryExpression') {
        const bin = expr as BinaryExpressionNode;
        if (bin.operator === '=') {
          // Find the span of the '=' operator
          // The operator is located between bin.left.span.end and bin.right.span.start
          const opSpan = {
            start: bin.left.span.end,
            end: bin.right.span.start,
          };

          context.report({
            code: 'PPL007',
            message: "Assignment operator '=' used in boolean expression. Did you mean '=='?",
            severity: 'warning',
            span: opSpan,
            data: {
              suggestion: '==',
              replaceSpan: opSpan,
            },
          });
        }

        inspectExpression(bin.left);
        inspectExpression(bin.right);
      } else if (expr.type === 'UnaryExpression') {
        inspectExpression((expr as UnaryExpressionNode).argument);
      } else if (expr.type === 'FunctionCall') {
        for (const argument of (expr as FunctionCallNode).arguments) inspectExpression(argument);
      }
    }

    for (const stage of ast.stages) {
      if (stage.type === 'WhereStage') {
        inspectExpression((stage as WhereStageNode).condition);
      }
    }
  },
};
