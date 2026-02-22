import { describe, it, expect } from 'vitest';
import { classifyFileCategory } from '../core/file-category.js';

describe('classifyFileCategory', () => {
  describe('test files', () => {
    it('classifies __tests__ directory', () => {
      expect(classifyFileCategory('src/__tests__/foo.ts')).toBe('test');
    });

    it('classifies .test. files', () => {
      expect(classifyFileCategory('src/core/searcher.test.ts')).toBe('test');
    });

    it('classifies .spec. files', () => {
      expect(classifyFileCategory('src/core/searcher.spec.ts')).toBe('test');
    });

    it('classifies _test. files', () => {
      expect(classifyFileCategory('src/core/searcher_test.ts')).toBe('test');
    });

    it('classifies test_ prefix files', () => {
      expect(classifyFileCategory('src/test_helpers.py')).toBe('test');
    });

    it('classifies test- prefix files', () => {
      expect(classifyFileCategory('src/test-utils.ts')).toBe('test');
    });
  });

  describe('doc files', () => {
    it('classifies .md files', () => {
      expect(classifyFileCategory('README.md')).toBe('doc');
    });

    it('classifies .mdx files', () => {
      expect(classifyFileCategory('docs/guide.mdx')).toBe('doc');
    });

    it('classifies .rst files', () => {
      expect(classifyFileCategory('docs/api.rst')).toBe('doc');
    });

    it('classifies .txt files', () => {
      expect(classifyFileCategory('notes.txt')).toBe('doc');
    });

    it('classifies files in docs/ directory', () => {
      expect(classifyFileCategory('docs/setup.ts')).toBe('doc');
    });

    it('classifies files in doc/ directory', () => {
      expect(classifyFileCategory('doc/api.ts')).toBe('doc');
    });

    it('classifies README* files', () => {
      expect(classifyFileCategory('README')).toBe('doc');
      expect(classifyFileCategory('README.txt')).toBe('doc');
    });

    it('classifies CHANGELOG* files', () => {
      expect(classifyFileCategory('CHANGELOG.md')).toBe('doc');
    });

    it('classifies LICENSE* files', () => {
      expect(classifyFileCategory('LICENSE')).toBe('doc');
    });
  });

  describe('generated files', () => {
    it('classifies dist/ files', () => {
      expect(classifyFileCategory('dist/index.js')).toBe('generated');
    });

    it('classifies build/ files', () => {
      expect(classifyFileCategory('build/output.js')).toBe('generated');
    });

    it('classifies generated/ files', () => {
      expect(classifyFileCategory('src/generated/schema.ts')).toBe('generated');
    });

    it('classifies .generated. files', () => {
      expect(classifyFileCategory('src/types.generated.ts')).toBe('generated');
    });
  });

  describe('config files', () => {
    it('classifies package.json', () => {
      expect(classifyFileCategory('package.json')).toBe('config');
    });

    it('classifies tsconfig.json', () => {
      expect(classifyFileCategory('tsconfig.json')).toBe('config');
    });

    it('classifies tsconfig.base.json', () => {
      expect(classifyFileCategory('tsconfig.base.json')).toBe('config');
    });

    it('classifies *.config.* files', () => {
      expect(classifyFileCategory('vitest.config.ts')).toBe('config');
      expect(classifyFileCategory('webpack.config.js')).toBe('config');
    });

    it('classifies Makefile', () => {
      expect(classifyFileCategory('Makefile')).toBe('config');
    });

    it('classifies Dockerfile', () => {
      expect(classifyFileCategory('Dockerfile')).toBe('config');
    });

    it('classifies docker-compose files', () => {
      expect(classifyFileCategory('docker-compose.yml')).toBe('config');
    });

    it('classifies .eslintrc files', () => {
      expect(classifyFileCategory('.eslintrc.js')).toBe('config');
    });

    it('classifies .prettierrc files', () => {
      expect(classifyFileCategory('.prettierrc')).toBe('config');
    });

    it('classifies top-level .yaml files', () => {
      expect(classifyFileCategory('messages.yaml')).toBe('config');
    });

    it('classifies top-level .yml files', () => {
      expect(classifyFileCategory('ci.yml')).toBe('config');
    });

    it('does NOT classify .yaml files under src/ as config', () => {
      // yaml under src/ is source (not config)
      expect(classifyFileCategory('src/data/schema.yaml')).toBe('source');
    });
  });

  describe('source files', () => {
    it('classifies regular TS files', () => {
      expect(classifyFileCategory('src/core/searcher.ts')).toBe('source');
    });

    it('classifies regular JS files', () => {
      expect(classifyFileCategory('src/index.js')).toBe('source');
    });

    it('classifies Python source files', () => {
      expect(classifyFileCategory('src/main.py')).toBe('source');
    });

    it('classifies nested source files', () => {
      expect(classifyFileCategory('src/vectordb/qdrant.ts')).toBe('source');
    });
  });
});
