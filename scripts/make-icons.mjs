#!/usr/bin/env node
/* Rasterizes icons/icon.svg into the PNG sizes the manifest and iOS need.
   Build-time only; nothing here ships to the browser.
   Runs from anywhere:
     node scripts/make-icons.mjs
   Resolves Playwright explicitly via createRequire anchored at the pinned
   test toolchain's own package.json (reference/tests), instead of relying
   on ambient node_modules lookup from this file's directory: ESM bare-
   specifier resolution walks up from the importing file's own path, not
   from cwd, and scripts/ has no ancestor node_modules of its own. This
   needs no junction, symlink, or root-level node_modules, and works
   regardless of the directory it's run from. Requires that toolchain to
   be installed once (npm install inside reference/tests); if it isn't,
   this throws a clear error naming the fix instead of a bare
   module-not-found.
   The maskable variant insets the art to 80% because Android crops icons
   to a platform-chosen shape, and anything outside that circle is lost. */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let chromium;
try {
  const require = createRequire(path.join(root, 'reference', 'tests', 'package.json'));
  ({ chromium } = require('playwright'));
} catch (err) {
  throw new Error(
    'make-icons.mjs needs Playwright from the pinned test toolchain in ' +
    'reference/tests, and could not resolve it (' + err.message + '). ' +
    'This is a build-time-only tool with no runtime dependency of its own; ' +
    'fix by running `npm install` inside reference/tests, then re-run this script.'
  );
}

const svg = await readFile(path.join(root, 'icons', 'icon.svg'), 'utf8');

const JOBS = [
  { out: 'icon-192.png', size: 192, inset: 1 },
  { out: 'icon-512.png', size: 512, inset: 1 },
  { out: 'apple-touch-icon-180.png', size: 180, inset: 1 },
  { out: 'icon-maskable-512.png', size: 512, inset: 0.8 }
];

const browser = await chromium.launch();
for (const job of JOBS) {
  const page = await browser.newPage({
    viewport: { width: job.size, height: job.size },
    deviceScaleFactor: 1
  });
  const pad = Math.round((job.size * (1 - job.inset)) / 2);
  await page.setContent(
    '<style>html,body{margin:0;padding:0;background:#1d6fae}' +
    'div{width:' + job.size + 'px;height:' + job.size + 'px;box-sizing:border-box;' +
    'padding:' + pad + 'px;background:#1d6fae}' +
    'svg{width:100%;height:100%;display:block}</style><div>' + svg + '</div>'
  );
  const buf = await page.screenshot({ type: 'png' });
  await writeFile(path.join(root, 'icons', job.out), buf);
  await page.close();
  console.log('wrote icons/' + job.out + ' (' + job.size + 'px, inset ' + job.inset + ')');
}
await browser.close();
