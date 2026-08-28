module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'react', 'react-hooks'],
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        'plugin:react/recommended',
        'plugin:react-hooks/recommended',
    ],
    settings: {
        react: {
            version: 'detect',
        },
    },
    env: {
        node: true,
        es2022: true,
    },
    rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/no-explicit-any': 'warn',
    },
    overrides: [
        {
            // Renderer-specific rules: BLOCK backend imports
            files: ['apps/renderer/**/*.ts', 'apps/renderer/**/*.tsx'],
            rules: {
                'no-restricted-imports': [
                    'error',
                    {
                        patterns: [
                            {
                                group: ['@backend/*', '../../../packages/backend/*'],
                                message: 'Renderer MUST NOT import backend packages. Use IPC contracts from @shared instead.',
                            },
                        ],
                    },
                ],
            },
            env: {
                browser: true,
                node: false,
            },
        },
        {
            // Desktop app can import everything
            files: ['apps/desktop/**/*.ts'],
            env: {
                node: true,
                browser: false,
            },
        },
    ],
};
