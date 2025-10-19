// eslint.config.js
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import pluginPrettier from 'eslint-plugin-prettier'
import { defineConfig } from 'eslint/config'

export default defineConfig([
  // JS + TS linting
  {
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      globals: globals.node,
    },
    plugins: {
      prettier: pluginPrettier,
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      prettier, // disables stylistic rules that conflict with Prettier
    ],
    rules: {
      // Let Prettier handle formatting
      'prettier/prettier': [
        'error',
        {
          singleQuote: true,
          semi: false,
          tabWidth: 2,
          trailingComma: 'es5',
          printWidth: 100,
          bracketSpacing: true,
          arrowParens: 'avoid',
        },
      ],

      // Optional: some extra quality-of-life rules
      'no-unused-vars': 'warn',
      'no-console': 'off',
    },
  },
])
