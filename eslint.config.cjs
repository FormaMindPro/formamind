// The protocol's ESLint - engine development only, never installed into projects (package.json, "files").
// Minimal rules: the goal is a baseline for a refactoring series, not fixing.
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'test/.baseline/**',
      '**/skill-creator/**',        // vendor code, from anthropics/skills
      'skills/forma/adapters/codex/**', // the Codex zone
      'skills/forma/adapters/gemini/**', // the Gemini zone
      'skills/forma/adapters/minimax/**', // the MiniMax zone
    ],
  },
  {
    files: ['**/*.{js,cjs}'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['**/*.{js,cjs,mjs}'],
    rules: {
      'no-unused-vars': ['warn', { args: 'after-used', caughtErrors: 'none' }],
      'no-empty': 'warn',
      'max-lines-per-function': ['warn', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-params': ['warn', 4],
    },
  },
  {
    // Browser scripts of the dashboard: classic <script src> in one global scope, no modules.
    // Another file calls a top-level function; the linter cannot see that, so "unused" counts only inside functions.
    files: ['skills/forma/core/dashboard/web/js/*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, marked: 'readonly' } },
    rules: { 'no-unused-vars': ['warn', { vars: 'local', args: 'after-used', caughtErrors: 'none' }] },
  },
];
