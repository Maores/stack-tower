#!/usr/bin/env node
/* Builds Stack.html: index.html with hud.css, Three.js, and all game
   scripts inlined, so the game runs offline from a double-click.
   Usage: node scripts/build-offline.mjs
   No network needed: Three.js is vendored at vendor/three.min.js. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const read = (name) => readFile(path.join(root, name), 'utf8');
const [html, css, core, visuals, hud, audio, three] = await Promise.all([
  read('index.html'), read('hud.css'), read('core.js'),
  read('visuals.js'), read('hud.js'), read('audio.js'),
  read('vendor/three.min.js')
]);

const inline = (js) => '<script>\n' + js.replace(/<\/script>/g, '<\\/script>') + '\n</script>';

/* The data: stylesheet link satisfies hud.js ensureCss() so it never
   injects a dead hud.css link under file://. */
/* Function replacements: raw source must never pass through String.replace's
   $-substitution parsing. mustReplace also names the target that failed. */
const mustReplace = (html, needle, replacement, label) => {
  const found = typeof needle === 'string' ? html.includes(needle) : needle.test(html);
  if (!found) throw new Error('inline target not found: ' + label);
  return html.replace(needle, () => replacement);
};

let out = html;
out = mustReplace(out, '<link rel="stylesheet" href="hud.css">',
  '<link rel="stylesheet" data-stack-hud href="data:text/css,">\n<style>\n' + css + '\n</style>',
  'hud.css link');
out = mustReplace(out, /<!-- pwa:head:start -->[\s\S]*?<!-- pwa:head:end -->\n?/,
  '', 'pwa head block');
out = mustReplace(out, /<!-- pwa:boot:start -->[\s\S]*?<!-- pwa:boot:end -->\n?/,
  '', 'pwa boot block');
out = mustReplace(out, '<script src="vendor/three.min.js"></script>',
  inline(three), 'three.js vendored');
out = mustReplace(out, '<script src="core.js"></script>', inline(core), 'core.js');
out = mustReplace(out, '<script src="visuals.js"></script>', inline(visuals), 'visuals.js');
out = mustReplace(out, '<script src="hud.js"></script>', inline(hud), 'hud.js');
out = mustReplace(out, '<script src="audio.js"></script>', inline(audio), 'audio.js');

/* Backstop checks are line-anchored because every real tag in index.html sits
   at column 0; escaped tag-like text inside inlined comments must not trip
   them. If index.html ever indents its tags, revisit these anchors. */
if (/^<script\s+src=/m.test(out)) throw new Error('unreplaced <script src> remains');
if (/^<link\s+rel="stylesheet"\s+href=/m.test(out)) throw new Error('unreplaced stylesheet link remains');
if (out.includes('manifest.webmanifest')) throw new Error('manifest reference survived into Stack.html');
if (out.includes('sw.js')) throw new Error('service worker reference survived into Stack.html');
await writeFile(path.join(root, 'Stack.html'), out);
console.log('Stack.html written: ' + out.length + ' bytes');
