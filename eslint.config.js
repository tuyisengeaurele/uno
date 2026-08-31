import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      'pnpm-lock.yaml',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    // Config files and other plain scripts are not part of a tsconfig project.
    files: ['**/*.{js,cjs,mjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    // The engine is a pure library. Anything that reaches for the ambient clock
    // or RNG is a bug: those come in through the reducer context so games replay.
    files: ['packages/engine/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: 'Use ctx.rng. Math.random breaks deterministic replay.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: 'The engine does not read wall-clock time. Model timing as game events.',
        },
      ],
    },
  },
  {
    files: ['packages/**/*.ts'],
    ignores: ['**/*.test.ts', '**/__support__/**', '**/__scenarios__/**'],
    rules: {
      'no-console': 'error',
    },
  },
  {
    // Tests and their fixtures build deliberately partial data and lean on
    // known-good shapes. The strict null and unsafe-any rules get in the way
    // there without catching real bugs.
    files: ['**/*.test.ts', '**/__support__/**', '**/__scenarios__/**'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
  prettier,
);
