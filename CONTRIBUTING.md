# Contributing to GovRuntime

Thank you for your interest in contributing to GovRuntime!

## Developer Setup

GovRuntime is organized as a `pnpm` monorepo.

### Prerequisites

*   Node.js >= 20.0.0
*   pnpm >= 9.0.0

### Installation

Clone the repository and run:

```bash
pnpm install
```

### Building

To compile all TypeScript packages:

```bash
pnpm run build
```

### Running Tests

To run the unit tests:

```bash
pnpm run test
```

## Pull Request Guidelines

1.  **Ticket Scopes**: Ensure all changes are covered by an issue or ticket.
2.  **Linting & Testing**: Make sure `pnpm run build` and `pnpm run test` pass before submitting.
3.  **Documentation**: If you change configuration patterns or CLI options, update the corresponding `docs/` file.
4.  **No Scope Drift**: Keep your pull request focused on the issue it resolves.
