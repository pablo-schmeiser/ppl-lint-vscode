import { fieldsAt, fieldsBeforeStageAt } from './fieldScope';
import { AGGREGATION_FUNCTIONS, DEFAULT_KNOWN_FUNCTIONS } from './catalog/functions';
import { COMMAND_DOCS, DEFAULT_KNOWN_COMMANDS } from './catalog/commands';
import { argumentConstraint, FunctionSignature, FUNCTION_SIGNATURES, getFunctionSignature, TypeConstraint } from './catalog/functionSignatures';
import { IndexTemplate, resolveSource } from './indexTemplates';
import { parsePpl } from './parser/parser';
import { tokenize } from './lexer/tokenizer';
import { PPL_TYPES, PplType } from './pplTypes';
import { Token, TokenType } from '../types';

export interface Candidate {
  label: string;
  detail: string;
  kind: 'field' | 'function' | 'source' | 'type' | 'constant' | 'command' | 'keyword' | 'operator';
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
  return Boolean(last && COMPLETED_EXPRESSION_ENDS.has(last.type) &&
    condition.slice(0, -1).some((token) => COMPARISON_OPERATORS.has(token.type)));
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
  const fieldOnly = ['fields', 'table', 'sort', 'dedup'].includes(command) || command === 'rename';
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
  if (constraint === 'numeric') return NUMERIC_TYPES.has(type) || type === 'string';
  if (constraint === 'temporal') return TEMPORAL_TYPES.has(type) || type === 'string';
  if (constraint === 'stringLike') return type === 'string' || type === 'ip';
  if (constraint === 'array') return type === 'array';
  return type === constraint;
}

function functionReturnsConstraint(signature: FunctionSignature, constraint?: TypeConstraint): boolean {
  if (!constraint || constraint === 'any') return true;
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
  constraint?: TypeConstraint
): Candidate[] {
  if (templates.length === 0) return [];
  const source = sourceName(query);
  if (!source) return [];
  const sourceFields = resolveSource(templates, source);
  const projectionContext = ['fields', 'table'].includes(cursorContext(query, offset)?.command || '');
  const fields = projectionContext
    ? fieldsBeforeStageAt(query, sourceFields, offset, ['fields', 'table'])
    : fieldsAt(query, sourceFields, offset);
  const prefixStart = offset - prefix.length;
  const selected = projectionContext
    ? new Set(activeCommandTokens(tokenize(query.slice(0, offset)).filter((token) => token.type !== TokenType.EOF))
      .slice(1)
      .filter((token) => token.type === TokenType.IDENTIFIER && token.span.end.offset <= prefixStart)
      .map((token) => token.value))
    : new Set<string>();
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

function functionCandidates(prefix: string, command: string, constraint?: TypeConstraint): Candidate[] {
  const aggregateOnly = ['stats', 'eventstats', 'streamstats', 'timechart'].includes(command);
  const names = [...new Set(DEFAULT_KNOWN_FUNCTIONS)];
  return names.flatMap((name) => {
    if (!name.toLowerCase().startsWith(prefix.toLowerCase())) return [];
    if (aggregateOnly && !AGGREGATION_FUNCTIONS.includes(name as (typeof AGGREGATION_FUNCTIONS)[number]) && name !== 'span') return [];
    const signature = getFunctionSignature(name, command || undefined);
    if (FUNCTION_SIGNATURES.has(name.toLowerCase()) && !signature) return [];
    if (constraint && (!signature || !functionReturnsConstraint(signature, constraint))) return [];
    return [{
      label: name,
      kind: 'function' as const,
      detail: signatureDetail(signature),
      insertText: `${name}(`,
      retriggerAfterAccept: true,
    }];
  });
}

function cursorSourceCandidates(prefix: string, templates: readonly IndexTemplate[]): Candidate[] {
  return [...new Set(templates.flatMap((template) => [...template.aliases, ...template.patterns]))]
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

function functionArgumentConstraint(frame: CallFrame | undefined, command: string): TypeConstraint | undefined {
  if (!frame?.name) return undefined;
  const signature = getFunctionSignature(frame.name, command || undefined);
  return signature && argumentConstraint(signature, frame.argumentIndex);
}

export function completionCandidates(query: string, offset: number, templates: readonly IndexTemplate[]): Candidate[] {
  const context = cursorContext(query, offset);
  if (!context) return [];
  if (context.sourceCompletion) return cursorSourceCandidates(context.prefix, templates);
  if (context.commandCompletion) return commandCandidates(context.prefix);
  if (context.castType) {
    return [...PPL_TYPES]
      .filter((type) => type.startsWith(context.prefix.toLowerCase()))
      .map((label) => ({ label, kind: 'type' as const, detail: 'PPL data type', insertText: label }));
  }

  if (['fields', 'table'].includes(context.command) && context.fieldOnly) {
    return fieldCandidates(query, offset, context.prefix, templates);
  }

  const constraint = functionArgumentConstraint(context.call, context.command);
  if (context.call?.name && getFunctionSignature(context.call.name, context.command)?.constantArguments?.includes(context.call.argumentIndex)) {
    return TIMESTAMP_UNITS.filter((unit) => unit.toLowerCase().startsWith(context.prefix.toLowerCase()))
      .map((label) => ({ label, kind: 'constant' as const, detail: 'Interval unit', insertText: label }));
  }
  if (context.whereContinuation) return whereContinuationCandidates(context.prefix);

  const fields = context.expression || context.fieldOnly
    ? fieldCandidates(query, offset, context.prefix, templates, constraint)
    : [];
  const functions = context.expression
    ? functionCandidates(context.prefix, context.command, constraint)
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