export type FileCategory = 'source' | 'test' | 'doc' | 'config' | 'generated';

/**
 * Classify a file by category based on its relative path.
 * First match wins.
 */
export function classifyFileCategory(relativePath: string): FileCategory {
  const normalized = relativePath.replace(/\\/g, '/');
  const segments = normalized.split('/');
  const filename = segments[segments.length - 1];
  const lower = normalized.toLowerCase();
  const filenameLower = filename.toLowerCase();

  // test
  if (
    lower.includes('/__tests__/') ||
    lower.includes('.test.') ||
    lower.includes('.spec.') ||
    lower.includes('_test.') ||
    lower.includes('_spec.') ||
    filenameLower.startsWith('test_') ||
    filenameLower.startsWith('test-')
  ) {
    return 'test';
  }

  // doc
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')).toLowerCase() : '';
  if (
    ['.md', '.mdx', '.rst', '.txt'].includes(ext) ||
    segments.some((s) => s.toLowerCase() === 'docs' || s.toLowerCase() === 'doc') ||
    /^readme/i.test(filename) ||
    /^changelog/i.test(filename) ||
    /^license/i.test(filename)
  ) {
    return 'doc';
  }

  // generated
  if (
    lower.includes('/dist/') ||
    lower.startsWith('dist/') ||
    lower.includes('/build/') ||
    lower.startsWith('build/') ||
    lower.includes('/generated/') ||
    lower.startsWith('generated/') ||
    lower.includes('.generated.') ||
    /\.[gG]\./.test(filename)
  ) {
    return 'generated';
  }

  // config
  if (isConfigFile(normalized, filename, ext, segments)) {
    return 'config';
  }

  return 'source';
}

function isConfigFile(
  normalized: string,
  filename: string,
  ext: string,
  segments: string[],
): boolean {
  const filenameLower = filename.toLowerCase();

  // Explicit filename matches
  if (filenameLower === 'package.json') return true;
  if (filenameLower === 'makefile') return true;
  if (filenameLower === 'dockerfile') return true;
  if (/^tsconfig.*\.json$/.test(filenameLower)) return true;
  if (filenameLower.startsWith('docker-compose')) return true;
  if (filenameLower.startsWith('.eslintrc')) return true;
  if (filenameLower.startsWith('.prettierrc')) return true;

  // *.config.* pattern
  if (filename.includes('.config.')) return true;

  // .yaml/.yml/.toml not under src/
  if (['.yaml', '.yml', '.toml'].includes(ext)) {
    const underSrc = segments.some((s) => s.toLowerCase() === 'src');
    if (!underSrc) return true;
  }

  return false;
}
