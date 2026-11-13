import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stub = join(root, 'devtools', 'sdk-stub.ts');

const suites = [
  { entry: 'devtools/agg-test.ts', label: '汇总口径' },
  { entry: 'devtools/filter-test.ts', label: '筛选条件' },
  { entry: 'devtools/pipe-test.ts', label: '读取通路' },
  { entry: 'devtools/config-test.ts', label: '仪表盘配置' },
  { entry: 'devtools/render-test.tsx', label: '界面渲染' },
];

let failed = 0;
for (const suite of suites) {
  const outfile = join(root, `.tmp-${suite.entry.replace(/\W+/g, '-')}.mjs`);
  console.log(`\n===== ${suite.label}（${suite.entry}）=====`);
  await build({
    absWorkingDir: root,
    entryPoints: [suite.entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    // react 交给 node 解析：react-dom/server 依赖 node 内置模块，打进 bundle 会坏
    packages: 'external',
    jsx: 'automatic',
    alias: { '@lark-base-open/js-sdk': stub },
    outfile,
    logLevel: 'warning',
  });
  const result = spawnSync(process.execPath, [outfile], { stdio: 'inherit' });
  rmSync(outfile, { force: true });
  if (result.status !== 0) failed++;
}

console.log(`\n${failed ? `${failed} 个套件失败` : '全部套件通过'}`);
process.exitCode = failed ? 1 : 0;
