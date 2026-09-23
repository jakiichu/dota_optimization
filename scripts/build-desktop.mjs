import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildVersion } from './version.mjs';
import { desktopIcon } from './desktop-icons.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'build', 'desktop');
const assets = join(out, 'assets');
mkdirSync(assets, { recursive: true });
const ui = spawnSync('npm.cmd', ['run', 'ui:build'], { cwd: root, shell: true, stdio: 'inherit' });
if (ui.status !== 0) process.exit(ui.status ?? 1);
for (const name of ['main', 'preload'])
  await build({
    entryPoints: [join(root, 'desktop', `${name}.ts`)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    outfile: join(out, `${name}.cjs`),
  });
await build({
  entryPoints: [join(root, 'src/main/server.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: join(out, 'backend.cjs'),
  define: { KADROSKOP_PACKAGED: 'true', KADROSKOP_VERSION: JSON.stringify(buildVersion()) },
  logOverride: { 'empty-import-meta': 'silent' },
});
cpSync(join(root, 'web/dist'), join(assets, 'web'), { recursive: true });
cpSync(
  join(root, 'src/infrastructure/windows/collect-snapshot.ps1'),
  join(assets, 'collect-snapshot.ps1'),
);
if (existsSync(join(root, 'sidecar/bin')))
  cpSync(join(root, 'sidecar/bin'), assets, { recursive: true });
const pm = join(root, 'tools/presentmon/PresentMon.exe');
if (existsSync(pm)) cpSync(pm, join(assets, 'PresentMon.exe'));
writeFileSync(join(assets, 'icon.png'), desktopIcon());
writeFileSync(join(assets, 'recording.png'), desktopIcon(true));
writeFileSync(
  join(out, 'package.json'),
  JSON.stringify(
    { name: 'kadroskop', productName: 'Кадроскоп', version: '0.1.0', main: 'main.cjs' },
    null,
    2,
  ),
);
process.stdout.write(`Настольная оболочка собрана: ${out}\n`);
