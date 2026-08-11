/**
 * Project Bootstrap - RFC-0072
 *
 * Node.js + TypeScript template
 */

import type { ProjectSpec, Template } from './types.js';

export const nodeTypescriptTemplate: Template = {
  name: 'node-typescript',
  description: 'Node.js + TypeScript + ESLint + Jest',
  async apply(spec: ProjectSpec, root: string): Promise<string[]> {
    const { writeFile, mkdir } = await import('fs/promises');
    const { join } = await import('path');

    const files: string[] = [];

    // package.json
    const packageJson = {
      name: spec.name,
      version: '0.1.0',
      description: spec.description || '',
      type: 'module',
      scripts: {
        build: 'tsc',
        test: 'jest',
        lint: 'eslint src --ext .ts',
        'typecheck': 'tsc --noEmit',
      },
      dependencies: {},
      devDependencies: {
        typescript: '^5.4.0',
        '@types/node': '^20.0.0',
        jest: '^29.7.0',
        '@types/jest': '^29.5.0',
        tsj: '^4.0.0',
        eslint: '^8.57.0',
        '@typescript-eslint/parser': '^6.0.0',
        '@typescript-eslint/eslint-plugin': '^6.0.0',
      },
    };

    await writeFile(join(root, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
    files.push('package.json');

    // tsconfig.json
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        lib: ['ES2022'],
        outDir: './dist',
        rootDir: './src',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
        declaration: true,
        declarationMap: true,
        sourceMap: true,
      },
      include: ['src/**/*'],
      exclude: ['node_modules', 'dist'],
    };

    await writeFile(join(root, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2) + '\n');
    files.push('tsconfig.json');

    // jest.config.js
    const jestConfig = `export default {
  preset: 'tsj',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.ts$': ['tsj', { useESM: true }],
  },
};
`;
    await writeFile(join(root, 'jest.config.js'), jestConfig);
    files.push('jest.config.js');

    // src directory
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(join(root, 'src/index.ts'), 'export const main = () => {\n  console.log("Hello!");\n};\n');
    files.push('src/index.ts');

    // .eslintrc.cjs
    const eslintConfig = `module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parserOptions: {
    ecmaVersion: 'latest',
  },
};
`;
    await writeFile(join(root, '.eslintrc.cjs'), eslintConfig);
    files.push('.eslintrc.cjs');

    return files;
  },
};
