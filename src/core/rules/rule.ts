import {
  CoreDiagnostic,
  DiagnosticSeverity,
  PplLinterOptions,
  RuleContext,
} from '../../types';

export function levenshtein(a: string, b: string): number {
  const an = a.length;
  const bn = b.length;
  if (an === 0) return bn;
  if (bn === 0) return an;

  const matrix: number[][] = [];
  for (let i = 0; i <= bn; ++i) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= an; ++j) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bn; ++i) {
    for (let j = 1; j <= an; ++j) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[bn][an];
}

export function findClosestMatch(
  target: string,
  candidates: string[],
  maxDistance = 3
): string | undefined {
  let closest: string | undefined = undefined;
  let minDistance = maxDistance + 1;

  for (const candidate of candidates) {
    const dist = levenshtein(target.toLowerCase(), candidate.toLowerCase());
    if (dist <= maxDistance && dist < minDistance) {
      minDistance = dist;
      closest = candidate;
    }
  }

  return closest;
}

export class DefaultRuleContext implements RuleContext {
  public readonly diagnostics: CoreDiagnostic[] = [];

  constructor(private readonly options: PplLinterOptions = {}) {}

  public getSeverity(ruleId: string): DiagnosticSeverity {
    if (this.options.rules?.[ruleId] !== undefined) {
      return this.options.rules[ruleId];
    }
    return 'error';
  }

  public report(diagnostic: CoreDiagnostic): void {
    const configuredSeverity = this.options.rules?.[diagnostic.code];

    if (configuredSeverity === 'off') {
      return;
    }

    const finalSeverity: 'error' | 'warning' | 'info' =
      configuredSeverity === 'error' ||
      configuredSeverity === 'warning' ||
      configuredSeverity === 'info'
        ? configuredSeverity
        : diagnostic.severity;

    this.diagnostics.push({
      ...diagnostic,
      severity: finalSeverity,
    });
  }
}
