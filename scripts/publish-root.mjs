// Copia la build di produzione (file unico) nella radice del repository, servita da GitHub Pages.
import { copyFileSync, statSync } from 'node:fs';

copyFileSync('dist/app.html', 'index.html');
console.log(`index.html aggiornato (${Math.round(statSync('index.html').size / 1024)} KB)`);
