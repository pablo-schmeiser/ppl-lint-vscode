import { fieldsAt, fieldsBeforeStageAt, joinDatasetFields } from './fieldScope';
import { AGGREGATION_FUNCTIONS, DEFAULT_KNOWN_FUNCTIONS } from './catalog/functions';
import { COMMAND_DOCS, DEFAULT_KNOWN_COMMANDS } from './catalog/commands';
import { functionDocumentation, renderFunctionDocumentation } from './catalog/functionDocumentation';
import { argumentConstraint, FunctionSignature, FUNCTION_SIGNATURES, getFunctionSignature, TypeConstraint } from './catalog/functionSignatures';
import { IndexTemplate, KnownField, isSourceIncluded, resolveSource } from './indexTemplates';
import { parsePpl } from './parser/parser';
import { tokenize } from './lexer/tokenizer';
import { PPL_TYPES, PplType } from './pplTypes';
import { JoinStageNode, Token, TokenType } from '../types';

export interface Candidate {
  label: string;
  detail: string;
  kind: 'field' | 'function' | 'source' | 'type' | 'constant' | 'command' | 'keyword' | 'operator';
  documentation?: string;
  insertText?: string;
  retriggerAfterAccept?: boolean;
}

interface CallFrame {
  name?: string;
  argumentIndex: number;
}

interface CursorContext {
  command: string;
  prefix: string;
  sourceCompletion: boolean;
  commandCompletion: boolean;
  fieldOnly: boolean;
  expression: boolean;
  whereContinuation?: boolean;
  call?: CallFrame;
  castType: boolean;
}

const NUMERIC_TYPES = new Set<PplType>(['tinyint', 'smallint', 'int', 'bigint', 'float', 'double']);
const TEMPORAL_TYPES = new Set<PplType>(['date', 'time', 'timestamp']);
const TIMESTAMP_UNITS = ['MICROSECOND', 'SECOND', 'MINUTE', 'HOUR', 'DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'];
const COMPARISON_OPERATORS = new Set<TokenType>([
  TokenType.ASSIGN, TokenType.EQUALS, TokenType.NOT_EQUALS, TokenType.LT,
  TokenType.LTE, TokenType.GT, TokenType.GTE, TokenType.IN, TokenType.LIKE,
]);
const COMPLETED_EXPRESSION_ENDS = new Set<TokenType>([
  TokenType.IDENTIFIER, TokenType.STRING_LITERAL, TokenType.NUMBER_LITERAL,
  TokenType.BOOLEAN_LITERAL, TokenType.NULL_LITERAL, TokenType.RPAREN, TokenType.RBRACKET,
]);
const LOGICAL_OPERATORS = new Set<TokenType>([TokenType.AND, TokenType.OR]);

function cursorIsInStringOrComment(text: string): boolean {
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      else if (char === '\n') quote = '';
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index++;
    } else if (char === '/' && next === '*') {
      blockComment = true;
      index++;
    } else if (char === '\'' || char === '"') quote = char;
  }
  return Boolean(quote || lineComment || blockComment);
}

function isWordToken(token: Token): boolean {
  return ![
    TokenType.PIPE, TokenType.ASSIGN, TokenType.EQUALS, TokenType.NOT_EQUALS,
    TokenType.LT, TokenType.LTE, TokenType.GT, TokenType.GTE, TokenType.PLUS,
    TokenType.MINUS, TokenType.STAR, TokenType.SLASH, TokenType.PERCENT,
    TokenType.ARROW, TokenType.CARET,
    TokenType.COMMA, TokenType.LPAREN, TokenType.RPAREN, TokenType.LBRACKET,
    TokenType.RBRACKET, TokenType.STRING_LITERAL, TokenType.NUMBER_LITERAL,
    TokenType.BOOLEAN_LITERAL, TokenType.NULL_LITERAL, TokenType.EOF,
  ].includes(token.type);
}

function activeCommandTokens(tokens: Token[]): Token[] {
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let start = 0;
  for (let index = 0; index < tokens.length; index++) {
    const type = tokens[index].type;
    if (type === TokenType.LPAREN) parenthesisDepth++;
    else if (type === TokenType.RPAREN) parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    else if (type === TokenType.LBRACKET) bracketDepth++;
    else if (type === TokenType.RBRACKET) bracketDepth = Math.max(0, bracketDepth - 1);
    else if (type === TokenType.PIPE && parenthesisDepth === 0 && bracketDepth === 0) start = index + 1;
  }
  return tokens.slice(start);
}

function lastTokenIndex(tokens: Token[], type: TokenType): number {
  for (let index = tokens.length - 1; index >= 0; index--) {
    if (tokens[index].type === type) return index;
  }
  return -1;
}

function hasWhereContinuation(segment: Token[]): boolean {
  if (segment[0]?.type !== TokenType.WHERE) return false;
  let lastLogicalOperator = -1;
  for (let index = 1; index < segment.length; index++) {
    if (LOGICAL_OPERATORS.has(segment[index].type)) lastLogicalOperator = index;
  }
  const condition = segment.slice(lastLogicalOperator + 1);
  const last = condition.at(-1);
  if (!last || !COMPLETED_EXPRESSION_ENDS.has(last.type)) return false;
  if (condition.slice(0, -1).some((token) => COMPARISON_OPERATORS.has(token.type))) return true;
  if (last.type !== TokenType.RPAREN) return false;
  let depth = 0;
  for (let index = condition.length - 1; index >= 0; index--) {
    if (condition[index].type === TokenType.RPAREN) depth++;
    if (condition[index].type === TokenType.LPAREN) {
      depth--;
      if (depth === 0) {
        const name = condition[index - 1];
        return Boolean(name && isWordToken(name) && getFunctionSignature(name.value, 'where')?.returnType === 'boolean');
      }
    }
  }
  return false;
}

function cursorContext(query: string, offset: number): CursorContext | undefined {
  const before = query.slice(0, offset);
  if (cursorIsInStringOrComment(before)) return undefined;
  let wordStart = before.length;
  while (wordStart > 0 && /[A-Za-z0-9_@.*-]/.test(before[wordStart - 1])) wordStart--;
  const prefix = before.slice(wordStart);
  const codeBeforePrefix = before.slice(0, wordStart);
  const tokens = tokenize(codeBeforePrefix).filter((token) => token.type !== TokenType.EOF);
  const sourceMatch = /^\s*(?:source\s*=\s*|search(?:\s+source\s*=\s*|\s*=\s*|\s+))[^|]*$/i.test(codeBeforePrefix);
  if (sourceMatch) {
    return { command: 'source', prefix, sourceCompletion: true, commandCompletion: false, fieldOnly: false, expression: false, castType: false };
  }

  const segment = activeCommandTokens(tokens);
  if (segment.length === 0 && tokens.at(-1)?.type === TokenType.PIPE) {
    return { command: '', prefix, sourceCompletion: false, commandCompletion: true, fieldOnly: false, expression: false, castType: false };
  }
  const command = segment[0]?.value.toLowerCase() || '';
  const stack: CallFrame[] = [];
  for (let index = 0; index < segment.length; index++) {
    const token = segment[index];
    if (token.type === TokenType.LPAREN) {
      const previous = segment[index - 1];
      const name = previous && isWordToken(previous) ? previous.value.toLowerCase() : undefined;
      stack.push({ name, argumentIndex: 0 });
    } else if (token.type === TokenType.RPAREN) {
      stack.pop();
    } else if (token.type === TokenType.COMMA && stack.length > 0) {
      stack[stack.length - 1].argumentIndex++;
    }
  }
  const call = [...stack].reverse().find((frame) => frame.name);
  const castType = call?.name === 'cast' && segment.at(-1)?.type === TokenType.AS;
  const afterLastAssign = lastTokenIndex(segment, TokenType.ASSIGN);
  const afterLastComma = lastTokenIndex(segment, TokenType.COMMA);
  const evalExpression = command === 'eval' && afterLastAssign > afterLastComma;
  const expression = ['where', 'stats', 'eventstats', 'streamstats', 'timechart'].includes(command) || evalExpression || Boolean(call);
  const singleFieldCommand = ['grok', 'patterns', 'parse', 'regex', 'bin'].includes(command) && segment.length === 1;
  const rexField = command === 'rex' && segment.at(-1)?.type === TokenType.ASSIGN &&
    segment.at(-2)?.value.toLowerCase() === 'field';
  const joinCommand = command === 'join' ||
    (['inner', 'left', 'right', 'full', 'cross'].includes(command) &&
      segment.some((token) => token.value.toLowerCase() === 'join'));
  const fieldOnly = ['fields', 'table', 'sort', 'dedup', 'top', 'rare', 'rename'].includes(command) ||
    singleFieldCommand || rexField || command === 'lookup' || joinCommand;
  if (!expression && !fieldOnly) return undefined;
  if (command === 'eval' && !evalExpression && !call) return undefined;
  if (command === 'rename' && segment.some((token) => token.type === TokenType.AS)) return undefined;
  return {
    command,
    prefix,
    sourceCompletion: false,
    commandCompletion: false,
    fieldOnly,
    expression,
    whereContinuation: hasWhereContinuation(segment),
    call,
    castType,
  };
}

function constraintAccepts(constraint: TypeConstraint | undefined, type: PplType): boolean {
  if (!constraint || constraint === 'any') return true;
  if (constraint === 'integer') return ['tinyint', 'smallint', 'int', 'bigint'].includes(type);
  if (constraint === 'numericOrString') return NUMERIC_TYPES.has(type) || type === 'string';
  if (constraint === 'strftimeInput') return NUMERIC_TYPES.has(type) || type === 'date' || type === 'timestamp';
  if (constraint === 'temporalOrNumeric') return NUMERIC_TYPES.has(type) || TEMPORAL_TYPES.has(type) || type === 'string';
  if (constraint === 'numeric') return NUMERIC_TYPES.has(type) || type === 'string';
  if (constraint === 'temporal') return TEMPORAL_TYPES.has(type) || type === 'string';
  if (constraint === 'stringLike') return type === 'string' || type === 'ip';
  if (constraint === 'array') return type === 'array';
  return type === constraint;
}

function functionReturnsConstraint(signature: FunctionSignature, constraint?: TypeConstraint): boolean {
  if (!constraint || constraint === 'any') return true;
  if (['integer', 'numericOrString', 'strftimeInput', 'temporalOrNumeric'].includes(constraint)) {
    if (constraintAccepts(constraint, signature.returnType as PplType)) return true;
    if (signature.returnType === 'widerNumeric') return constraint !== 'integer' || signature.arguments.every((argument) => argument === 'integer');
    return ['sameAsFirst', 'common', 'selectedValue', 'reduce', 'unknown'].includes(signature.returnType);
  }
  if (signature.returnType === 'if' || signature.returnType === 'case') return true;
  if (signature.returnType === 'fromUnixTime') return ['temporal', 'stringLike', 'string'].includes(constraint);
  if (signature.returnType === 'addDate') return constraint === 'temporal';
  if (constraint === 'numeric') {
    return signature.returnType === 'widerNumeric' ||
      (typeof signature.returnType === 'string' && NUMERIC_TYPES.has(signature.returnType as PplType)) ||
      (signature.returnType === 'sameAsFirst' && signature.arguments[0] === 'numeric');
  }
  if (constraint === 'temporal') {
    return (typeof signature.returnType === 'string' && TEMPORAL_TYPES.has(signature.returnType as PplType)) ||
      (signature.returnType === 'sameAsFirst' && signature.arguments[0] === 'temporal');
  }
  if (constraint === 'stringLike') return signature.returnType === 'string' || signature.returnType === 'ip';
  return signature.returnType === constraint || signature.returnType === 'sameAsFirst' || signature.returnType === 'common';
}

function signatureDetail(signature?: FunctionSignature): string {
  if (!signature) return 'PPL function';
  return `${signature.returnType} · ${signature.minArgs}${signature.maxArgs === signature.minArgs ? '' : `–${signature.maxArgs ?? '…'}`} argument(s)`;
}

function sourceName(query: string): string | undefined {
  const ast = parsePpl(query);
  return ast.source.type === 'SourceStage' ? ast.source.indexName : undefined;
}

function fieldCandidates(
  query: string,
  offset: number,
  prefix: string,
  templates: readonly IndexTemplate[],
  constraint?: TypeConstraint,
  includedIndexes: readonly string[] = []
): Candidate[] {
  if (templates.length === 0) return [];
  const source = sourceName(query);
  if (!source) return [];
  const sourceFields = resolveSource(templates, source, includedIndexes);
  const command = cursorContext(query, offset)?.command || '';
  const projectionContext = ['fields', 'table'].includes(command);
  const inputContext = projectionContext || ['stats', 'eventstats', 'streamstats'].includes(command);
  const lookupFields = (name: string): Map<string, KnownField> => resolveSource(templates, name, includedIndexes);
  const fields = inputContext
    ? fieldsBeforeStageAt(query, sourceFields, offset, ['fields', 'table', 'stats', 'eventstats', 'streamstats'], lookupFields)
    : fieldsAt(query, sourceFields, offset, lookupFields);
  const prefixStart = offset - prefix.length;
  const selected = projectionContext
    ? new Set(activeCommandTokens(tokenize(query.slice(0, offset)).filter((token) => token.type !== TokenType.EOF))
      .slice(1)
      .filter((token) => token.type === TokenType.IDENTIFIER && token.span.end.offset <= prefixStart)
      .map((token) => token.value))
    : new Set<string>();
  return mappedFieldCandidates(fields, prefix, constraint, selected);
}

function mappedFieldCandidates(
  fields: Map<string, KnownField>,
  prefix: string,
  constraint?: TypeConstraint,
  selected: ReadonlySet<string> = new Set()
): Candidate[] {
  return [...fields].flatMap(([label, field]) => {
    if (!label.toLowerCase().startsWith(prefix.toLowerCase())) return [];
    if (selected.has(label)) return [];
    const types = field.pplTypes ?? [];
    if (constraint && types.length > 0 && !types.some((type) => constraintAccepts(constraint, type))) return [];
    if (constraint && types.length === 0 && constraint !== 'any') return [];
    const hasRiskyStringConversion = types.includes('string') &&
      (constraint === 'numeric' || constraint === 'temporal');
    return [{
      label,
      kind: 'field' as const,
      detail: types.length
        ? `${types.join(' | ')} (${field.templates.join(', ')})${hasRiskyStringConversion ? ' · implicit conversion may fail' : ''}`
        : 'Computed field · unknown type',
      insertText: label,
    }];
  });
}

function functionCandidates(prefix: string, command: string, constraint?: TypeConstraint, insideCall = false): Candidate[] {
  const aggregateOnly = ['stats', 'eventstats', 'streamstats', 'timechart'].includes(command);
  const names = [...new Set(DEFAULT_KNOWN_FUNCTIONS)];
  return names.flatMap((name) => {
    if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return [];
    const isAggregate = AGGREGATION_FUNCTIONS.includes(name as (typeof AGGREGATION_FUNCTIONS)[number]);
    if (aggregateOnly && (insideCall ? isAggregate : !isAggregate)) return [];
    const signature = getFunctionSignature(name, command || undefined);
    if (FUNCTION_SIGNATURES.has(name.toLowerCase()) && !signature) return [];
    if (constraint && (!signature || !functionReturnsConstraint(signature, constraint))) return [];
    const documentation = functionDocumentation(name);
    return [{
      label: name,
      kind: 'function' as const,
      detail: documentation?.syntax[0] ?? signatureDetail(signature),
      documentation: documentation ? renderFunctionDocumentation(documentation) : undefined,
      insertText: `${name}(`,
      retriggerAfterAccept: true,
    }];
  });
}

function cursorSourceCandidates(
  prefix: string,
  templates: readonly IndexTemplate[],
  includedIndexes: readonly string[]
): Candidate[] {
  return [...new Set([
    ...templates.flatMap((template) => [...template.aliases, ...template.patterns]),
    ...includedIndexes,
  ])]
    .filter((name) => isSourceIncluded(name, includedIndexes))
    .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((label) => ({ label, kind: 'source' as const, detail: 'OpenSearch source', insertText: label }));
}

function commandCandidates(prefix: string): Candidate[] {
  return DEFAULT_KNOWN_COMMANDS
    .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((label) => ({
      label,
      kind: 'command' as const,
      detail: COMMAND_DOCS[label]?.syntax || 'PPL pipeline command',
      insertText: `${label} `,
      retriggerAfterAccept: true,
    }));
}

function whereContinuationCandidates(prefix: string): Candidate[] {
  const candidates: Candidate[] = [
    { label: 'AND', kind: 'keyword', detail: 'Logical AND operator', insertText: 'AND ', retriggerAfterAccept: true },
    { label: 'OR', kind: 'keyword', detail: 'Logical OR operator', insertText: 'OR ', retriggerAfterAccept: true },
    { label: '|', kind: 'operator', detail: 'Start a new pipeline stage', insertText: '| ', retriggerAfterAccept: true },
  ];
  return candidates.filter((candidate) => candidate.label.toLowerCase().startsWith(prefix.toLowerCase()));
}

function keywordCandidates(prefix: string, labels: readonly string[]): Candidate[] {
  return labels.filter((label) => label.toLowerCase().startsWith(prefix.toLowerCase()))
    .map((label) => ({ label, kind: 'keyword' as const, detail: 'PPL keyword',
      insertText: `${label} `, retriggerAfterAccept: true }));
}

function functionArgumentConstraint(frame: CallFrame | undefined, command: string): TypeConstraint | undefined {
  if (!frame?.name) return undefined;
  const signature = getFunctionSignature(frame.name, command || undefined);
  return signature && argumentConstraint(signature, frame.argumentIndex);
}

function joinSubqueryStart(query: string, offset: number): number | undefined {
  if (query.lastIndexOf('[', offset - 1) < 0) return undefined;
  const tokens = tokenize(query.slice(0, offset)).filter((token) => token.type !== TokenType.EOF);
  const brackets: number[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index].type === TokenType.LBRACKET) brackets.push(index);
    if (tokens[index].type === TokenType.RBRACKET) brackets.pop();
  }
  const open = brackets.at(-1);
  if (open === undefined) return undefined;
  const stage = activeCommandTokens(tokens.slice(0, open));
  if (!stage.some((token) => token.value.toLowerCase() === 'join')) return undefined;
  const inner = query.slice(tokens[open].span.end.offset, offset).trimStart();
  return !inner || /^(source|search)\b/i.test(inner) ? tokens[open].span.end.offset : undefined;
}

function joinCandidates(
  query: string,
  offset: number,
  prefix: string,
  templates: readonly IndexTemplate[],
  includedIndexes: readonly string[],
  call?: CallFrame
): Candidate[] {
  const segment = activeCommandTokens(tokenize(query.slice(0, offset - prefix.length))
    .filter((token) => token.type !== TokenType.EOF));
  const joinIndex = segment.findIndex((token) => token.value.toLowerCase() === 'join');
  if (joinIndex < 0) return [];
  const operands = segment.slice(joinIndex + 1);
  const aliases: Record<string, string> = {};
  let index = 0;
  while (['left', 'right', 'type', 'overwrite', 'max'].includes(operands[index]?.value.toLowerCase()) &&
         operands[index + 1]?.type === TokenType.ASSIGN) {
    if (!operands[index + 2]) {
      const option = operands[index].value.toLowerCase();
      return keywordCandidates(prefix, option === 'type'
        ? ['inner', 'left', 'right', 'full', 'outer', 'cross', 'semi', 'anti']
        : option === 'overwrite' ? ['true', 'false'] : []);
    }
    aliases[operands[index].value.toLowerCase()] = operands[index + 2].value;
    index += 3;
  }
  const remaining = operands.slice(index);
  if (remaining.at(-1)?.type === TokenType.AS) return [];
  const criteria = ['on', 'where'].includes(remaining[0]?.value.toLowerCase());
  if (criteria) {
    const ast = parsePpl(query);
    const stage = [...ast.stages].reverse().find((item) => item.type === 'JoinStage' && item.span.start.offset <= offset);
    const dataset = (stage as JoinStageNode | undefined)?.dataset;
    if (dataset && offset > dataset.span.end.offset) {
      return /\bas\b/i.test(query.slice(dataset.span.end.offset, offset))
        ? [] : keywordCandidates(prefix, ['as']);
    }
    const last = remaining.at(-1);
    if (last && COMPLETED_EXPRESSION_ENDS.has(last.type) &&
        remaining.slice(1, -1).some((token) => COMPARISON_OPERATORS.has(token.type))) {
      return [...keywordCandidates(prefix, ['AND', 'OR']), ...cursorSourceCandidates(prefix, templates, includedIndexes)];
    }
    const constraint = functionArgumentConstraint(call, 'where');
    const left = fieldCandidates(query, offset, '', templates, constraint, includedIndexes)
      .map((candidate) => ({ ...candidate, label: aliases.left ? `${aliases.left}.${candidate.label}` : candidate.label,
        insertText: aliases.left ? `${aliases.left}.${candidate.label}` : candidate.label }));
    const rightFields = joinDatasetFields(query, dataset, (name) => resolveSource(templates, name, includedIndexes));
    const rightAlias = aliases.right || (stage as JoinStageNode | undefined)?.datasetAlias?.name;
    const right = mappedFieldCandidates(new Map([...rightFields]
      .map(([name, field]) => [rightAlias ? `${rightAlias}.${name}` : name, field])), prefix, constraint);
    const functions = functionCandidates(prefix, 'where', constraint)
      .filter((candidate) => !AGGREGATION_FUNCTIONS.includes(candidate.label));
    return [...functions, ...left.filter((candidate) => candidate.label.toLowerCase().startsWith(prefix.toLowerCase())), ...right];
  }
  if (remaining.length === 0 || remaining.at(-1)?.type === TokenType.COMMA) {
    const fields = fieldCandidates(query, offset, prefix, templates, undefined, includedIndexes);
    if (remaining.length > 0) return fields;
    const options = ['type', 'overwrite', 'max', 'left', 'right']
      .filter((name) => !(name in aliases) && name.startsWith(prefix.toLowerCase()))
      .map((label) => ({ label, kind: 'keyword' as const, detail: 'Join option',
        insertText: `${label}=`, retriggerAfterAccept: true }));
    return [...fields, ...options, ...keywordCandidates(prefix, ['on', 'where'])];
  }
  if (remaining.some((token) => token.type === TokenType.LBRACKET)) return [];
  const last = remaining.at(-1);
  if (last?.type === TokenType.IDENTIFIER &&
      (remaining.length === 1 || remaining.at(-2)?.type === TokenType.COMMA)) {
    return cursorSourceCandidates(prefix, templates, includedIndexes);
  }
  return [];
}

export function completionCandidates(
  query: string,
  offset: number,
  templates: readonly IndexTemplate[],
  includedIndexes: readonly string[] = []
): Candidate[] {
  const subqueryStart = joinSubqueryStart(query, offset);
  if (subqueryStart !== undefined) {
    return completionCandidates(query.slice(subqueryStart, offset), offset - subqueryStart, templates, includedIndexes);
  }
  const context = cursorContext(query, offset);
  if (!context) return [];
  if (context.sourceCompletion) return cursorSourceCandidates(context.prefix, templates, includedIndexes);
  if (context.commandCompletion) return commandCandidates(context.prefix);
  if (context.castType) {
    return [...PPL_TYPES]
      .filter((type) => type.startsWith(context.prefix.toLowerCase()))
      .map((label) => ({ label, kind: 'type' as const, detail: 'PPL data type', insertText: label }));
  }

  if (context.command === 'join' || ['inner', 'left', 'right', 'full', 'cross'].includes(context.command)) {
    return joinCandidates(query, offset, context.prefix, templates, includedIndexes, context.call);
  }

  if (context.command === 'lookup') {
    const segment = activeCommandTokens(tokenize(query.slice(0, offset - context.prefix.length))
      .filter((token) => token.type !== TokenType.EOF));
    if (segment.length === 1) return cursorSourceCandidates(context.prefix, templates, includedIndexes);
    const modeIndex = segment.findIndex((token, index) => index > 1 &&
      ['replace', 'append', 'output'].includes(token.value.toLowerCase()));
    if (segment.at(-1)?.type === TokenType.AS) {
      return modeIndex < 0 || segment[modeIndex].value.toLowerCase() === 'append'
        ? fieldCandidates(query, offset, context.prefix, templates, undefined, includedIndexes)
        : [];
    }
    if (segment.length === 2 || segment.at(-1)?.type === TokenType.COMMA ||
        (modeIndex >= 0 && segment.length === modeIndex + 1)) {
      return mappedFieldCandidates(resolveSource(templates, segment[1].value, includedIndexes), context.prefix);
    }
    if (segment.at(-1)?.type === TokenType.IDENTIFIER) {
      return keywordCandidates(context.prefix, modeIndex >= 0
        ? ['as']
        : segment.at(-2)?.type === TokenType.AS
          ? ['replace', 'append', 'output']
          : ['as', 'replace', 'append', 'output']);
    }
    return [];
  }

  if (['fields', 'table'].includes(context.command) && context.fieldOnly) {
    return fieldCandidates(query, offset, context.prefix, templates, undefined, includedIndexes);
  }

  if (['stats', 'eventstats', 'streamstats', 'timechart'].includes(context.command)) {
    const segment = activeCommandTokens(tokenize(query.slice(0, offset - context.prefix.length))
      .filter((token) => token.type !== TokenType.EOF));
    const assign = lastTokenIndex(segment, TokenType.ASSIGN);
    const option = segment[assign - 1]?.value.toLowerCase();
    const options = context.command === 'timechart'
      ? ['timefield', 'span', 'limit', 'useother', 'usenull', 'nullstr']
      : context.command === 'streamstats'
        ? ['bucket_nullable', 'current', 'window', 'global', 'reset_before', 'reset_after']
        : ['bucket_nullable'];
    if (assign > 0 && segment.length === assign + 1 && options.includes(option)) {
      const fields = fieldCandidates(query, offset, context.prefix, templates, undefined, includedIndexes);
      if (option === 'timefield') return fields;
      if (option === 'reset_before' || option === 'reset_after') {
        return [...functionCandidates(context.prefix, 'where'), ...fields];
      }
      return [];
    }
    if (!context.call && segment.some((token) => token.type === TokenType.BY)) {
      const fields = fieldCandidates(query, offset, context.prefix, templates, undefined, includedIndexes);
      if (context.command === 'timechart') return fields;
      return [...fields, ...functionCandidates(context.prefix, context.command).filter((candidate) => candidate.label === 'span')];
    }
    if (!context.call) return functionCandidates(context.prefix, context.command);
  }

  const constraint = functionArgumentConstraint(context.call, context.command);
  if (context.call?.name && getFunctionSignature(context.call.name, context.command)?.constantArguments?.includes(context.call.argumentIndex)) {
    const signature = getFunctionSignature(context.call.name, context.command)!;
    const constants = signature.allowedValues?.[context.call.argumentIndex]?.map(String) ?? TIMESTAMP_UNITS;
    return constants.filter((value) => value.toLowerCase().startsWith(context.prefix.toLowerCase()))
      .map((label) => ({ label, kind: 'constant' as const, detail: 'Function constant', insertText: label }));
  }
  if (context.whereContinuation) return whereContinuationCandidates(context.prefix);

  const fields = context.expression || context.fieldOnly
    ? fieldCandidates(query, offset, context.prefix, templates, constraint, includedIndexes)
    : [];
  const functions = context.expression
    ? functionCandidates(context.prefix, context.command, constraint, Boolean(context.call))
    : [];
  const candidates = [...functions, ...fields];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.label.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
