import { JoinStageNode, LookupStageNode, StatsStageNode, Token, TokenType } from '../types';
import { COMMAND_DOCS, DEFAULT_KNOWN_COMMANDS } from './catalog/commands';
import { functionDocumentation, functionInfoAt, renderFunctionDocumentation } from './catalog/functionDocumentation';
import { fieldInfoAt } from './fieldHover';
import { IndexTemplate, resolveSource } from './indexTemplates';
import { fieldsAt, joinDatasetFields } from './fieldScope';
import { tokenize } from './lexer/tokenizer';
import { parsePpl } from './parser/parser';

export interface QueryHoverInfo {
  markdown: string;
  span: { start: number; end: number };
}

const KEYWORDS: Record<string, string> = {
  by: 'Groups aggregation results by one or more fields.',
  as: 'Names the preceding field, expression, or dataset with an alias.',
  and: 'True when both conditions are true.',
  or: 'True when either condition is true.',
  not: 'Negates a boolean condition.',
  in: 'Tests whether a value belongs to a set of values.',
  like: 'Tests a string against a wildcard pattern.',
  replace: 'Replaces output fields with values from the lookup index.',
  append: 'Adds lookup values to existing source output fields.',
  output: 'Selects output fields from the lookup index.',
  on: 'Introduces a join condition between the left and right datasets.',
  type: 'Selects the join type.',
  overwrite: 'Controls whether matching right-side fields replace left-side fields.',
  max: 'Limits the number of right-side matches for each join row.',
  left: 'Names the left dataset in a join.',
  right: 'Names the right dataset in a join.',
  inner: 'Keeps rows with matching values on both sides of a join.',
  full: 'Keeps rows from both sides of a join.',
  cross: 'Combines rows from both sides of a join.',
  semi: 'Keeps left-side rows that have a right-side match.',
  anti: 'Keeps left-side rows without a right-side match.',
  isnull: 'Tests whether a value is null.',
  isnotnull: 'Tests whether a value is not null.',
};

const OPERATORS: Partial<Record<TokenType, string>> = {
  [TokenType.PIPE]: 'Starts the next stage in the PPL pipeline.',
  [TokenType.ASSIGN]: 'Assigns a value or compares values in a condition.',
  [TokenType.EQUALS]: 'Tests two values for equality.',
  [TokenType.NOT_EQUALS]: 'Tests two values for inequality.',
  [TokenType.LT]: 'Tests whether the left value is less than the right value.',
  [TokenType.LTE]: 'Tests whether the left value is less than or equal to the right value.',
  [TokenType.GT]: 'Tests whether the left value is greater than the right value.',
  [TokenType.GTE]: 'Tests whether the left value is greater than or equal to the right value.',
  [TokenType.PLUS]: 'Adds values or marks ascending sort order.',
  [TokenType.MINUS]: 'Subtracts values or marks descending sort order.',
  [TokenType.STAR]: 'Matches all fields or multiplies values, depending on context.',
  [TokenType.SLASH]: 'Divides the left value by the right value.',
  [TokenType.PERCENT]: 'Returns the remainder after division.',
  [TokenType.COMMA]: 'Separates values or arguments.',
  [TokenType.LPAREN]: 'Starts a function argument list or grouped expression.',
  [TokenType.RPAREN]: 'Ends a function argument list or grouped expression.',
  [TokenType.LBRACKET]: 'Starts a bracketed join subquery.',
  [TokenType.RBRACKET]: 'Ends a bracketed join subquery.',
};

function sourceAt(query: string, token: Token, templates: readonly IndexTemplate[], includedIndexes: readonly string[]): string | undefined {
  const ast = parsePpl(query);
  const source = ast.source.type === 'SourceStage' &&
    sourceToken(query, token, ast.source.span.start.offset, ast.source.span.end.offset)
    ? ast.source.indexName : undefined;
  const lookup = ast.stages.find((stage) => stage.type === 'LookupStage' &&
    (stage as LookupStageNode).index.span.start.offset === token.span.start.offset) as LookupStageNode | undefined;
  const join = ast.stages.find((stage) => stage.type === 'JoinStage' &&
    (stage as JoinStageNode).dataset?.span.start.offset === token.span.start.offset) as JoinStageNode | undefined;
  const name = source ?? lookup?.index.name ??
    (join?.dataset?.type === 'Identifier' ? join.dataset.name : undefined);
  if (!name) return undefined;
  const fields = resolveSource(templates, name, includedIndexes);
  const summary = `**Index:** \`${name}\`\n\n${fields.size ? `${fields.size} mapped fields available.` : 'No matching mapped fields are available in the configured index catalog.'}`;
  if (!lookup || fields.size === 0) return summary;
  const fieldList = [...fields].sort(([left], [right]) => left.localeCompare(right))
    .map(([fieldName, field]) => `- \`${fieldName}\`: \`${(field.pplTypes?.length ? field.pplTypes : field.types).join(' | ') || 'Unknown'}\``);
  return `${summary}\n\n**Available fields:**\n\n${fieldList.join('\n')}`;
}

function sourceToken(query: string, token: Token, start: number, end: number): boolean {
  return token.span.start.offset >= start && token.span.end.offset <= end &&
    /(?:source|search)\s*(?:source\s*)?=?\s*$/i.test(query.slice(start, token.span.start.offset));
}

function lookupFieldAt(
  query: string, token: Token, templates: readonly IndexTemplate[], includedIndexes: readonly string[]
): QueryHoverInfo | undefined {
  const ast = parsePpl(query);
  const lookup = ast.stages.find((stage) => stage.type === 'LookupStage' &&
    stage.span.start.offset <= token.span.start.offset && token.span.end.offset <= stage.span.end.offset) as LookupStageNode | undefined;
  if (!lookup || ![...lookup.mappings.map((mapping) => mapping.lookup), ...lookup.outputs.map((output) => output.input)]
    .some((field) => field.span.start.offset === token.span.start.offset)) return undefined;
  const field = resolveSource(templates, lookup.index.name, includedIndexes).get(token.value);
  if (!field) return undefined;
  const types = field.pplTypes?.length ? field.pplTypes.join(' | ') : 'Unknown';
  return { markdown: `**Field:** \`${token.value}\`\n\n**PPL type:** \`${types}\`\n\n**Template:** ${field.templates.join(', ')}`,
    span: { start: token.span.start.offset, end: token.span.end.offset } };
}

function joinFieldAt(
  query: string, token: Token, templates: readonly IndexTemplate[], includedIndexes: readonly string[]
): QueryHoverInfo | undefined {
  const ast = parsePpl(query);
  const join = ast.stages.find((stage) => stage.type === 'JoinStage' &&
    stage.span.start.offset <= token.span.start.offset && token.span.end.offset <= stage.span.end.offset) as JoinStageNode | undefined;
  if (!join || !join.criteria || token.span.start.offset < join.criteria.span.start.offset ||
      token.span.end.offset > join.criteria.span.end.offset) return undefined;
  const source = ast.source.type === 'SourceStage' ? ast.source.indexName : undefined;
  if (!source) return undefined;
  const resolveFields = (name: string) => resolveSource(templates, name, includedIndexes);
  const left = fieldsAt(query, resolveFields(source), join.span.start.offset, resolveFields);
  const right = joinDatasetFields(query, join.dataset, resolveFields);
  const [alias, ...parts] = token.value.split('.');
  const rightAlias = join.options.right ?? join.datasetAlias?.name ??
    (join.dataset?.type === 'Identifier' ? join.dataset.name : undefined);
  const field = parts.length && alias === join.options.left ? left.get(parts.join('.'))
    : parts.length && alias === rightAlias ? right.get(parts.join('.'))
      : left.get(token.value) ?? right.get(token.value);
  if (!field?.pplTypes?.length) return undefined;
  return { markdown: `**Field:** \`${token.value}\`\n\n**PPL type:** ${field.pplTypes.map((type) => `\`${type}\``).join(' | ')}\n\n**Template:** ${field.templates.join(', ')}`,
    span: { start: token.span.start.offset, end: token.span.end.offset } };
}

export function queryHoverAt(
  query: string, offset: number, templates: readonly IndexTemplate[], includedIndexes: readonly string[] = []
): QueryHoverInfo | undefined {
  const tokens = tokenize(query);
  const index = tokens.findIndex((token) => token.span.start.offset <= offset && offset < token.span.end.offset);
  if (index < 0) return undefined;
  const token = tokens[index];
  const span = { start: token.span.start.offset, end: token.span.end.offset };
  const indexInfo = sourceAt(query, token, templates, includedIndexes);
  if (indexInfo) return { markdown: indexInfo, span };
  const inputTypes: Partial<Record<TokenType, string>> = {
    [TokenType.STRING_LITERAL]: 'String',
    [TokenType.NUMBER_LITERAL]: /^[0-9]+$/.test(token.value) ? 'Integer' : 'Double',
    [TokenType.BOOLEAN_LITERAL]: 'Boolean',
    [TokenType.NULL_LITERAL]: 'Null',
  };
  const inputType = inputTypes[token.type];
  if (inputType) return { markdown: `**Type:** User input value of type \`${inputType}\`.`, span };

  const functionInfo = functionInfoAt(query, offset);
  if (functionInfo) return { markdown: renderFunctionDocumentation(functionInfo.documentation), span };

  const command = COMMAND_DOCS[token.value.toLowerCase()];
  const ast = parsePpl(query);
  const bareAggregation = ast.stages.some((stage) => stage.type === 'StatsStage' &&
    (stage as StatsStageNode).aggregations.some((aggregation) =>
      aggregation.span.start.offset === token.span.start.offset && aggregation.functionName.toLowerCase() === token.value.toLowerCase()));
  if (bareAggregation) {
    const documentation = functionDocumentation(token.value);
    if (documentation) return { markdown: renderFunctionDocumentation(documentation), span };
  }
  const isCommand = ast.source.type === 'SourceStage' && ast.source.span.start.offset === token.span.start.offset ||
    ast.stages.some((stage) => stage.span.start.offset === token.span.start.offset);
  if (isCommand && command) return {
    markdown: `### PPL Command: \`${command.name}\`\n\n\`\`\`ppl\n${command.syntax}\n\`\`\`\n\n${command.description}\n\n**Example:** \`${command.example}\`\n\n[OpenSearch PPL Documentation](${command.docUrl})`, span,
  };
  if (isCommand && DEFAULT_KNOWN_COMMANDS.includes(token.value.toLowerCase())) return {
    markdown: `**PPL command:** \`${token.value}\`\n\nProcesses the current pipeline results.`, span,
  };

  const lookupField = lookupFieldAt(query, token, templates, includedIndexes);
  if (lookupField) return lookupField;
  const joinField = joinFieldAt(query, token, templates, includedIndexes);
  if (joinField) return joinField;

  if (token.type === TokenType.BY && ast.stages.some((stage) => stage.type === 'WhereStage' &&
      stage.span.start.offset < token.span.start.offset && stage.span.end.offset >= token.span.end.offset)) {
    const source = ast.source.type === 'SourceStage' ? ast.source.indexName : undefined;
    const field = source ? resolveSource(templates, source, includedIndexes).get(token.value) : undefined;
    return { markdown: `**Field:** \`${token.value}\`\n\n**PPL type:** ${field?.pplTypes?.length
      ? field.pplTypes.map((type) => `\`${type}\``).join(' | ')
      : 'Unknown. No matching field type could be verified.'}`, span };
  }

  const keyword = KEYWORDS[token.value.toLowerCase()];
  const joinPrefix = isCommand && ast.stages.some((stage) => stage.type === 'JoinStage' &&
    stage.span.start.offset === token.span.start.offset);
  if (keyword && (joinPrefix || token.type !== TokenType.IDENTIFIER ||
    tokens[index + 1]?.type === TokenType.ASSIGN || ['replace', 'append', 'output', 'on'].includes(token.value.toLowerCase()))) {
    return { markdown: `**PPL keyword:** \`${token.value.toUpperCase()}\`\n\n${keyword}`, span };
  }
  const operator = OPERATORS[token.type];
  if (operator) return { markdown: `**PPL operator:** \`${token.value}\`\n\n${operator}`, span };
  if (token.type !== TokenType.IDENTIFIER) return undefined;
  const field = fieldInfoAt(query, offset, templates, includedIndexes);
  if (field) return {
    markdown: `**Field:** \`${field.name}\`\n\n**PPL type:** ${field.types.map((type) => `\`${type}\``).join(' | ')}\n\n${field.templates.length ? `**Template:** ${field.templates.join(', ')}` : '**Origin:** Computed by PPL pipeline'}`,
    span,
  };
  if (tokens[index + 1]?.type === TokenType.LPAREN) return undefined;
  const source = ast.source.type === 'SourceStage' ? ast.source.indexName : undefined;
  const scoped = source ? fieldsAt(query, resolveSource(templates, source, includedIndexes), offset,
    (name) => resolveSource(templates, name, includedIndexes)).get(token.value) : undefined;
  if (scoped?.pplTypes?.length) return {
    markdown: `**Field:** \`${token.value}\`\n\n**PPL type:** ${scoped.pplTypes.map((type) => `\`${type}\``).join(' | ')}\n\n**Template:** ${scoped.templates.join(', ')}`,
    span,
  };
  return { markdown: `**Field:** \`${token.value}\`\n\n**PPL type:** Unknown. No matching field type could be verified.`, span };
}
