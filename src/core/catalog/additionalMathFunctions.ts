import type { DocumentedFunction } from './documentedFunction';
import type { FunctionSignature, ReturnTypeRule, TypeConstraint } from './functionSignatures';

function entry(name: string, description: string, arguments_: TypeConstraint[], returnType: ReturnTypeRule, example: string, minArgs = arguments_.length): DocumentedFunction {
  return {
    name, category: 'Mathematical', path: 'math', description,
    signatures: [{ name, minArgs, maxArgs: arguments_.length, arguments: arguments_, returnType }],
    examples: [`| eval result = ${example}`],
  };
}

export const ADDITIONAL_MATH_FUNCTIONS: DocumentedFunction[] = [
  ...([
    ['add', 'Adds two numbers.', 'add(2, 1)'],
    ['subtract', 'Subtracts the second number from the first.', 'subtract(2, 1)'],
    ['multiply', 'Multiplies two numbers.', 'multiply(2, 1)'],
    ['divide', 'Divides the first number by the second.', 'divide(2, 1)'],
    ['mod', 'Returns the remainder, or null when the divisor is zero.', 'mod(3, 2)'],
    ['modulus', 'Alias of mod; returns the remainder, or null when the divisor is zero.', 'modulus(3, 2)'],
  ] as const).map(([name, description, example]) => entry(name, description, ['numeric', 'numeric'], 'widerNumeric', example)),
  ...([
    ['acos', 'Returns the arccosine in radians, or null outside [-1, 1].', 'acos(0)'],
    ['asin', 'Returns the arcsine in radians, or null outside [-1, 1].', 'asin(0)'],
    ['cos', 'Returns the cosine of an angle in radians.', 'cos(0)'],
    ['cosh', 'Returns the hyperbolic cosine.', 'cosh(2)'],
    ['cot', 'Returns the cotangent of an angle in radians. Zero input produces an error.', 'cot(1)'],
    ['degrees', 'Converts radians to degrees.', 'degrees(1.57)'],
    ['expm1', 'Returns the exponential of the value minus one.', 'expm1(1)'],
    ['radians', 'Converts degrees to radians.', 'radians(90)'],
    ['sin', 'Returns the sine of an angle in radians.', 'sin(0)'],
    ['sinh', 'Returns the hyperbolic sine.', 'sinh(2)'],
    ['rint', 'Rounds to the nearest integer, returning a double.', 'rint(1.7)'],
  ] as const).map(([name, description, example]) => entry(name, description, ['numeric'], 'double', example)),
  entry('atan', 'Returns the arctangent in radians. With two arguments, their signs determine the quadrant.', ['numeric', 'numeric'], 'double', 'atan(2, 3)', 1),
  entry('atan2', 'Returns the arctangent of y / x in radians, using both signs to determine the quadrant.', ['numeric', 'numeric'], 'double', 'atan2(2, 3)'),
  entry('conv', 'Converts a string or numeric representation between integer bases and returns a string.', ['numericOrString', 'integer', 'integer'], 'string', "conv('2C', 16, 10)"),
  entry('crc32', 'Returns the unsigned 32-bit cyclic redundancy checksum as a long.', ['string'], 'bigint', "crc32('MySQL')"),
  entry('e', "Returns Euler's number as a double.", [], 'double', 'e()'),
  entry('pi', 'Returns pi as a double.', [], 'double', 'pi()'),
  entry('rand', 'Returns a random float in [0, 1). An optional integer seed makes the sequence repeatable.', ['integer'], 'float', 'rand(3)', 0),
  entry('sign', 'Returns -1, 0, or 1 with the numeric input type.', ['numeric'], 'sameAsFirst', 'sign(-1.1)'),
  entry('signum', 'Returns the sign as -1, 0, or 1. The reference declares INTEGER, although its decimal example preserves a decimal.', ['numeric'], 'int', 'signum(-1)'),
];

export const STATISTICAL_FUNCTIONS: DocumentedFunction[] = ['min', 'max'].map((name) => ({
  name, category: 'Statistical', path: 'statistical',
  description: name === 'max'
    ? 'In eval, selects the greatest numeric or string argument. Strings rank above numbers. In aggregation stages, selects the greatest field value.'
    : 'In eval, selects the least numeric or string argument. Numbers rank below strings. In aggregation stages, selects the least field value.',
  signatures: [{ name, minArgs: 1, arguments: ['numericOrString'], variadic: 'numericOrString', returnType: 'selectedValue', contexts: ['eval'] } as FunctionSignature],
  syntax: [`${name}(value, ...values)`],
  examples: [`| eval result = ${name}(age, 30)`],
}));
