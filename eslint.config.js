import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['dist/', 'coverage/', 'test-results/', 'playwright-report/', 'plugin/runtime/', 'test/fixtures/']),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['src/**', 'test/**', 'scripts/**', '*.config.*'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['web/**'],
    languageOptions: { globals: globals.browser },
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
]);
