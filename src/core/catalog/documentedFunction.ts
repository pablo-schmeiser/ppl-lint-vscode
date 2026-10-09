import type { FunctionSignature } from './functionSignatures';

export interface DocumentedFunction {
  name: string;
  category: string;
  path: string;
  description: string;
  signatures: FunctionSignature[];
  syntax?: string[];
  examples: string[];
}