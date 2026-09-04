/* Bygger to ting fra kildefilene:
   1. legger manus.txt inn i index.html (mellom <script id="innebygd-manus">-taggene)
   2. skriver dist/toastmaster.html – hele appen i én fil, klar til å publiseres
      som en delbar lenke (Claude Artifact), der alt må ligge i samme fil.
   Kjør: node build.mjs */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const manus = readFileSync('manus.txt', 'utf8').trim();
if (manus.includes('</script>')) throw new Error('manus.txt kan ikke inneholde </script>');

const marker = /(<script type="text\/plain" id="innebygd-manus">)[\s\S]*?(<\/script>)/;
let html = readFileSync('index.html', 'utf8');
if (!marker.test(html)) throw new Error('Fant ikke manus-taggen i index.html');
html = html.replace(marker, `$1\n${manus}\n$2`);
writeFileSync('index.html', html);

const css = readFileSync('styles.css', 'utf8');
const js = readFileSync('app.js', 'utf8')
  .replace(/\n?if \('serviceWorker' in navigator\)[\s\S]*$/, '\n');   // ingen sw.js i én-fil-versjonen

const title = /<title>([\s\S]*?)<\/title>/.exec(html)[1];
const fonts = html.match(/<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.g[^>]*>/g).join('\n');
const body = /<body>([\s\S]*?)<script src="app\.js">/.exec(html)[1].trim();

const out = `<title>${title}</title>
${fonts}
<style>
${css.trim()}
</style>

${body}

<script>
${js.trim()}
</script>
`;

mkdirSync('dist', { recursive: true });
writeFileSync('dist/toastmaster.html', out);
console.log(`index.html oppdatert · dist/toastmaster.html – ${(out.length / 1024).toFixed(1)} kB`);
