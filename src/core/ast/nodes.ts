import {
  BinaryExpressionNode,
  CastExpressionNode,
  DedupStageNode,
  ErrorNode,
  EvalStageNode,
  ExpressionNode,
  FieldsStageNode,
  FunctionCallNode,
  GenericStageNode,
  HeadStageNode,
  IdentifierNode,
  LiteralNode,
  LambdaExpressionNode,
  PipelineNode,
  PipeStageNode,
  RenameStageNode,
  SortStageNode,
  SourceStageNode,
  Span,
  StatsStageNode,
  UnaryExpressionNode,
  WhereStageNode,
} from '../../types';

export function createPipelineNode(
  source: SourceStageNode | ErrorNode,
  stages: PipeStageNode[],
  syntaxErrors: ErrorNode[],
  span: Span
): PipelineNode {
  return {
    type: 'Pipeline',
    source,
    stages,
    syntaxErrors,
    span,
  };
}

export function createSourceStageNode(
  indexName: string,
  isSearchPrefix: boolean,
  span: Span
): SourceStageNode {
  return {
    type: 'SourceStage',
    commandName: isSearchPrefix ? 'search' : 'source',
    indexName,
    isSearchPrefix,
    span,
  };
}

export function createWhereStageNode(
  condition: ExpressionNode,
  span: Span
): WhereStageNode {
  return {
    type: 'WhereStage',
    commandName: 'where',
    condition,
    span,
  };
}

export function createEvalStageNode(
  assignments: EvalStageNode['assignments'],
  span: Span
): EvalStageNode {
  return { type: 'EvalStage', commandName: 'eval', assignments, span };
}

export function createHeadStageNode(count: number | undefined, span: Span): HeadStageNode {
  return { type: 'HeadStage', commandName: 'head', count, span };
}

export function createDedupStageNode(
  count: number | undefined,
  fields: IdentifierNode[],
  span: Span
): DedupStageNode {
  return { type: 'DedupStage', commandName: 'dedup', count, fields, span };
}

export function createStatsStageNode(
  aggregations: FunctionCallNode[],
  groupBy: IdentifierNode[],
  span: Span
): StatsStageNode {
  return {
    type: 'StatsStage',
    commandName: 'stats',
    aggregations,
    groupBy,
    span,
  };
}

export function createFieldsStageNode(
  fields: IdentifierNode[],
  mode: '+' | '-' | undefined,
  span: Span
): FieldsStageNode {
  return {
    type: 'FieldsStage',
    commandName: 'fields',
    mode,
    fields,
    span,
  };
}

export function createSortStageNode(
  fields: IdentifierNode[],
  direction: '+' | '-' | undefined,
  span: Span
): SortStageNode {
  return {
    type: 'SortStage',
    commandName: 'sort',
    direction,
    fields,
    span,
  };
}

export function createRenameStageNode(
  pairs: Array<{ from: IdentifierNode; to: IdentifierNode }>,
  span: Span
): RenameStageNode {
  return {
    type: 'RenameStage',
    commandName: 'rename',
    pairs,
    span,
  };
}

export function createGenericStageNode(
  commandName: string,
  rawArguments: string,
  span: Span
): GenericStageNode {
  return {
    type: 'GenericStage',
    commandName,
    rawArguments,
    span,
  };
}

export function createBinaryExpressionNode(
  left: ExpressionNode,
  operator: string,
  right: ExpressionNode,
  span: Span
): BinaryExpressionNode {
  return {
    type: 'BinaryExpression',
    left,
    operator,
    right,
    span,
  };
}

export function createCastExpressionNode(
  expression: ExpressionNode,
  targetType: string,
  targetTypeSpan: Span,
  span: Span
): CastExpressionNode {
  return { type: 'CastExpression', expression, targetType, targetTypeSpan, span };
}

export function createUnaryExpressionNode(
  operator: string,
  argument: ExpressionNode,
  span: Span
): UnaryExpressionNode {
  return {
    type: 'UnaryExpression',
    operator,
    argument,
    span,
  };
}

export function createFunctionCallNode(
  functionName: string,
  args: ExpressionNode[],
  span: Span
): FunctionCallNode {
  return {
    type: 'FunctionCall',
    functionName,
    arguments: args,
    span,
  };
}

export function createLambdaExpressionNode(parameters: IdentifierNode[], body: ExpressionNode, span: Span): LambdaExpressionNode {
  return { type: 'LambdaExpression', parameters, body, span };
}

export function createIdentifierNode(
  name: string,
  isBacktickQuoted: boolean,
  span: Span
): IdentifierNode {
  return {
    type: 'Identifier',
    name,
    isBacktickQuoted,
    span,
  };
}

export function createLiteralNode(
  value: string | number | boolean | null,
  raw: string,
  span: Span
): LiteralNode {
  return {
    type: 'Literal',
    value,
    raw,
    span,
  };
}

export function createErrorNode(
  message: string,
  span: Span,
  expectedToken?: string,
  foundToken?: string
): ErrorNode {
  return {
    type: 'ErrorNode',
    message,
    span,
    expectedToken,
    foundToken,
  };
}
