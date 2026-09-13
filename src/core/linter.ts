import {
  CoreDiagnostic,
  PipelineNode,
  PplLinterOptions,
} from '../types';
import { parsePpl } from './parser/parser';
import { defaultRuleRegistry, RuleRegistry } from './rules/registry';
import { DefaultRuleContext } from './rules/rule';

export class PplLinter {
  private readonly registry: RuleRegistry;

  constructor(
    private readonly options: PplLinterOptions = {},
    customRegistry?: RuleRegistry
  ) {
    this.registry = customRegistry || defaultRuleRegistry;
  }

  public lint(queryText: string): CoreDiagnostic[] {
    const ast = parsePpl(queryText);
    return this.lintAst(ast);
  }

  public lintAst(ast: PipelineNode): CoreDiagnostic[] {
    const context = new DefaultRuleContext(this.options);

    for (const rule of this.registry.getAll()) {
      rule.check(ast, context);
    }

    return context.diagnostics;
  }
}
