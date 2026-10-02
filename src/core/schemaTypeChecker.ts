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

type ExpressionType = PplType | 'null' | 'unknown';

interface InferredExpression {
  type: ExpressionType;
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
  return { type: types[0], isConstant: false };
}

function isNumeric(type: ExpressionType): type is PplType {
  return type !== 'null' && type !== 'unknown' && NUMERIC_TYPES.has(type);
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
  if (constraint === 'numeric') return NUMERIC_TYPES.has(type);
  if (constraint === 'temporal') return TEMPORAL_TYPES.has(type) || type === 'string';
  if (constraint === 'stringLike') return type === 'string' || type === 'ip';
  if (constraint === 'array') return type === 'array';
  return type === constraint;
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
  args.forEach((argument, index) => {
    const constraint = argumentConstraint(signature, index);
    if (!constraint || accepts(constraint, argument.type)) return;
    if (constraint === 'numeric' && argument.type === 'string') {
      if (argument.isConstant && !isNumericString(argument.constantValue)) {
        mismatch(`String literal cannot be converted to a number for '${call.functionName}'.`, call.arguments[index].span, diagnostics);
        return;
      }
      if (!argument.isConstant) {
        diagnostics.push({
          code: 'PPL015',
          message: `Function '${call.functionName}' converts a string argument to numeric at runtime; nonnumeric values may fail.`,
          severity: 'warning',
          span: call.arguments[index].span,
        });
      }
      checkedArgs[index] = { ...argument, type: 'double' };
      return;
    }
    diagnostics.push({
      code: 'PPL014',
      message: `Function '${call.functionName}' argument ${index + 1} requires ${constraint}, got ${argument.type}.`,
      severity: 'error',
      span: call.arguments[index].span,
    });
  });
  return checkedArgs;
}

function inferCommonType(args: readonly InferredExpression[]): ExpressionType {
  const types = args.map(({ type }) => type).filter((type) => type !== 'null' && type !== 'unknown');
  if (types.length > 0 && types.every((type) => type === types[0])) return types[0];
  if (types.length > 0 && types.every(isNumeric)) {
    return types.slice(1).reduce<PplType>((previous, current) => widerNumeric(previous, current), types[0] as PplType);
  }
  return types.includes('string') ? 'string' : 'unknown';
}

function inferReturnType(signature: FunctionSignature, args: InferredExpression[], context: string): ExpressionType {
  if (signature.returnType === 'sameAsFirst') return args[0]?.type ?? 'unknown';
  if (signature.returnType === 'widerNumeric') {
    const types = args.map(({ type }) => type).filter(isNumeric);
    return types.reduce<PplType>((previous, current) => widerNumeric(previous, current), types[0] || 'int');
  }
  if (signature.returnType === 'if') return inferCommonType(args.slice(1));
  if (signature.returnType === 'common') return inferCommonType(args);
  if (signature.returnType === 'case') {
    const results = args.filter((_argument, index) => index % 2 === 1);
    if (args.length % 2 === 1) results.push(args[args.length - 1]);
    const types = results.map(({ type }) => type).filter((type) => type !== 'null' && type !== 'unknown');
    if (types.length > 0 && types.every((type) => type === types[0])) return types[0];
    if (types.length > 0 && types.every(isNumeric)) {
      return types.slice(1).reduce<PplType>((previous, current) => widerNumeric(previous, current), types[0] as PplType);
    }
    return types.includes('string') ? 'string' : 'unknown';
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
  context: string
): InferredExpression {
  if (expression.type === 'Literal') {
    const literal = expression as import('../types').LiteralNode;
    if (typeof literal.value === 'string') return { type: 'string', isConstant: true, constantValue: literal.value };
    if (typeof literal.value === 'boolean') return { type: 'boolean', isConstant: true, constantValue: literal.value };
    if (typeof literal.value === 'number') return { type: Number.isInteger(literal.value) ? 'int' : 'double', isConstant: true, constantValue: literal.value };
    return { type: 'null', isConstant: true, constantValue: null };
  }
  if (expression.type === 'Identifier') return inferField(expression as IdentifierNode, fields, diagnostics);

  if (expression.type === 'CastExpression') {
    const cast = expression as CastExpressionNode;
    const source = inferExpression(cast.expression, fields, diagnostics, context);
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
    const args = call.arguments.map((argument, index) => {
      if (
        index === 1 &&
        ['adddate', 'date_add', 'date_sub'].includes(call.functionName.toLowerCase()) &&
        argument.type === 'Identifier' &&
        (argument as IdentifierNode).name.toLowerCase() === 'interval'
      ) {
        return { type: 'string' as const, isConstant: true, constantValue: 'interval' };
      }
      if (
        index === 1 &&
        call.functionName.toLowerCase() === 'span' &&
        argument.type === 'Identifier' &&
        SPAN_INTERVAL_PATTERN.test((argument as IdentifierNode).name)
      ) {
        return { type: 'string' as const, isConstant: true, constantValue: (argument as IdentifierNode).name };
      }
      if (signature?.constantArguments?.includes(index) && argument.type === 'Identifier') {
        return { type: 'string' as const, isConstant: true, constantValue: (argument as IdentifierNode).name };
      }
      return inferExpression(argument, fields, diagnostics, context);
    });
    if (!signature) {
      if (FUNCTION_SIGNATURES.has(call.functionName.toLowerCase())) {
        mismatch(`Function '${call.functionName}' is not available in '${context}' context.`, call.span, diagnostics);
      }
      return { type: 'unknown', isConstant: false };
    }
    const checkedArgs = checkArguments(call, signature, args, diagnostics);
    return { type: inferReturnType(signature, checkedArgs, context), isConstant: false };
  }

  if (expression.type === 'BinaryExpression') {
    const binary = expression as BinaryExpressionNode;
    const left = inferExpression(binary.left, fields, diagnostics, context);
    const right = inferExpression(binary.right, fields, diagnostics, context);
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
      const compatible = left.type === 'unknown' || right.type === 'unknown' || left.type === 'null' || right.type === 'null' ||
        left.type === right.type || (isNumeric(left.type) && isNumeric(right.type)) ||
        ((left.type === 'string' && isNumeric(right.type)) || (right.type === 'string' && isNumeric(left.type)));
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
    mismatch(`Operator '${binary.operator}' cannot use '${left.type}' and '${right.type}'.`, binary.span, diagnostics);
    return { type: 'unknown', isConstant: false };
  }

  if (expression.type === 'InExpression') {
    const membership = expression as InExpressionNode;
    const left = inferExpression(membership.left, fields, diagnostics, context);
    for (const value of membership.values) {
      const right = inferExpression(value, fields, diagnostics, context);
      const compatible = left.type === 'unknown' || right.type === 'unknown' || left.type === 'null' || right.type === 'null' ||
        left.type === right.type || (isNumeric(left.type) && isNumeric(right.type));
      if (!compatible) mismatch(`IN compares incompatible types '${left.type}' and '${right.type}'.`, value.span, diagnostics);
    }
    return { type: 'boolean', isConstant: false };
  }

  if (expression.type === 'UnaryExpression') {
    const unary = expression as UnaryExpressionNode;
    const argument = inferExpression(unary.argument, fields, diagnostics, context);
    if (unary.operator.toLowerCase() === 'not' && argument.type !== 'boolean' && argument.type !== 'unknown') {
      mismatch(`Operator '${unary.operator}' requires a boolean operand, got '${argument.type}'.`, unary.argument.span, diagnostics);
    } else if (unary.operator.toLowerCase() !== 'not' && !isNumeric(argument.type) && argument.type !== 'unknown') {
      mismatch(`Unary '${unary.operator}' requires a numeric operand, got '${argument.type}'.`, unary.argument.span, diagnostics);
    }
    return { type: unary.operator.toLowerCase() === 'not' ? 'boolean' : argument.type, isConstant: false };
  }
  return { type: 'unknown', isConstant: false };
}

function knownField(type: ExpressionType, templates: string[] = []): KnownField {
  return { types: [], pplTypes: type === 'unknown' || type === 'null' ? [] : [type], templates };
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
      fields.set(assignment.field.name, knownField(inferExpression(assignment.value, fields, diagnostics, 'eval').type));
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
        const groupType = inferExpression(group.expression, fields, diagnostics, context).type;
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
