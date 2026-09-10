import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          allowExportNames: ['useBarRepository', 'useTutorial'],
        },
      ],
    },
  },
  {
    // The root block above applies `globals.browser` to every .ts/.tsx
    // file, but nothing under server/** runs in a browser — it is a plain
    // Node process (see server/tsconfig.json's DOM-free `lib`). Node
    // globals here, not browser ones.
    files: ['server/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
  },
)
