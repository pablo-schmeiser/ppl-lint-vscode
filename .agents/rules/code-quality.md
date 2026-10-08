# Code Quality Guidelines

When writing code or reviewing changes in this project, enforce the following code quality standards:

1. **Linting**:
   - Always run the linter to verify changes using `pnpm lint` (`eslint src`).
   - Fix all reported errors. 
   - No `any` types unless absolutely necessary.
2. **Compilation**:
   - Verify that the code compiles cleanly by running `pnpm compile` (`tsc -p ./ --noEmit`).
3. **TypeScript Conventions**:
   - Follow existing patterns in `src/`.
   - Prefer `const` over `let`, strict equality `===`, and modern ES/TypeScript features.
   - All asynchronous file system operations should use `fs/promises`.
