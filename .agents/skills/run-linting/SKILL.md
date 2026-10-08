---
name: run-linting
description: Runs the project's linter and compiler, and attempts to automatically fix issues.
---

# Run Linting Skill

## Instructions
1. Run `pnpm compile` to check for TypeScript compilation errors.
2. Run `pnpm lint` to check for ESLint violations.
3. If ESLint reports fixable errors, run `pnpm lint --fix` or equivalent to automatically correct them.
4. Report any remaining manual fixes needed to the user, or fix them yourself if requested.
