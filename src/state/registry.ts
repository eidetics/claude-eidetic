import fs from 'node:fs';
import path from 'node:path';
import { getRegistryPath } from '../paths.js';

type Registry = Record<string, string>;

function readRegistry(): Registry {
  const registryPath = getRegistryPath();
  try {
    const data = fs.readFileSync(registryPath, 'utf-8');
    return JSON.parse(data) as Registry;
  } catch {
    return {};
  }
}

function writeRegistry(registry: Registry): void {
  const registryPath = getRegistryPath();
  const dir = path.dirname(registryPath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
}

export function registerProject(absolutePath: string): void {
  const name = path.basename(absolutePath).toLowerCase();
  const registry = readRegistry();
  registry[name] = absolutePath;
  writeRegistry(registry);
}

export function resolveProject(project: string): string | undefined {
  const registry = readRegistry();
  return registry[project.toLowerCase()];
}

export function listProjects(): Registry {
  return readRegistry();
}

export function findProjectByPath(dir: string): string | undefined {
  const registry = readRegistry();
  const normalized = dir.replace(/\\/g, '/').toLowerCase();
  let best: string | undefined;
  for (const projPath of Object.values(registry)) {
    const normProj = projPath.replace(/\\/g, '/').toLowerCase();
    if (normalized === normProj || normalized.startsWith(normProj + '/')) {
      if (!best || projPath.length > best.length) best = projPath;
    }
  }
  return best;
}
