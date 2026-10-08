# Contribution Guide

Thank you for considering contributing to NestJS Myanmar Payments! Please review the following guidelines before submitting a pull request.

For significant changes, please open an issue first so we can discuss the approach.

## Process

1. Fork the project
2. Create a new branch
3. Code, test, commit, and push
4. Open a pull request detailing your changes

## Guidelines

- This package only wraps `@laranex/myanmar-payments`. Gateway logic (validation, signing, status maps, amounts) belongs in [node-myanmar-payments](https://github.com/laranex/node-myanmar-payments), not here.
- Keep the module working on NestJS 10, 11 and 12, on both the Express and the Fastify adapter; test both.
- Keep test coverage at 100%.
- Send a coherent commit history, making sure each commit in your pull request is meaningful.
- You may need to [rebase](https://git-scm.com/book/en/v2/Git-Branching-Rebasing) to avoid merge conflicts.
- Please remember that we follow [SemVer](http://semver.org/).

## Setup

Node.js 20 or higher is the only requirement:

```bash
npm install
```

To test another NestJS major, install it without saving, for example:

```bash
npm install --no-save @nestjs/common@11 @nestjs/core@11 @nestjs/testing@11 @nestjs/platform-express@11 @nestjs/platform-fastify@11 @nestjs/config@4 @nestjs/cache-manager@3
```

## Lint

```bash
npm run lint
npm run typecheck
```

## Tests

```bash
npm run test:coverage
npm run build && npm run test:dist && npm run check:package
```
