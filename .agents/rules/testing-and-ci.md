# Testing and CI Guidelines

1. **Testing Framework**:
   - This project uses `vitest`.
   - Tests are located in the `test/` directory.
   - When adding new features or fixing bugs, write or update corresponding tests.
2. **Running Tests**:
   - Run unit tests with `pnpm test`.
   - Run conformance tests with `pnpm test:conformance`.
   - Check test coverage with `pnpm test:coverage`.
3. **CI/CD**:
   - The CI pipeline runs `pnpm test:thorough` which includes auditing, compiling, linting, testing, and building.
   - Always ensure your changes pass `pnpm test:thorough` locally if simulating a full CI check.
