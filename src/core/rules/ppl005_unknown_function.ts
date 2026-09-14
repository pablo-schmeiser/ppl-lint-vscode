import {
  BinaryExpressionNode,
  ExpressionNode,
  FunctionCallNode,
  LintRule,
  PipelineNode,
  RuleContext,
  StatsStageNode,
  UnaryExpressionNode,
  WhereStageNode,
} from '../../types';
import {
  DEFAULT_KNOWN_FUNCTIONS,
  DEFAULT_KNOWN_FUNCTIONS_SET,
} from '../catalog/functions';
import { findClosestMatch } from './rule';

export const PPL005_UnknownFunction: LintRule = {
  id: 'PPL005',
  name: 'UnknownFunction',
  description: 'Flags unknown function names in expressions and aggregations.',
  defaultSeverity: 'warning',
  check(ast: PipelineNode, context: RuleContext): void {
    const customFunctions = (context.getCustomFunctions?.() || []).map((f) => f.toLowerCase());
    const knownSet =
      customFunctions.length > 0
        ? new Set([...DEFAULT_KNOWN_FUNCTIONS, ...customFunctions])
        : DEFAULT_KNOWN_FUNCTIONS_SET;
    const knownList =
      customFunctions.length > 0
        ? Array.from(knownSet)
        : (DEFAULT_KNOWN_FUNCTIONS as string[]);

    function inspectExpression(expr: ExpressionNode | undefined): void {
      if (!expr) return;

      if (expr.type === 'FunctionCall') {
        const func = expr as FunctionCallNode;
        const name = func.functionName.toLowerCase();
        if (!knownSet.has(name)) {
          const suggestion = findClosestMatch(name, knownList, 3);
          const message = suggestion
            ? `Unknown function '${func.functionName}'. Did you mean '${suggestion}'?`
            : `Unknown function '${func.functionName}'.`;

          context.report({
            code: 'PPL005',
            message,
            severity: 'warning',
            span: func.span,
            data: suggestion
              ? {
                  suggestion,
                  replaceSpan: {
                    start: func.span.start,
                    end: {
                      line: func.span.start.line,
                      col: func.span.start.col + func.functionName.length,
                      offset: func.span.start.offset + func.functionName.length,
                    },
                  },
                }
              : undefined,
          });
        }

        for (const arg of func.arguments) {
          inspectExpression(arg);
        }
      } else if (expr.type === 'BinaryExpression') {
        const bin = expr as BinaryExpressionNode;
        inspectExpression(bin.left);
        inspectExpression(bin.right);
      } else if (expr.type === 'UnaryExpression') {
        const un = expr as UnaryExpressionNode;
        inspectExpression(un.argument);
      }
    }

    for (const stage of ast.stages) {
      if (stage.type === 'WhereStage') {
        inspectExpression((stage as WhereStageNode).condition);
      } else if (stage.type === 'StatsStage') {
        for (const agg of (stage as StatsStageNode).aggregations) {
          inspectExpression(agg);
        }
      }
    }
  },
};
