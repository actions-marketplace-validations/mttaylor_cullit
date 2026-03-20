const js = require('@eslint/js');
const globals = require('globals');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'site/**', '**/*.js', '**/*.cjs', '**/*.mjs'],
  },
  {
    files: ['packages/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        ...globals.node,
        ...globals.es2022,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-undef': 'off',
      'preserve-caught-error': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['packages/**/__tests__/**/*.ts', 'packages/**/*.test.ts', 'src/**/*.test.ts'],
    rules: {
      // Keep runtime code strict; allow test fixtures/mocks to be pragmatic.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    files: ['packages/config/src/**/*.ts'],
    rules: {
      // Config parsing consumes untyped user YAML/JSON; strict narrowing here is low ROI.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['packages/core/src/registry.ts'],
    rules: {
      // Registry factory signatures intentionally accept plugin-specific constructors.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];