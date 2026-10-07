/**
 * 本地库逻辑测试运行器（无需浏览器）：
 * 用 esbuild 把 scripts/*.ts 打包成临时 ESM，再交给 Node（fake-indexeddb）执行。
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const cases = ['scripts/test-marks.ts', 'scripts/test-migration-v3.ts'];

for (const entry of cases) {
  const outfile = resolve(root, entry.replace(/^scripts\//, 'scripts/.').replace(/\.ts$/, '.mjs'));
  await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    logLevel: 'warning',
  });
  try {
    execFileSync(process.execPath, [outfile], { stdio: 'inherit', cwd: root });
  } finally {
    rmSync(outfile, { force: true });
  }
}

console.log('\n全部本地库测试完成 ✅');
