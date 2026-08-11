import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.expo/**', '**/.next/**', '**/coverage/**'] },
  ...tseslint.configs.strictTypeChecked,
  {
    files: ['apps/**/*.{ts,tsx}', 'packages/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error'
    }
  }
)

