// Converte dist-demo/demo.html nel formato pagina degli artifact claude.ai (senza doctype/html/head/body).
import { readFileSync, writeFileSync } from 'node:fs';

const html = readFileSync('dist-demo/demo.html', 'utf8');
const pick = (re, label) => {
  const m = html.match(re);
  if (!m) throw new Error(`manca ${label} nel build demo`);
  return m;
};
const title = pick(/<title>[\s\S]*?<\/title>/, 'title')[0];
const fonts = pick(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^>]*>/, 'fonts')[0];
const umd = [...html.matchAll(/<script src="https:\/\/cdnjs\.cloudflare\.com[^"]*"><\/script>/g)].map((m) => m[0]);
if (umd.length !== 2) throw new Error('script React UMD non trovati');
const style = pick(/<style[^>]*>[\s\S]*?<\/style>/, 'style')[0];
const appScript = pick(/<script type="module"[^>]*>([\s\S]*?)<\/script>/, 'script app')[1];

const out = [
  title,
  '<meta name="claude:viewport-fit-sides" content="cover">',
  fonts,
  style,
  ...umd,
  '<div id="root"></div>',
  `<script>${appScript}</script>`,
].join('\n');
writeFileSync('dist-demo/shuttle-hartmann.html', out);
console.log(`artifact: dist-demo/shuttle-hartmann.html (${Math.round(out.length / 1024)} KB)`);
