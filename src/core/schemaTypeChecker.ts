import {
  BinaryExpressionNode,
  CastExpressionNode,
  CoreDiagnostic,
  DedupStageNode,
  EvalStageNode,
  ExpressionNode,
  FieldsStageNode,
  FunctionCallNode,
  IdentifierNode,
  InExpressionNode,
  LiteralNode,
  LambdaExpressionNode,
  NamedArgumentNode,
  RelevanceFieldListNode,
  LookupStageNode,
  OptionStageNode,
  PatternStageNode,
  PipelineNode,
  RenameStageNode,
  SortStageNode,
  Span,
  StatsStageNode,
  UnaryExpressionNode,
  WhereStageNode,
} from '../types';
import {
  argumentConstraint,
  FunctionSignature,
  FUNCTION_SIGNATURES,
  getFunctionSignature,
  TypeConstraint,
} from './catalog/functionSignatures';
import { IndexTemplate, isSourceIncluded, KnownField, resolveSource } from './indexTemplates';
import { parsePpl } from './parser/parser';
import { normalizeOpenSearchTypes, normalizePplTypeName, PplType } from './pplTypes';

type ExpressionType = PplType | 'null' | 'unknown' | 'interval';

interface InferredExpression {
  type: ExpressionType;
  arrayElementType?: ExpressionType;
  isConstant: boolean;
  constantValue?: string | number | boolean | null;
}

const NUMERIC_TYPES = new Set<PplType>(['tinyint', 'smallint', 'int', 'bigint', 'float', 'double']);
const TEMPORAL_TYPES = new Set<PplType>(['date', 'time', 'timestamp']);
const SPAN_INTERVAL_PATTERN =
  /^\d+(?:\.\d+)?(?:ms|s|m|h|d|w|M|q|y|millisecond|second|minute|hour|day|week|month|quarter|year)s?$/;

function supportsCast(source: PplType, target: PplType): boolean {
  if (source === target || target === 'string') return true;
  if (source === 'string') {
    return NUMERIC_TYPES.has(target) || target === 'boolean' || TEMPORAL_TYPES.has(target) || target === 'ip';
  }
  if (NUMERIC_TYPES.has(source)) return NUMERIC_TYPES.has(target) || target === 'boolean';
  if (source === 'boolean') return NUMERIC_TYPES.has(target);
  if (source === 'timestamp') return target === 'date' || target === 'time';
  return false;
}

function fieldReferenceDiagnostics(identifier: IdentifierNode, fields: Map<string, KnownField>): {
  diagnostics: CoreDiagnostic[];
  type: ExpressionType;
} {
  if (identifier.name === '*') return { diagnostics: [], type: 'unknown' };
  const field = fields.get(identifier.name);
  const types = field ? mappedTypes(field) : [];
  if (field && types.length === 0 && field.types.length === 0) return { diagnostics: [], type: 'unknown' };
  if (!field || types.length === 0) {
    return {
      diagnostics: [{
        code: 'PPL012',
        message: field
          ? `Field '${identifier.name}' has no supported PPL type in the configured index templates.`
          : `Field '${identifier.name}' is not declared in the configured index templates.`,
        severity: 'error',
        span: identifier.span,
      }],
      type: 'unknown',
    };
  }
  if (types.length > 1) {
    return {
      diagnostics: [{
        code: 'PPL013',
        message: `Field '${identifier.name}' has conflicting PPL types (${types.join(', ')}) in templates: ${field.templates.join(', ')}.`,
        severity: 'error',
        span: identifier.span,
      }],
      type: 'unknown',
    };
  }
  return { diagnostics: [], type: types[0] };
}

function mappedTypes(field: KnownField): PplType[] {
  return field.pplTypes ?? normalizeOpenSearchTypes(field.types);
}

function mismatch(message: string, span: Span, diagnostics: CoreDiagnostic[]): void {
  diagnostics.push({ code: 'PPL014', message, severity: 'error', span });
}

function inferField(identifier: IdentifierNode, fields: Map<string, KnownField>, diagnostics: CoreDiagnostic[]): InferredExpression {
  if (identifier.name === '*') return { type: 'unknown', isConstant: false };
  const field = fields.get(identifier.name);
  const types = field ? mappedTypes(field) : [];
  if (field && types.length === 0 && field.types.length === 0) return { type: 'unknown', isConstant: false };
  if (!field || types.length === 0) {
    diagnostics.push({
      code: 'PPL012',
      message: field
        ? `Field '${identifier.name}' has no supported PPL type in the configured index templates.`
        : `Field '${identifier.name}' is not declared in the configured index templates.`,
      severity: 'error',
      span: identifier.span,
    });
    return { type: 'unknown', isConstant: false };
  }
  if (types.length > 1) {
    diagnostics.push({
      code: 'PPL013',
      message: `Field '${identifier.name}' has conflicting PPL types (${types.join(', ')}) in templates: ${field.templates.join(', ')}.`,
      severity: 'error',
      span: identifier.span,
    });
    return { type: 'unknown', isConstant: false };
  }
  return { type: types[0], arrayElementType: field?.arrayElementType, isConstant: false };
}

function isNumeric(
  type: ExpressionType
): type is Extract<PplType, 'tinyint' | 'smallint' | 'int' | 'bigint' | 'float' | 'double'> {
  return type !== 'null' && type !== 'unknown' && type !== 'interval' && NUMERIC_TYPES.has(type);
}

function widerNumeric(left: PplType, right: PplType): PplType {
  const rank: PplType[] = ['tinyint', 'smallint', 'int', 'bigint', 'float', 'double'];
  return rank[Math.max(rank.indexOf(left), rank.indexOf(right))];
}

function isNumericString(value: string | number | boolean | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value));
}

function coerceStringToNumber(
  value: InferredExpression,
  span: Span,
  diagnostics: CoreDiagnostic[]
): boolean {
  if (value.type !== 'string') return false;
  if (value.isConstant) {
    if (isNumericString(value.constantValue)) return true;
    mismatch('String literal cannot be converted to a number.', span, diagnostics);
    return true;
  }
  diagnostics.push({
    code: 'PPL015',
    message: 'PPL converts this string to a number at runtime; nonnumeric values may fail.',
    severity: 'warning',
    span,
  });
  return true;
}

function accepts(constraint: TypeConstraint, type: ExpressionType): boolean {
  if (type === 'unknown' || type === 'null' || constraint === 'any') return true;
  if (constraint === 'integer') return ['tinyint', 'smallint', 'int', 'bigint'].includes(type);
  if (constraint === 'numericOrString') return isNumeric(type) || type === 'string';
  if (constraint === 'strftimeInput') return isNumeric(type) || type === 'date' || type === 'timestamp';
  if (constraint === 'temporalOrNumeric') return isNumeric(type) || type === 'string' || TEMPORAL_TYPES.has(type as PplType);
  if (constraint === 'scalar') return type !== 'array' && type !== 'interval';
  if (constraint === 'interval') return type === 'interval';
  if (constraint === 'numericOrInterval') return isNumeric(type) || type === 'interval';
  if (constraint === 'numericOrTemporal') return isNumeric(type) || TEMPORAL_TYPES.has(type as PplType);
  if (constraint === 'numeric') return isNumeric(type);
  if (constraint === 'temporal') return (type !== 'interval' && TEMPORAL_TYPES.has(type)) || type === 'string';
  if (constraint === 'stringLike') return type === 'string' || type === 'ip';
  if (constraint === 'array') return type === 'array';
  return type === constraint;
}

function isBooleanLiteral(expression: ExpressionNode): boolean {
  return expression.type === 'Literal' && typeof (expression as LiteralNode).value === 'boolean';
}

function isIntegerLiteral(expression: ExpressionNode): boolean {
  return expression.type === 'Literal' && typeof (expression as LiteralNode).value === 'number' &&
    Number.isInteger((expression as LiteralNode).value);
}

function checkArguments(
  call: FunctionCallNode,
  signature: FunctionSignature,
  args: InferredExpression[],
  diagnostics: CoreDiagnostic[]
): InferredExpression[] {
  const checkedArgs = [...args];
  if (args.length < signature.minArgs || (signature.maxArgs !== undefined && args.length > signature.maxArgs)) {
    diagnostics.push({
      code: 'PPL014',
      message: `Function '${call.functionName}' expects ${signature.minArgs}${signature.maxArgs === signature.minArgs ? '' : ` to ${signature.maxArgs ?? 'many'}`} argument(s), got ${args.length}.`,
      severity: 'error',
      span: call.span,
    });
  }

  if (signature.special === 'case') {
    for (let index = 0; index < args.length; index += 2) {
      const isElseValue = index === args.length - 1 && args.length % 2 === 1;
      if (!isElseValue && args[index].type !== 'boolean' && args[index].type !== 'unknown') {
        mismatch(`Function 'case' condition ${Math.floor(index / 2) + 1} must be boolean, got '${args[index].type}'.`, call.arguments[index].span, diagnostics);
      }
    }
    return checkedArgs;
  }
  const pairs = signature.argumentPairs;
  if (pairs && (args.length - pairs.start) % 2 !== 0) {
    mismatch(`Function '${call.functionName}' requires complete key/path and value pairs.`, call.span, diagnostics);
  }
  args.forEach((argument, index) => {
    const constraint = pairs && index >= pairs.start
      ? (index - pairs.start) % 2 === 0 ? pairs.key : 'any'
      : argumentConstraint(signature, index);
    if (constraint === 'lambda') {
      if (call.arguments[index].type !== 'LambdaExpression') {
        mismatch(`Function '${call.functionName}' argument ${index + 1} requires a lambda expression.`, call.arguments[index].span, diagnostics);
      }
      return;
    }
    let argumentValid = true;
    if (constraint && !accepts(constraint, argument.type) && constraint === 'numeric' && argument.type === 'string') {
      if (signature.strictNumericArguments?.includes(index)) {
        mismatch(`Function '${call.functionName}' argument ${index + 1} requires numeric, got string.`, call.arguments[index].span, diagnostics);
        argumentValid = false;
      } else if (argument.isConstant && !isNumericString(argument.constantValue)) {
        mismatch(`String literal cannot be converted to a number for '${call.functionName}'.`, call.arguments[index].span, diagnostics);
        argumentValid = false;
      } else if (!argument.isConstant) {
        diagnostics.push({
          code: 'PPL015',
          message: `Function '${call.functionName}' converts a string argument to numeric at runtime; nonnumeric values may fail.`,
          severity: 'warning',
          span: call.arguments[index].span,
        });
        checkedArgs[index] = { ...argument, type: 'double' };
      } else {
        checkedArgs[index] = { ...argument, type: 'double' };
      }
    } else if (constraint && !accepts(constraint, argument.type)) {
      mismatch(`Function '${call.functionName}' argument ${index + 1} requires ${constraint}, got ${argument.type}.`, call.arguments[index].span, diagnostics);
      argumentValid = false;
    }

    const expression = call.arguments[index];
    const range = signature.integerRanges?.[index];
    if (argumentValid && range && argument.isConstant && argument.type !== 'null' &&
        (typeof argument.constantValue !== 'number' || !Number.isInteger(argument.constantValue) || argument.constantValue < range[0] || argument.constantValue > range[1])) {
      mismatch(`Function '${call.functionName}' argument ${index + 1} must be an integer in [${range[0]}, ${range[1]}].`, expression.span, diagnostics);
    }
    const allowed = signature.allowedValues?.[index];
    const ignoredFormat = call.functionName.toLowerCase() === 'tostring' && index === 1 && args[0]?.type === 'boolean';
    if (argumentValid && allowed && !ignoredFormat && argument.isConstant && argument.type !== 'null') {
      const value = typeof argument.constantValue === 'string' ? argument.constantValue.toUpperCase() : argument.constantValue;
      if (!allowed.some((candidate) => (typeof candidate === 'string' ? candidate.toUpperCase() : candidate) === value)) {
        mismatch(`Function '${call.functionName}' argument ${index + 1} must be one of ${allowed.join(', ')}.`, expression.span, diagnostics);
      }
    }
    if (argumentValid && signature.booleanLiteralArguments?.includes(index) && !isBooleanLiteral(expression)) {
      mismatch(`Function '${call.functionName}' argument ${index + 1} must be a boolean literal.`, expression.span, diagnostics);
    }
    if (argumentValid && signature.integerLiteralArguments?.includes(index) && !isIntegerLiteral(expression)) {
      mismatch(`Function '${call.functionName}' argument ${index + 1} must be an integer literal.`, expression.span, diagnostics);
    }
    if (argumentValid && signature.fractionArguments?.includes(index) &&
        (!argument.isConstant || typeof argument.constantValue !== 'number' || argument.constantValue < 0 || argument.constantValue > 1)) {
      mismatch(`Function '${call.functionName}' argument ${index + 1} must be a constant fraction in the range [0, 1].`, expression.span, diagnostics);
    }
  });
  return checkedArgs;
}

type CommonTypeMode = 'result' | 'strict' | 'comparison' | 'equality';

function resolveCommonType(
  types: readonly ExpressionType[],
  mode: CommonTypeMode = 'result'
): ExpressionType | undefined {
  const knownTypes = types.filter((type) => type !== 'null' && type !== 'unknown');

  if (knownTypes.length === 0) return 'unknown';
  if (knownTypes.every((type) => type === knownTypes[0])) return knownTypes[0];

  if (knownTypes.every(isNumeric)) {
    return knownTypes.slice(1).reduce<PplType>(
      (previous, current) => widerNumeric(previous, current),
      knownTypes[0] as PplType
    );
  }

  if (mode === 'result' && knownTypes.includes('string')) return 'string';

  if (
    (mode === 'comparison' || mode === 'equality') &&
    knownTypes.every((type) => type === 'string' || isNumeric(type))
  ) {
    return 'double';
  }

  if (
    mode === 'equality' &&
    knownTypes.every((type) => type === 'ip' || type === 'string')
  ) {
    return 'ip';
  }

  return undefined;
}

function inferCommonType(args: readonly InferredExpression[]): ExpressionType {
  return resolveCommonType(args.map(({ type }) => type)) ?? 'unknown';
}

function resultArguments(
  signature: FunctionSignature,
  args: readonly InferredExpression[]
): readonly InferredExpression[] | undefined {
  if (signature.returnType === 'if') return args.slice(1);
  if (signature.returnType === 'common') return args;

  if (signature.returnType === 'case') {
    return args.filter((_argument, index) =>
      index % 2 === 1 || (args.length % 2 === 1 && index === args.length - 1)
    );
  }

  return undefined;
}

function areCompatibleTypes(left: ExpressionType, right: ExpressionType): boolean {
  return resolveCommonType([left, right], 'strict') !== undefined;
}

function inferReturnType(signature: FunctionSignature, args: InferredExpression[], context: string): ExpressionType {
  if (signature.returnType === 'timeArithmetic') return args[0]?.type === 'time' ? 'time' : 'timestamp';
  if (signature.returnType === 'selectedValue') {
    if (args.some(({ type }) => type === 'unknown')) return 'unknown';
    const numeric = args.filter(({ type }) => isNumeric(type));
    if (signature.name === 'min' && numeric.length) return inferCommonType(numeric);
    return inferCommonType(args);
  }
  if (signature.returnType === 'reduce') return args[3]?.type ?? args[1]?.type ?? 'unknown';
  if (signature.returnType === 'mvindex') return args.length === 3 ? 'array' : args[0]?.arrayElementType ?? 'unknown';
  if (signature.returnType === 'sameAsFirst') return args[0]?.type ?? 'unknown';
  if (signature.returnType === 'widerNumeric') {
    const types = args.map(({ type }) => type).filter(isNumeric);
    return types.length ? resolveCommonType(types, 'strict') ?? 'unknown' : 'int';
  }
  if (
    signature.returnType === 'if' ||
    signature.returnType === 'common' ||
    signature.returnType === 'case'
  ) {
    return inferCommonType(resultArguments(signature, args) ?? []);
  }
  if (signature.returnType === 'fromUnixTime') return args.length > 1 ? 'string' : 'timestamp';
  if (signature.returnType === 'addDate') {
    if (args[1]?.constantValue === 'interval') return 'timestamp';
    return args[0]?.type === 'date' ? 'date' : 'timestamp';
  }
  if (signature.returnType === 'earliestLatest') return context === 'where' || context === 'eval' ? 'boolean' : args[0]?.type ?? 'unknown';
  if (signature.returnType === 'unknown') return 'unknown';
  return signature.returnType;
}

function inferExpression(
  expression: ExpressionNode,
  fields: Map<string, KnownField>,
  diagnostics: CoreDiagnostic[],
  context: string,
  insideAggregate: boolean = false,
  insideGroupBy: boolean = false
): InferredExpression {
  if (expression.type === 'Literal') {
    const literal = expression as import('../types').LiteralNode;
    if (typeof literal.value === 'string') return { type: 'string', isConstant: true, constantValue: literal.value };
    if (typeof literal.value === 'boolean') return { type: 'boolean', isConstant: true, constantValue: literal.value };
    if (typeof literal.value === 'number') return { type: Number.isInteger(literal.value) ? 'int' : 'double', isConstant: true, constantValue: literal.value };
    return { type: 'null', isConstant: true, constantValue: null };
  }
  if (expression.type === 'Identifier') return inferField(expression as IdentifierNode, fields, diagnostics);
  if (expression.type === 'LambdaExpression') {
    mismatch('Lambda expressions are only valid in collection function lambda arguments.', expression.span, diagnostics);
    return { type: 'unknown', isConstant: false };
  }

  if (expression.type === 'CastExpression') {
    const cast = expression as CastExpressionNode;
    const source = inferExpression(cast.expression, fields, diagnostics, context, insideAggregate, insideGroupBy);
    const target = normalizePplTypeName(cast.targetType);
    if (!target) {
      mismatch(`CAST target '${cast.targetType}' is not a supported PPL type.`, cast.targetTypeSpan, diagnostics);
      return { type: 'unknown', isConstant: false };
    }
    if (source.type === 'string' && NUMERIC_TYPES.has(target)) {
      if (source.isConstant && !isNumericString(source.constantValue)) {
        mismatch(`CAST value cannot be converted to '${target}'.`, cast.span, diagnostics);
        return { type: 'unknown', isConstant: false };
      }
    } else if (source.type !== 'unknown' && source.type !== 'null' && !supportsCast(source.type, target)) {
      mismatch(`CAST cannot convert '${source.type}' to '${target}'.`, cast.span, diagnostics);
      return { type: 'unknown', isConstant: false };
    }
    return { type: target, isConstant: false };
  }

  if (expression.type === 'FunctionCall') {
    const call = expression as FunctionCallNode;
    const signature = getFunctionSignature(call.functionName, context);
    const functionName = call.functionName.toLowerCase();
    const aggregateContext = ['stats', 'eventstats', 'streamstats', 'timechart'].includes(context);
    const isAggregateCall = aggregateContext && signature?.contexts?.includes(context) === true &&
      functionName !== 'eval' && functionName !== 'span';
    if (functionName === 'eval' && aggregateContext && !insideAggregate && signature) {
      mismatch(`Function 'eval' is only valid inside an aggregate function in '${context}' context.`, call.span, diagnostics);
    }
    if (functionName === 'span' && !insideGroupBy && signature) {
      mismatch("Function 'span' is only valid in a stats group-by expression.", call.span, diagnostics);
    }
    if (signature?.special === 'relevance') {
      const positional = call.arguments.filter((argument) => argument.type !== 'NamedArgument');
      const options = call.arguments.filter((argument): argument is NamedArgumentNode => argument.type === 'NamedArgument');
      const fieldListFunction = ['multi_match', 'simple_query_string', 'query_string'].includes(functionName);
      const hasFieldList = positional[0]?.type === 'RelevanceFieldList';
      const expectedArgs = fieldListFunction && !hasFieldList ? 1 : 2;
      if (positional.length !== expectedArgs) mismatch(`Function '${call.functionName}' expects ${expectedArgs} positional argument(s), got ${positional.length}.`, call.span, diagnostics);
      if (hasFieldList) {
        if (!fieldListFunction) mismatch(`Function '${call.functionName}' does not accept a field list.`, positional[0].span, diagnostics);
        const list = positional[0] as RelevanceFieldListNode;
        if (list.fields.length === 0) mismatch('Relevance field lists must not be empty.', list.span, diagnostics);
        for (const { field, boost } of list.fields) {
          if (!field.name.includes('*')) inferField(field, fields, diagnostics);
          if (boost && (typeof boost.value !== 'number' || !Number.isFinite(boost.value) || boost.value < 0)) mismatch('Field boosts must be nonnegative numbers.', boost.span, diagnostics);
        }
      } else if (!fieldListFunction && positional[0]) {
        const field = positional[0];
        if (field.type === 'Identifier') inferField(field as IdentifierNode, fields, diagnostics);
        else if (field.type === 'Literal' && typeof (field as LiteralNode).value === 'string') {
          inferField({ type: 'Identifier', name: String((field as LiteralNode).value), isBacktickQuoted: true, span: field.span }, fields, diagnostics);
        } else mismatch('Relevance searches require a field name as their first argument.', field.span, diagnostics);
      }
      const query = positional[expectedArgs - 1];
      if (query) {
        const value = inferExpression(query, fields, diagnostics, context, insideAggregate, insideGroupBy);
        if (!accepts('scalar', value.type)) mismatch('Relevance query arguments must be scalar values.', query.span, diagnostics);
      }
      const seen = new Set<string>();
      for (const option of options) {
        const name = option.name.toLowerCase();
        const constraint = signature.optionalArguments?.[name];
        if (!constraint) mismatch(`Unknown option '${option.name}' for '${call.functionName}'.`, option.span, diagnostics);
        if (seen.has(name)) mismatch(`Duplicate relevance option '${option.name}'.`, option.span, diagnostics);
        seen.add(name);
        const value = inferExpression(option.value, fields, diagnostics, context, insideAggregate, insideGroupBy);
        if (constraint && !accepts(constraint, value.type)) mismatch(`Option '${option.name}' requires ${constraint}, got ${value.type}.`, option.value.span, diagnostics);
        if (name === 'tie_breaker' && value.isConstant && typeof value.constantValue === 'number' && (value.constantValue < 0 || value.constantValue > 1)) {
          mismatch('Relevance tie_breaker must be between 0 and 1.', option.value.span, diagnostics);
        }
      }
      return { type: 'boolean', isConstant: false };
    }
    const args: InferredExpression[] = [];
    for (const [index, argument] of call.arguments.entries()) {
      if (argument.type === 'LambdaExpression' && signature?.lambdaArguments?.[index]) {
        const lambda = argument as LambdaExpressionNode;
        const constraint = signature.lambdaArguments[index];
        if (lambda.parameters.length < constraint.minParameters || lambda.parameters.length > constraint.maxParameters) {
          mismatch(`Function '${call.functionName}' lambda argument ${index + 1} expects ${constraint.minParameters}${constraint.maxParameters === constraint.minParameters ? '' : ` to ${constraint.maxParameters}`} parameter(s).`, lambda.span, diagnostics);
        }
        const localFields = new Map(fields);
        const names = new Set<string>();
        lambda.parameters.forEach((parameter, parameterIndex) => {
          if (names.has(parameter.name)) mismatch(`Duplicate lambda parameter '${parameter.name}'.`, parameter.span, diagnostics);
          names.add(parameter.name);
          let type: ExpressionType = args[0]?.arrayElementType ?? 'unknown';
          if (functionName === 'transform' && parameterIndex === 1) type = 'int';
          if (functionName === 'reduce' && (index === 3 || parameterIndex === 0)) type = args[1]?.type ?? 'unknown';
          localFields.set(parameter.name, knownField(type));
        });
        const result = inferExpression(lambda.body, localFields, diagnostics, context, insideAggregate || isAggregateCall, insideGroupBy);
        if (constraint.booleanResult && !accepts('boolean', result.type)) {
          mismatch(`Function '${call.functionName}' lambda must return boolean, got '${result.type}'.`, lambda.body.span, diagnostics);
        }
        if (functionName === 'reduce' && index === 2 && args[1] && !areCompatibleTypes(args[1].type, result.type)) {
          mismatch('Function \'reduce\' accumulator lambda must return a type compatible with the initial value.', lambda.body.span, diagnostics);
        }
        args.push(result);
        continue;
      }
      if (functionName === 'mvmap' && index === 1) {
        let source = call.arguments[0];
        while (source?.type === 'FunctionCall') source = (source as FunctionCallNode).arguments[0];
        const localFields = new Map(fields);
        if (source?.type === 'Identifier') {
          localFields.set((source as IdentifierNode).name, knownField(args[0]?.arrayElementType ?? 'unknown'));
        }
        args.push(inferExpression(argument, localFields, diagnostics, context, insideAggregate || isAggregateCall, insideGroupBy));
        continue;
      }
      if (
        index === 1 &&
        ['adddate', 'subdate', 'date_add', 'date_sub'].includes(call.functionName.toLowerCase()) &&
        argument.type === 'Identifier' &&
        (argument as IdentifierNode).name.toLowerCase() === 'interval'
      ) {
        args.push({ type: 'interval', isConstant: true, constantValue: 'interval' });
        continue;
      }
      if (
        index === 1 &&
        call.functionName.toLowerCase() === 'span' &&
        argument.type === 'Identifier' &&
        SPAN_INTERVAL_PATTERN.test((argument as IdentifierNode).name)
      ) {
        args.push({ type: 'string', isConstant: true, constantValue: (argument as IdentifierNode).name });
        continue;
      }
      if (signature?.constantArguments?.includes(index) && argument.type === 'Identifier') {
        args.push({ type: 'string', isConstant: true, constantValue: (argument as IdentifierNode).name });
        continue;
      }
      args.push(inferExpression(argument, fields, diagnostics, context, insideAggregate || isAggregateCall, insideGroupBy));
    }
    if (!signature) {
      if (FUNCTION_SIGNATURES.has(call.functionName.toLowerCase())) {
        mismatch(`Function '${call.functionName}' is not available in '${context}' context.`, call.span, diagnostics);
      }
      return { type: 'unknown', isConstant: false };
    }
    const checkedArgs = checkArguments(call, signature, args, diagnostics);
    const results = resultArguments(signature, checkedArgs);
    if (
      results &&
      (signature.returnType === 'if' || signature.returnType === 'common') &&
      functionName !== 'coalesce' &&
      resolveCommonType(results.map(({ type }) => type)) === undefined
    ) {
      mismatch(`Function '${call.functionName}' arguments have incompatible result types.`, call.span, diagnostics);
    }
    let arrayElementType: ExpressionType | undefined;
    if (functionName === 'array') arrayElementType = inferCommonType(checkedArgs);
    else if (functionName === 'mvappend') {
      arrayElementType = inferCommonType(checkedArgs.map((argument) => ({
        ...argument, type: argument.type === 'array' ? argument.arrayElementType ?? 'unknown' : argument.type,
      })));
    } else if (functionName === 'split' || functionName === 'mvzip') arrayElementType = 'string';
    else if (functionName === 'mvdedup' || functionName === 'filter' || (functionName === 'mvindex' && checkedArgs.length === 3)) {
      arrayElementType = checkedArgs[0]?.arrayElementType;
    } else if (functionName === 'transform' || functionName === 'mvmap') {
      arrayElementType = checkedArgs[1]?.type;
    }
    return { type: inferReturnType(signature, checkedArgs, context), arrayElementType, isConstant: false };
  }

  if (expression.type === 'BinaryExpression') {
    const binary = expression as BinaryExpressionNode;
    const left = inferExpression(binary.left, fields, diagnostics, context, insideAggregate, insideGroupBy);
    const right = inferExpression(binary.right, fields, diagnostics, context, insideAggregate, insideGroupBy);
    const operator = binary.operator.toUpperCase();
    if (operator === 'AND' || operator === 'OR') {
      for (const [value, operand] of [[left, binary.left], [right, binary.right]] as const) {
        if (value.type !== 'unknown' && value.type !== 'null' && value.type !== 'boolean') {
          mismatch(`Operator '${binary.operator}' requires boolean operands, got '${value.type}'.`, operand.span, diagnostics);
        }
      }
      return { type: 'boolean', isConstant: false };
    }
    if (['==', '=', '!=', '<>', '>', '>=', '<', '<=', 'IN', 'LIKE'].includes(operator)) {
      const mode = ['==', '=', '!=', '<>'].includes(operator) ? 'equality' : 'comparison';
      const compatible = resolveCommonType([left.type, right.type], mode) !== undefined;
      if (!compatible) mismatch(`Operator '${binary.operator}' cannot compare '${left.type}' with '${right.type}'.`, binary.span, diagnostics);
      else if (left.type === 'string' && isNumeric(right.type)) coerceStringToNumber(left, binary.left.span, diagnostics);
      else if (right.type === 'string' && isNumeric(left.type)) coerceStringToNumber(right, binary.right.span, diagnostics);
      return { type: 'boolean', isConstant: false };
    }
    if (binary.operator === '+' && left.type === 'string' && right.type === 'string') return { type: 'string', isConstant: false };
    if (isNumeric(left.type) && isNumeric(right.type)) return { type: widerNumeric(left.type, right.type), isConstant: false };
    if ((binary.operator === '+' || binary.operator === '-' || binary.operator === '*' || binary.operator === '/' || binary.operator === '%') &&
        ((left.type === 'string' && isNumeric(right.type)) || (right.type === 'string' && isNumeric(left.type)))) {
      const stringValue = left.type === 'string' ? left : right;
      const stringExpression = left.type === 'string' ? binary.left : binary.right;
      if (!coerceStringToNumber(stringValue, stringExpression.span, diagnostics)) {
        mismatch(`Operator '${binary.operator}' requires numeric operands.`, stringExpression.span, diagnostics);
        return { type: 'unknown', isConstant: false };
      }
      return { type: widerNumeric(isNumeric(left.type) ? left.type : 'double', isNumeric(right.type) ? right.type : 'double'), isConstant: false };
    }
    if (left.type === 'unknown' || right.type === 'unknown') {
      const other = left.type === 'unknown' ? right.type : left.type;
      if (other === 'unknown' || other === 'string' || isNumeric(other)) return { type: 'unknown', isConstant: false };
    }
    mismatch(`Operator '${binary.operator}' cannot use '${left.type}' and '${right.type}'.`, binary.span, diagnostics);
    return { type: 'unknown', isConstant: false };
  }

  if (expression.type === 'InExpression') {
    const membership = expression as InExpressionNode;
    const left = inferExpression(membership.left, fields, diagnostics, context, insideAggregate, insideGroupBy);
    for (const value of membership.values) {
      const right = inferExpression(value, fields, diagnostics, context, insideAggregate, insideGroupBy);
      if (!areCompatibleTypes(left.type, right.type)) {
        mismatch(
          `IN compares incompatible types '${left.type}' and '${right.type}'.`,
          value.span,
          diagnostics
        );
      }
    }
    return { type: 'boolean', isConstant: false };
  }

  if (expression.type === 'UnaryExpression') {
    const unary = expression as UnaryExpressionNode;
    const argument = inferExpression(unary.argument, fields, diagnostics, context, insideAggregate, insideGroupBy);
    if (unary.operator.toLowerCase() === 'not' && argument.type !== 'boolean' && argument.type !== 'unknown') {
      mismatch(`Operator '${unary.operator}' requires a boolean operand, got '${argument.type}'.`, unary.argument.span, diagnostics);
    } else if (unary.operator.toLowerCase() !== 'not' && !isNumeric(argument.type) && argument.type !== 'unknown') {
      mismatch(`Unary '${unary.operator}' requires a numeric operand, got '${argument.type}'.`, unary.argument.span, diagnostics);
    }
    if (argument.isConstant && typeof argument.constantValue === 'number' && ['+', '-'].includes(unary.operator)) {
      return { type: argument.type, isConstant: true, constantValue: unary.operator === '-' ? -argument.constantValue : argument.constantValue };
    }
    return { type: unary.operator.toLowerCase() === 'not' ? 'boolean' : argument.type, isConstant: false };
  }
  return { type: 'unknown', isConstant: false };
}

function knownField(type: ExpressionType, templates: string[] = [], arrayElementType?: ExpressionType): KnownField {
  const field: KnownField = { types: [], pplTypes: type === 'unknown' || type === 'null' || type === 'interval' ? [] : [type], templates };
  if (type === 'array' && arrayElementType && !['unknown', 'null', 'interval'].includes(arrayElementType)) {
    field.arrayElementType = arrayElementType as PplType;
  }
  return field;
}

function mergeKnownFields(left: KnownField, right: KnownField): KnownField {
  return {
    types: [...new Set([...left.types, ...right.types])],
    pplTypes: [...new Set([...mappedTypes(left), ...mappedTypes(right)])],
    templates: [...new Set([...left.templates, ...right.templates])],
  };
}

function projectFields(fields: Map<string, KnownField>, stage: FieldsStageNode): Map<string, KnownField> {
  const selected = stage.fields.map((field) => field.name);
  if (stage.mode === '-') {
    return new Map([...fields].filter(([name]) =>
      !selected.some((prefix) => name === prefix || name.startsWith(`${prefix}.`))
    ));
  }
  return new Map(selected.flatMap((prefix) =>
    [...fields].filter(([name]) => name === prefix || name.startsWith(`${prefix}.`))
  ));
}

function moveRenamedFields(fields: Map<string, KnownField>, stage: RenameStageNode): void {
  for (const pair of stage.pairs) {
    const renamed = [...fields].filter(([name]) => name === pair.from.name || name.startsWith(`${pair.from.name}.`));
    for (const [name] of renamed) fields.delete(name);
    for (const [name, field] of renamed) fields.set(pair.to.name + name.slice(pair.from.name.length), field);
  }
}

function namedCaptures(pattern: string): string[] {
  return [...new Set([...pattern.matchAll(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g)].map((match) => match[1]))];
}

function applyStage(
  stage: PipelineNode['stages'][number],
  fields: Map<string, KnownField>,
  diagnostics: CoreDiagnostic[],
  templates: readonly IndexTemplate[] = [],
  includedIndexes: readonly string[] = []
): {
  fields: Map<string, KnownField>;
  certain: boolean;
} {
  if (stage.type === 'WhereStage') {
    const conditionType = inferExpression((stage as WhereStageNode).condition, fields, diagnostics, 'where').type;
    if (conditionType !== 'unknown' && conditionType !== 'null' && conditionType !== 'boolean') {
      mismatch(`WHERE condition must be boolean, got '${conditionType}'.`, stage.span, diagnostics);
    }
    return { fields, certain: true };
  }
  if (stage.type === 'EvalStage') {
    for (const assignment of (stage as EvalStageNode).assignments) {
      const value = inferExpression(assignment.value, fields, diagnostics, 'eval');
      fields.set(assignment.field.name, knownField(value.type, [], value.arrayElementType));
    }
    return { fields, certain: true };
  }
  if (stage.type === 'StatsStage') {
    const stats = stage as StatsStageNode;
    const context = stage.commandName.toLowerCase();
    const output = ['eventstats', 'streamstats'].includes(context) ? new Map(fields) : new Map<string, KnownField>();
    for (const aggregation of stats.aggregations) {
      const type = inferExpression(aggregation, fields, diagnostics, context).type;
      if (aggregation.alias) output.set(aggregation.alias, knownField(type));
    }
    if (stats.groupByExpressions) {
      for (const group of stats.groupByExpressions) {
        const groupType = inferExpression(group.expression, fields, diagnostics, context, false, true).type;
        if (group.outputName) output.set(group.outputName, knownField(groupType));
      }
    } else {
      for (const group of stats.groupBy) {
        const result = fieldReferenceDiagnostics(group, fields);
        diagnostics.push(...result.diagnostics);
        output.set(group.name, fields.get(group.name) || knownField('unknown'));
      }
    }
    return { fields: output, certain: true };
  }
  if (stage.type === 'FieldsStage') {
    const projection = stage as FieldsStageNode;
    for (const field of projection.fields) diagnostics.push(...fieldReferenceDiagnostics(field, fields).diagnostics);
    return { fields: projectFields(fields, projection), certain: true };
  }
  if (stage.type === 'SortStage' || stage.type === 'DedupStage') {
    const refs = stage.type === 'SortStage' ? (stage as SortStageNode).fields : (stage as DedupStageNode).fields;
    for (const reference of refs) diagnostics.push(...fieldReferenceDiagnostics(reference, fields).diagnostics);
    return { fields, certain: true };
  }
  if (stage.type === 'RenameStage') {
    const rename = stage as RenameStageNode;
    for (const pair of rename.pairs) diagnostics.push(...fieldReferenceDiagnostics(pair.from, fields).diagnostics);
    moveRenamedFields(fields, rename);
    return { fields, certain: true };
  }
  if (stage.type === 'LookupStage') {
    const lookup = stage as LookupStageNode;

    if (!isSourceIncluded(lookup.index.name, includedIndexes)) {
      diagnostics.push({
        code: 'PPL011',
        message: `Lookup index '${lookup.index.name}' is not included by pplLinter.includedIndexes.`,
        severity: 'error',
        span: lookup.index.span,
      });
      return { fields, certain: false };
    }

    const lookupFields = resolveSource(templates, lookup.index.name, includedIndexes);
    if (lookupFields.size === 0) {
      diagnostics.push({
        code: 'PPL011',
        message: `No configured index template or alias matches lookup index '${lookup.index.name}'.`,
        severity: 'error',
        span: lookup.index.span,
      });
      return { fields, certain: false };
    }

    for (const mapping of lookup.mappings) {
      diagnostics.push(...fieldReferenceDiagnostics(mapping.lookup, lookupFields).diagnostics);
      diagnostics.push(...fieldReferenceDiagnostics(mapping.source ?? mapping.lookup, fields).diagnostics);
    }

    const lookupKeys = new Set(lookup.mappings.map((mapping) => mapping.lookup.name));
    const outputs: Array<{
      inputName: string;
      outputName: string;
      span: Span;
      input?: IdentifierNode;
      field?: KnownField;
    }> = lookup.outputs.length > 0
      ? lookup.outputs.map((output) => ({
          inputName: output.input.name,
          outputName: output.output?.name ?? output.input.name,
          span: output.output?.span ?? output.input.span,
          input: output.input,
        }))
      : [...lookupFields]
          .filter(([name]) => !lookupKeys.has(name))
          .map(([name, field]) => ({
            inputName: name,
            outputName: name,
            span: lookup.index.span,
            field,
          }));

    let certain = true;
    for (const output of outputs) {
      const lookupField = output.field ?? lookupFields.get(output.inputName);
      if (!lookupField) {
        diagnostics.push({
          code: 'PPL012',
          message: `Lookup output field '${output.inputName}' is not declared in lookup index '${lookup.index.name}'.`,
          severity: 'error',
          span: output.span,
        });
        certain = false;
        continue;
      }
      if (output.input) {
        const result = fieldReferenceDiagnostics(output.input, lookupFields);
        diagnostics.push(...result.diagnostics);
        if (result.diagnostics.some((diagnostic) => diagnostic.code === 'PPL012')) {
          certain = false;
          continue;
        }
      }

      if ((lookup.outputMode ?? 'replace') === 'append') {
        const existing = fields.get(output.outputName);
        if (!existing) {
          diagnostics.push({
            code: 'PPL012',
            message: `Lookup append output field '${output.outputName}' must already exist in the source results.`,
            severity: 'error',
            span: output.span,
          });
          certain = false;
          continue;
        }
        fields.set(output.outputName, mappedTypes(existing).length > 0
          ? mergeKnownFields(existing, lookupField)
          : existing);
      } else {
        fields.set(output.outputName, lookupField);
      }
    }
    return { fields, certain };
  }
  if (stage.type === 'PatternStage') {
    const pattern = stage as PatternStageNode;
    diagnostics.push(...fieldReferenceDiagnostics(pattern.field, fields).diagnostics);
    const command = stage.commandName.toLowerCase();
    if (command === 'rex' || command === 'parse') {
      const patternText = typeof pattern.pattern.value === 'string' ? pattern.pattern.value : '';
      for (const capture of namedCaptures(patternText)) fields.set(capture, knownField('string'));
      const offsetField = pattern.options.offset_field;
      if (typeof offsetField === 'string') fields.set(offsetField, knownField('string'));
      return { fields, certain: true };
    }
    return command === 'regex' ? { fields, certain: true } : { fields, certain: false };
  }
  if (stage.type === 'OptionStage') {
    const option = stage as OptionStageNode;
    if (option.field) diagnostics.push(...fieldReferenceDiagnostics(option.field, fields).diagnostics);
    if (option.groupBy) diagnostics.push(...fieldReferenceDiagnostics(option.groupBy, fields).diagnostics);
    if (option.aggregation) inferExpression(option.aggregation, fields, diagnostics, stage.commandName.toLowerCase());
    return stage.commandName.toLowerCase() === 'timechart' ? { fields, certain: false } : { fields, certain: true };
  }
  if (stage.type === 'HeadStage') return { fields, certain: true };
  if (stage.type === 'JoinStage') return { fields, certain: false };
  return { fields, certain: false };
}

function spanContains(span: Span | undefined, offset: number): boolean {
  return span !== undefined && span.start.offset <= offset && offset < span.end.offset;
}

function definedFieldAt(
  stage: PipelineNode['stages'][number],
  fields: Map<string, KnownField>,
  offset: number
): { name: string; field: KnownField } | undefined {
  if (stage.type === 'EvalStage') {
    const evalStage = stage as EvalStageNode;
    for (let index = 0; index < evalStage.assignments.length; index++) {
      const assignment = evalStage.assignments[index];
      if (!spanContains(assignment.field.span, offset)) continue;
      const partial = { ...evalStage, assignments: evalStage.assignments.slice(0, index + 1) };
      const field = applyStage(partial, new Map(fields), []).fields.get(assignment.field.name);
      return field ? { name: assignment.field.name, field } : undefined;
    }
  }

  if (stage.type === 'StatsStage') {
    const stats = stage as StatsStageNode;
    for (const aggregation of stats.aggregations) {
      if (!aggregation.alias || !spanContains(aggregation.aliasSpan, offset)) continue;
      const partial = { ...stats, aggregations: [aggregation], groupBy: [], groupByExpressions: [] };
      const field = applyStage(partial, new Map(fields), []).fields.get(aggregation.alias);
      return field ? { name: aggregation.alias, field } : undefined;
    }
    for (const group of stats.groupByExpressions || []) {
      if (!group.outputName || !spanContains(group.outputSpan, offset)) continue;
      const type = inferExpression(group.expression, fields, [], stage.commandName.toLowerCase()).type;
      return { name: group.outputName, field: knownField(type) };
    }
  }

  return undefined;
}

export function checkSchemaTypes(
  query: string,
  ast: PipelineNode,
  templates: readonly IndexTemplate[],
  schemaEnabled: boolean = templates.length > 0,
  includedIndexes: readonly string[] = []
): CoreDiagnostic[] {
  if (!schemaEnabled || query.length === 0 || ast.source.type !== 'SourceStage' || ast.syntaxErrors.length > 0) return [];
  if (!isSourceIncluded(ast.source.indexName, includedIndexes)) {
    return [{
      code: 'PPL011',
      message: `Source '${ast.source.indexName}' is not included by pplLinter.includedIndexes.`,
      severity: 'error',
      span: ast.source.span,
    }];
  }
  if (templates.length === 0) {
    return [{ code: 'PPL011', message: `No index templates were loaded for source '${ast.source.indexName}'.`, severity: 'error', span: ast.source.span }];
  }
  const fields = resolveSource(templates, ast.source.indexName);
  if (fields.size === 0) {
    return [{ code: 'PPL011', message: `No configured index template or alias matches source '${ast.source.indexName}'.`, severity: 'error', span: ast.source.span }];
  }
  const diagnostics: CoreDiagnostic[] = [];
  let scope = fields;
  let certain = true;
  for (const stage of ast.stages) {
    if (!certain) break;
    const result = applyStage(stage, scope, diagnostics, templates, includedIndexes);
    scope = result.fields;
    certain = result.certain;
  }
  return diagnostics;
}

export function typedFieldScopeAt(
  query: string,
  templates: readonly IndexTemplate[],
  offset: number,
  includedIndexes: readonly string[] = []
): Map<string, KnownField> | undefined {
  if (templates.length === 0) return undefined;
  const ast = parsePpl(query);
  if (ast.source.type !== 'SourceStage' || offset < ast.source.span.end.offset) return undefined;
  let fields = resolveSource(templates, ast.source.indexName, includedIndexes);
  if (fields.size === 0) return undefined;

  for (const stage of ast.stages) {
    if (offset <= stage.span.end.offset) {
      const definition = definedFieldAt(stage, fields, offset);
      return definition ? new Map(fields).set(definition.name, definition.field) : fields;
    }
    const result = applyStage(stage, fields, [], templates, includedIndexes);
    if (!result.certain) return undefined;
    fields = result.fields;
  }
  return fields;
}
