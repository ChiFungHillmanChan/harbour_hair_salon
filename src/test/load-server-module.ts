import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

/** Execute the real server module with only its I/O imports replaced. */
export function loadServerModule<T>(path: string, dependencies: Record<string, unknown>): T {
  const filename = resolve(process.cwd(), path);
  const require = createRequire(filename);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const loadedModule = { exports: {} };
  const dependency = (name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    return require(name.startsWith('@/') ? resolve(process.cwd(), 'src', name.slice(2)) : name);
  };
  new Function('require', 'module', 'exports', output)(dependency, loadedModule, loadedModule.exports);
  return loadedModule.exports as T;
}
