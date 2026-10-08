---
name: run-tests
description: Executes the project's Vitest test suite and reports the results.
---

# Run Tests Skill

## Instructions
1. Determine the scope of tests to run based on the user's request (e.g., standard, conformance, or coverage).
2. Execute the appropriate command:
   - Standard: `pnpm test`
   - Conformance: `pnpm test:conformance`
   - Coverage: `pnpm test:coverage`
   - Thorough (CI simulation): `pnpm test:thorough`
3. If tests fail, analyze the output, identify the failing tests, and propose a fix.
4. Provide a summary of the test execution results to the user.
