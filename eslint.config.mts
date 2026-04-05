import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import globals from 'globals';
import tsParser from '@typescript-eslint/parser';

export default defineConfig([
    {
        files: ['src/**/*.{ts,tsx,js,jsx}'],
        languageOptions: {
            parser: tsParser,
            globals: {
                ...globals.browser,
                ...globals.node,
            },
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
                ecmaFeatures: {
                    jsx: true,
                },
            },
        },
        ...js.configs.recommended,
        rules: {
            'no-console': 'off',
            'no-undef': 'off',
        },
    },
]);
