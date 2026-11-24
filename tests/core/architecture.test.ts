import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, test } from 'vitest';

const CORE_DIR = path.resolve(process.cwd(), 'src/core');

function collectTsFiles(dir: string, prefix = ''): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...collectTsFiles(path.join(dir, entry.name), rel));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(rel);
  }
  return files.sort();
}

function runtimeCoreImports(file: string, known: ReadonlySet<string>): string[] {
  const source = readFileSync(path.join(CORE_DIR, file), 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
  const targets = new Set<string>();
  const dir = path.posix.dirname(file);

  const resolveLocal = (spec: string): string | null => {
    if (!spec.startsWith('.')) return null;
    const joined = path.posix.normalize(dir === '.' ? spec : `${dir}/${spec}`).replace(/\.js$/, '.ts');
    return known.has(joined) ? joined : null;
  };

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      if (clause?.isTypeOnly) continue;
      if (clause && !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        if (clause.namedBindings.elements.every(el => el.isTypeOnly)) continue;
      }
      const target = resolveLocal(stmt.moduleSpecifier.text);
      if (target) targets.add(target);
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      if (stmt.isTypeOnly) continue;
      if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        if (stmt.exportClause.elements.every(el => el.isTypeOnly)) continue;
      }
      const target = resolveLocal(stmt.moduleSpecifier.text);
      if (target) targets.add(target);
    }
  }
  return [...targets].sort();
}

function findRuntimeCycles(files: readonly string[]): { selfLoops: string[]; sccs: string[][] } {
  const known = new Set(files);
  const edges = new Map<string, string[]>();
  const selfLoops: string[] = [];
  for (const file of files) {
    const deps = runtimeCoreImports(file, known);
    if (deps.includes(file)) selfLoops.push(file);
    edges.set(file, deps);
  }
  let nextIndex = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const sccs: string[][] = [];

  const strongConnect = (v: string) => {
    indices.set(v, nextIndex);
    lowlink.set(v, nextIndex);
    nextIndex++;
    stack.push(v);
    onStack.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }
    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      for (;;) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      if (scc.length > 1) sccs.push(scc.sort());
    }
  };

  for (const file of files) if (!indices.has(file)) strongConnect(file);
  return { selfLoops, sccs };
}

describe('src/core architecture invariants', () => {
  test('src/core has zero runtime circular dependencies (SCC size === 1 and no self-loops)', () => {
    const files = collectTsFiles(CORE_DIR);
    expect(files.length).toBeGreaterThan(20);
    const { selfLoops, sccs } = findRuntimeCycles(files);
    expect(selfLoops).toEqual([]);
    expect(sccs).toEqual([]);
  });
});
