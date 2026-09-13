import { LintRule } from '../../types';
import { PPL001_SyntaxError } from './ppl001_syntax_error';
import { PPL002_MissingSource } from './ppl002_missing_source';
import { PPL003_UnknownCommand } from './ppl003_unknown_command';
import { PPL004_InvalidArguments } from './ppl004_invalid_arguments';
import { PPL005_UnknownFunction } from './ppl005_unknown_function';
import { PPL006_LateFilterWarning } from './ppl006_late_filter';
import { PPL007_AssignmentInCondition } from './ppl007_assignment_in_condition';

export class RuleRegistry {
  private rules: Map<string, LintRule> = new Map();

  constructor() {
    this.register(PPL001_SyntaxError);
    this.register(PPL002_MissingSource);
    this.register(PPL003_UnknownCommand);
    this.register(PPL004_InvalidArguments);
    this.register(PPL005_UnknownFunction);
    this.register(PPL006_LateFilterWarning);
    this.register(PPL007_AssignmentInCondition);
  }

  public register(rule: LintRule): void {
    this.rules.set(rule.id, rule);
  }

  public get(id: string): LintRule | undefined {
    return this.rules.get(id);
  }

  public getAll(): LintRule[] {
    return Array.from(this.rules.values());
  }
}

export const defaultRuleRegistry = new RuleRegistry();
