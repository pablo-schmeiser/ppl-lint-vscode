# Contributing to PPL VSCode Linter

Thank you for your interest in contributing to **`ppl-lint-vscode`**! This document details how to set up your local development environment, build the extension, run tests, and contribute new lint rules or format extractors.

---

## 1. Quickstart Development Setup

### Prerequisites

- **Node.js**: Version 18 or higher (`node -v`)
- **Package Manager**: `pnpm` (or `npm`)
- **Visual Studio Code**: Version 1.85+

### Getting Started

```bash
# 1. Clone the repository
git clone https://github.com/pablo-schmeiser/ppl-lint-vscode.git
cd ppl-lint-vscode

# 2. Install dependencies
pnpm install

# 3. Start bundling in watch mode
pnpm run watch
```

### Launching Extension Development Host

1. Open the project in VS Code.
2. Press `F5` (or select **Run Extension** in the Run & Debug view).
3. A new VS Code Extension Development Host window will launch with the extension active.

---

## 2. Running Tests & Quality Checks

```bash
# Run unit and integration tests
pnpm test

# Run tests in interactive watch mode
pnpm run test:watch

# Generate test coverage report
pnpm run test:coverage

# TypeScript compile check
pnpm run compile

# ESLint code linting
pnpm run lint
```

---

## 3. Tutorial: How to Add a New PPL Lint Rule

1. **Create the rule file** in `src/core/rules/ppl00X_<rule_name>.ts`:

   ```typescript
   import { LintRule, PipelineNode, RuleContext } from '../../types';

   export const PPL00X_MyNewRule: LintRule = {
     id: 'PPL00X',
     name: 'MyNewRule',
     description: 'Detailed explanation of what the rule checks.',
     defaultSeverity: 'warning',
     check(ast: PipelineNode, context: RuleContext): void {
       // Traverse AST nodes (ast.stages, expressions)
       for (const stage of ast.stages) {
         if (/* condition */) {
           context.report({
             code: 'PPL00X',
             message: 'Explanation of error or warning.',
             severity: 'warning',
             span: stage.span,
             data: {
               suggestion: 'fix_text',
             },
           });
         }
       }
     },
   };
   ```

2. **Register the rule** in `src/core/rules/registry.ts`:

   ```typescript
   import { PPL00X_MyNewRule } from './ppl00X_my_new_rule';
   // In RuleRegistry constructor:
   this.register(PPL00X_MyNewRule);
   ```

3. **Add rule unit tests** in `test/unit/rules.test.ts`.

4. **Update package.json configuration**:
   Add rule default severity to `contributes.configuration.properties["pplLinter.rules"]`.

---

## 4. Tutorial: How to Add a New Structured Extractor

1. Implement the `StructuredExtractor` interface in `src/extractors/<format>.ts`:

   ```typescript
   import { ExtractedQuery, StructuredExtractor } from '../types';

   export class MyFormatExtractor implements StructuredExtractor {
     public format: 'myformat' = 'myformat';

     public extract(
       documentText: string,
       keyPatterns: string[],
       heuristic: boolean
     ): ExtractedQuery[] {
       // Parse format AST/CST
       // Build LineOffsetSourceMap for each extracted query
       return [];
     }
   }
   ```

2. Register the extractor in `src/extractors/extractor.ts`.
3. Add unit tests in `test/unit/extractors.test.ts`.

---

## 5. Pull Request Guidelines

- **Fork & Branch**: Work in a descriptive feature branch (`feature/ppl008-rule` or `fix/yaml-indent`).
- **Tests Required**: All new functionality must include unit or integration tests.
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/#summary):
  - `feat: add PPL008 rule for ...`
  - `fix: handle folded scalar chomp indicators`
  - `docs: update configuration table in README`
- **Review**: Open a PR against `main`. All CI checks must pass before merging.
