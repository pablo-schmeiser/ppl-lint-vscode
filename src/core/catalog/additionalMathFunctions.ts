import type { DocumentedFunction } from './documentedFunction';
import type { FunctionSignature, ReturnTypeRule, TypeConstraint } from './functionSignatures';

function entry({
  name,
  description,
  arguments: arguments_,
  returnType,
  example,
  minArgs = arguments_.length,
}: {
  name: string;
  description: string;
  arguments: TypeConstraint[];
  returnType: ReturnTypeRule;
  example: string;
  minArgs?: number;
}): DocumentedFunction {
  return {
    name,
    category: 'Mathematical',
    path: 'math',
    description,
    signatures: [{
      name,
      minArgs,
      maxArgs: arguments_.length,
      arguments: arguments_,
      returnType,
    }],
    examples: [`| eval result = ${example}`],
  };
}

export const ADDITIONAL_MATH_FUNCTIONS: DocumentedFunction[] = [
  ...([
    {
      name: 'add',
      description: 'Adds two numbers.',
      example: 'add(2, 1)',
    },
    {
      name: 'subtract',
      description: 'Subtracts the second number from the first.',
      example: 'subtract(2, 1)',
    },
    {
      name: 'multiply',
      description: 'Multiplies two numbers.',
      example: 'multiply(2, 1)',
    },
    {
      name: 'divide',
      description: 'Divides the first number by the second.',
      example: 'divide(2, 1)',
    },
    {
      name: 'mod',
      description: 'Returns the remainder, or null when the divisor is zero.',
      example: 'mod(3, 2)',
    },
    {
      name: 'modulus',
      description: 'Alias of mod; returns the remainder, or null when the divisor is zero.',
      example: 'modulus(3, 2)',
    },
  ] as const).map(({ name, description, example }) => entry({
    name,
    description,
    arguments: ['numeric', 'numeric'],
    returnType: 'widerNumeric',
    example,
  })),
  ...([
    {
      name: 'acos',
      description: 'Returns the arccosine in radians, or null outside [-1, 1].',
      example: 'acos(0)',
    },
    {
      name: 'asin',
      description: 'Returns the arcsine in radians, or null outside [-1, 1].',
      example: 'asin(0)',
    },
    {
      name: 'cos',
      description: 'Returns the cosine of an angle in radians.',
      example: 'cos(0)',
    },
    {
      name: 'cosh',
      description: 'Returns the hyperbolic cosine.',
      example: 'cosh(2)',
    },
    {
      name: 'cot',
      description: 'Returns the cotangent of an angle in radians. Zero input produces an error.',
      example: 'cot(1)',
    },
    {
      name: 'degrees',
      description: 'Converts radians to degrees.',
      example: 'degrees(1.57)',
    },
    {
      name: 'expm1',
      description: 'Returns the exponential of the value minus one.',
      example: 'expm1(1)',
    },
    {
      name: 'radians',
      description: 'Converts degrees to radians.',
      example: 'radians(90)',
    },
    {
      name: 'sin',
      description: 'Returns the sine of an angle in radians.',
      example: 'sin(0)',
    },
    {
      name: 'sinh',
      description: 'Returns the hyperbolic sine.',
      example: 'sinh(2)',
    },
    {
      name: 'rint',
      description: 'Rounds to the nearest integer, returning a double.',
      example: 'rint(1.7)',
    },
  ] as const).map(({ name, description, example }) => entry({
    name,
    description,
    arguments: ['numeric'],
    returnType: 'double',
    example,
  })),
  entry({
    name: 'atan',
    description: 'Returns the arctangent in radians. With two arguments, their signs determine the quadrant.',
    arguments: ['numeric', 'numeric'],
    returnType: 'double',
    example: 'atan(2, 3)',
    minArgs: 1,
  }),
  entry({
    name: 'atan2',
    description: 'Returns the arctangent of y / x in radians, using both signs to determine the quadrant.',
    arguments: ['numeric', 'numeric'],
    returnType: 'double',
    example: 'atan2(2, 3)',
  }),
  entry({
    name: 'conv',
    description: 'Converts a string or numeric representation between integer bases and returns a string.',
    arguments: ['numericOrString', 'integer', 'integer'],
    returnType: 'string',
    example: "conv('2C', 16, 10)",
  }),
  entry({
    name: 'crc32',
    description: 'Returns the unsigned 32-bit cyclic redundancy checksum as a long.',
    arguments: ['string'],
    returnType: 'bigint',
    example: "crc32('MySQL')",
  }),
  entry({
    name: 'e',
    description: "Returns Euler's number as a double.",
    arguments: [],
    returnType: 'double',
    example: 'e()',
  }),
  entry({
    name: 'pi',
    description: 'Returns pi as a double.',
    arguments: [],
    returnType: 'double',
    example: 'pi()',
  }),
  entry({
    name: 'rand',
    description: 'Returns a random float in [0, 1). An optional integer seed makes the sequence repeatable.',
    arguments: ['integer'],
    returnType: 'float',
    example: 'rand(3)',
    minArgs: 0,
  }),
  entry({
    name: 'sign',
    description: 'Returns -1, 0, or 1 with the numeric input type.',
    arguments: ['numeric'],
    returnType: 'sameAsFirst',
    example: 'sign(-1.1)',
  }),
  entry({
    name: 'signum',
    description: 'Returns the sign as -1, 0, or 1. The reference declares INTEGER, although its decimal example preserves a decimal.',
    arguments: ['numeric'],
    returnType: 'int',
    example: 'signum(-1)',
  }),
];

export const STATISTICAL_FUNCTIONS: DocumentedFunction[] = ['min', 'max'].map((name) => ({
  name,
  category: 'Statistical',
  path: 'statistical',
  description: name === 'max'
    ? 'In eval, selects the greatest numeric or string argument. Strings rank above numbers. In aggregation stages, selects the greatest field value.'
    : 'In eval, selects the least numeric or string argument. Numbers rank below strings. In aggregation stages, selects the least field value.',
  signatures: [{
    name,
    minArgs: 1,
    arguments: ['numericOrString'],
    variadic: 'numericOrString',
    returnType: 'selectedValue',
    contexts: ['eval'],
  } as FunctionSignature],
  syntax: [`${name}(value, ...values)`],
  examples: [`| eval result = ${name}(age, 30)`],
}));