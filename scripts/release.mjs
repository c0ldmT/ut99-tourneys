#!/usr/bin/env node
/* global process, console */
// Builds a release bundle: release/tourney-<version>.tar.gz (and .zip if `zip` exists).
//
// The bundle runs on any OS/CPU with Node >= 22.12: the website and the bridge are bundled
// JavaScript (workspace packages included); their npm dependencies are installed on the target
// with `npm ci --omit=dev` (native modules such as better-sqlite3 then match the target CPU).
//
// Usage: pnpm release            (builds everything first)
//        pnpm release --no-build (uses the existing dist/ folders)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = rootPkg.version;
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version ?? ''))
  throw new Error('package.json needs a version');
const name = `tourney-${version}`;
const outRoot = path.join(root, 'release');
const out = path.join(outRoot, name);

// npm/pnpm are .cmd files on Windows and need a shell there.
const run = (cmd, args, cwd = root) =>
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
const copy = (from, to, filter) =>
  fs.cpSync(path.join(root, from), path.join(out, to), { recursive: true, filter });
const write = (to, content) => {
  fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true });
  fs.writeFileSync(path.join(out, to), content);
};
const noMaps = (src) => !src.endsWith('.map');

if (!process.argv.includes('--no-build')) run('pnpm', ['build']);
for (const f of ['apps/api/dist/main.js', 'apps/web/dist/index.html', 'apps/bridge/dist/cli.js'])
  if (!fs.existsSync(path.join(root, f))) throw new Error(`${f} is missing: run pnpm build`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

/** package.json for a bundled app: only the npm dependencies (workspace packages are inside). */
function appPackage(app, packageName, extra) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, app, 'package.json'), 'utf8'));
  // The versions the tests ran with (from node_modules), not just the ranges.
  const installed = (dep) =>
    JSON.parse(fs.readFileSync(path.join(root, app, 'node_modules', dep, 'package.json'), 'utf8'))
      .version;
  const deps = Object.fromEntries(
    Object.entries(pkg.dependencies ?? {})
      .filter(([, v]) => !String(v).startsWith('workspace:'))
      .map(([dep]) => [dep, installed(dep)]),
  );
  return {
    name: packageName,
    version,
    private: true,
    description: pkg.description,
    license: rootPkg.license,
    type: 'module',
    engines: rootPkg.engines,
    dependencies: deps,
    ...extra,
  };
}

// Website: API bundle + Angular app (served by the API from website/web).
copy('apps/api/dist', 'website/dist', noMaps);
copy('apps/web/dist', 'website/web');
copy('apps/api/.env.example', 'website/.env.example');
write(
  'website/package.json',
  JSON.stringify(
    appPackage('apps/api', 'tourney-website', { scripts: { start: 'node dist/main.js' } }),
    null,
    2,
  ) + '\n',
);

// Bridge.
copy('apps/bridge/dist', 'bridge/dist', (src) => noMaps(src) && !src.endsWith('.d.ts'));
copy('deploy/bridge.example.json', 'bridge/bridge.example.json');
write(
  'bridge/package.json',
  JSON.stringify(
    appPackage('apps/bridge', 'tourney-bridge', { scripts: { start: 'node dist/cli.js' } }),
    null,
    2,
  ) + '\n',
);

// Lock files, so every installation gets the same dependency versions.
for (const app of ['website', 'bridge'])
  run(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    path.join(out, app),
  );

// Mod sources and build scripts (compiled with ucc on the server, see mod/README.md).
copy(
  'mods/ut99-tournament',
  'mod',
  (src) =>
    !/^(build|System)$|[\\/](build|System)([\\/]|$)/.test(
      path.relative(path.join(root, 'mods/ut99-tournament'), src),
    ),
);
copy('deploy', 'deploy', (src) => !src.endsWith('bridge.example.json'));
copy('docs', 'docs');
// The guides link to the app READMEs: ship them and point the links at their place in the bundle.
copy('apps/api/README.md', 'website/README.md');
copy('apps/bridge/README.md', 'bridge/README.md');
for (const f of fs.readdirSync(path.join(out, 'docs')).filter((f) => f.endsWith('.md'))) {
  const file = path.join(out, 'docs', f);
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, 'utf8')
      .replaceAll('../apps/api/README.md', '../website/README.md')
      .replaceAll('../apps/bridge/README.md', '../bridge/README.md'),
  );
}
copy('LICENSE', 'LICENSE');
write('VERSION', `${version}\n`);
write(
  'README.md',
  `# Tourney ${version}

UT99 (469f) tournament platform: website, bridge agent and game mod.

| Folder     | What                                                                 |
| ---------- | -------------------------------------------------------------------- |
| \`website/\` | Website (API + web app). Node >= 22.12, \`npm ci --omit=dev\` once     |
| \`bridge/\`  | Bridge agent next to the UT server                                   |
| \`mod/\`     | UnrealScript sources and build scripts (\`build.sh\` / \`build.ps1\`)    |
| \`deploy/\`  | Install scripts (Linux, Raspberry Pi, Windows), systemd units, Caddy |
| \`docs/\`    | Installation guides and technical documentation                      |

Installation:

- Raspberry Pi: [docs/install-raspberry-pi.md](docs/install-raspberry-pi.md)
- Linux server: [docs/install-linux.md](docs/install-linux.md)
- Windows server: [docs/install-windows.md](docs/install-windows.md)
`,
);

// Archives.
fs.rmSync(path.join(outRoot, `${name}.tar.gz`), { force: true });
run('tar', ['-czf', `${name}.tar.gz`, name], outRoot);
try {
  execFileSync('zip', ['-v'], { stdio: 'ignore' });
  fs.rmSync(path.join(outRoot, `${name}.zip`), { force: true });
  run('zip', ['-qr', `${name}.zip`, name], outRoot);
} catch {
  console.log('zip not found: only the .tar.gz was created (Windows 10+ can unpack it with tar)');
}
console.log(`\nrelease/${name}.tar.gz`);
