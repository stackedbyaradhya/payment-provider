module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: [
    '@typescript-eslint/eslint-plugin',
    'simple-import-sort',
    'unused-imports',
    'no-relative-import-paths',
  ],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.cjs', 'dist', 'coverage', 'node_modules'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'warn',
    // `unused-imports` plugin replaces the unused-vars rule so unused
    // imports are auto-removable on `--fix` instead of just warned about.
    '@typescript-eslint/no-unused-vars': 'off',
    'unused-imports/no-unused-imports': 'error',
    'unused-imports/no-unused-vars': [
      'warn',
      {
        vars: 'all',
        varsIgnorePattern: '^_',
        args: 'after-used',
        argsIgnorePattern: '^_',
      },
    ],
    // simple-import-sort groups imports automatically:
    //   1. side-effect imports (e.g. `import 'reflect-metadata'`)
    //   2. node built-ins
    //   3. external packages
    //   4. internal absolute paths
    //   5. parent (`../`) imports
    //   6. sibling/local (`./`) imports
    // Within each group, sorted alphabetically. Fixed by `--fix`.
    'simple-import-sort/imports': [
      'error',
      {
        groups: [
          ['^\\u0000'],
          ['^node:'],
          ['^@?\\w'],
          ['^(@/|src/)'],
          ['^\\.\\.'],
          ['^\\.'],
        ],
      },
    ],
    'simple-import-sort/exports': 'error',
    // Rewrite `../../foo/bar` parent-relative imports to `@/foo/bar`. Sibling
    // imports stay as `./foo` because "same folder" is useful signal in a
    // layered codebase.
    'no-relative-import-paths/no-relative-import-paths': [
      'error',
      { allowSameFolder: true, rootDir: 'src', prefix: '@' },
    ],
  },
};
