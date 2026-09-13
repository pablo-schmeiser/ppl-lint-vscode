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
import { findClosestMatch } from './rule';

const KNOWN_FUNCTIONS = new Set([
  // Aggregations
  'count',
  'avg',
  'sum',
  'min',
  'max',
  'var_pop',
  'var_samp',
  'stddev_pop',
  'stddev_samp',
  'percentile',

  // Math
  'abs',
  'ceil',
  'ceiling',
  'floor',
  'round',
  'sqrt',
  'cbrt',
  'exp',
  'ln',
  'log',
  'log10',
  'log2',
  'pow',
  'power',

  // String
  'lower',
  'upper',
  'trim',
  'ltrim',
  'rtrim',
  'concat',
  'concat_ws',
  'length',
  'substr',
  'substring',
  'replace',
  'regexp_extract',

  // Date/Time
  'now',
  'current_timestamp',
  'date_format',
  'date_add',
  'date_sub',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',

  // Conditional / Null
  'if',
  'case',
  'coalesce',
  'isnull',
  'isnotnull',
  'nullif',

  // Type & Crypto
  'md5',
  'sha1',
  'sha256',
  'cast',
  'typeof',
]);

const KNOWN_FUNCTIONS_LIST = Array.from(KNOWN_FUNCTIONS);

export const PPL005_UnknownFunction: LintRule = {
  id: 'PPL005',
  name: 'UnknownFunction',
  description: 'Flags unknown function names in expressions and aggregations.',
  defaultSeverity: 'warning',
  check(ast: PipelineNode, context: RuleContext): void {
    function inspectExpression(expr: ExpressionNode | undefined): void {
      if (!expr) return;

      if (expr.type === 'FunctionCall') {
        const func = expr as FunctionCallNode;
        const name = func.functionName.toLowerCase();
        if (!KNOWN_FUNCTIONS.has(name)) {
          const suggestion = findClosestMatch(name, KNOWN_FUNCTIONS_LIST, 3);
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
