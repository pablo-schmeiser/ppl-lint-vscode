import { DefaultRuleContext } from './rules/rule';
import { PipelineNode } from '../types';

export interface OpenSearchVersion {
  major: number;
  minor: number;
  patch: number;
}

export const BASELINE_VERSION: OpenSearchVersion = { major: 3, minor: 5, patch: 0 };

export function parseOpenSearchVersion(value: string): OpenSearchVersion | undefined {
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return undefined;
  const version = { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0) };
  return Object.values(version).every(Number.isSafeInteger) ? version : undefined;
}

export function compareVersions(left: OpenSearchVersion, right: OpenSearchVersion): number {
  return left.major - right.major || left.minor - right.minor || left.patch - right.patch;
}

export interface CompatibilityException {
  id: string;
  firstAffected: OpenSearchVersion;
  lastAffected: OpenSearchVersion;
  reproducer: string;
  reference: string;
  check(ast: PipelineNode, context: DefaultRuleContext): void;
}

export const verifiedExceptions: readonly CompatibilityException[] = [];

export function applyCompatibilityExceptions(
  ast: PipelineNode,
  context: DefaultRuleContext,
  version: OpenSearchVersion,
  exceptions: readonly CompatibilityException[] = verifiedExceptions
): void {
  for (const exception of exceptions) {
    if (compareVersions(version, exception.firstAffected) >= 0 &&
        compareVersions(version, exception.lastAffected) <= 0) {
      exception.check(ast, context);
    }
  }
}
