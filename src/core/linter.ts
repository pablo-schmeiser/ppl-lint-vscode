import {
  CoreDiagnostic,
  JoinStageNode,
  PipelineNode,
  PplLinterOptions,
} from '../types';
import { parsePpl } from './parser/parser';
import { defaultRuleRegistry, RuleRegistry } from './rules/registry';
import { DefaultRuleContext } from './rules/rule';
import { applyCompatibilityExceptions, BASELINE_VERSION, compareVersions, parseOpenSearchVersion } from './compatibility';

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
    const requested = this.options.openSearchVersion || '3.5';
    const version = parseOpenSearchVersion(requested);
    if (!version || compareVersions(version, BASELINE_VERSION) < 0) {
      context.report({
        code: 'PPL010',
        message: `Unsupported OpenSearch version '${requested}'. Select version 3.5 or later.`,
        severity: 'error',
        span: ast.source.span,
      });
      return context.diagnostics;
    }
    if (compareVersions(version, BASELINE_VERSION) > 0) {
      context.report({
        code: 'PPL009',
        message: `OpenSearch ${requested} is not verified; using the 3.5 validation baseline.`,
        severity: 'warning',
        span: ast.source.span,
      });
    }

    this.checkPipeline(ast, context);

    applyCompatibilityExceptions(ast, context, version);

    return context.diagnostics;
  }

  private checkPipeline(ast: PipelineNode, context: DefaultRuleContext): void {
    for (const rule of this.registry.getAll()) rule.check(ast, context);
    for (const stage of ast.stages) {
      if (stage.type === 'JoinStage') {
        const dataset = (stage as JoinStageNode).dataset;
        if (dataset?.type === 'Pipeline') this.checkPipeline(dataset, context);
      }
    }
  }
}
