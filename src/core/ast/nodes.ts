import {
  BinaryExpressionNode,
  ErrorNode,
  ExpressionNode,
  FieldsStageNode,
  FunctionCallNode,
  GenericStageNode,
  IdentifierNode,
  LiteralNode,
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
