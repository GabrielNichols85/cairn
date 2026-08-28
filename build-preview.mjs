/* ============================================================
   Builds dist/cairn-preview.html — the whole app as one file
   you can open by double-clicking, with no server and no build
   tooling. The deployed site uses the real files; this is just
   a portable copy for sharing and offline demos.

   Run:  node build-preview.mjs
   ============================================================ */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, resolve as presolve } from 'path';

const MODULES = [
  '/config.js',
  '/src/util.js', '/src/ui.js', '/src/store.js', '/src/readings.js', '/src/prompts.js',
  '/src/circles.js', '/src/emails.js',
  '/src/views/today.js', '/src/views/wall.js', '/src/views/answered.js',
  '/src/views/journal.js', '/src/views/settings.js', '/src/views/circles.js',
  '/src/views/unsubscribe.js', '/src/views/stats.js', '/src/main.js',
];

const read = (p) => readFileSync('.' + p, 'utf8');
const esc = (s) => s.replace(/<\/script>/gi, '<\\/script>');

const css = read('/styles.css');
let html = read('/index.html');

// strip the tags the single file replaces
html = html
  .replace(/<link rel="stylesheet" href="\.?\/styles\.css" \/>\s*/, `<style>\n${css}\n</style>\n`)
  .replace(/<link rel="manifest"[^>]*>\s*/, '')
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, '')
  .replace(/<script type="module" src="\.?\/src\/main\.js"><\/script>/, '');

const payload = MODULES.map((path) =>
  `<script type="text/cairn-module" data-path="${path}">\n${esc(read(path))}\n</script>`
).join('\n');

const bootstrap = `
<script>
/* Turn the embedded sources into real ES modules via blob URLs, rewriting
   each relative import to the blob URL of the module it points at. */
(function () {
  var raw = {};
  document.querySelectorAll('script[type="text/cairn-module"]').forEach(function (s) {
    raw[s.dataset.path] = s.textContent;
  });

  function resolvePath(from, spec) {
    var base = from.slice(0, from.lastIndexOf('/'));
    var parts = (base + '/' + spec).split('/');
    var out = [];
    parts.forEach(function (p) {
      if (p === '' || p === '.') return;
      if (p === '..') out.pop();
      else out.push(p);
    });
    return '/' + out.join('/');
  }

  var urls = {}, building = {};
  function build(path) {
    if (urls[path]) return urls[path];
    if (building[path]) throw new Error('Import cycle at ' + path);
    building[path] = true;
    var src = raw[path];
    if (src === undefined) throw new Error('Missing module ' + path);
    src = src.replace(/(from\\s*|import\\s*\\(\\s*)(['"])(\\.[^'"]+)\\2/g, function (m, pre, q, spec) {
      var target = resolvePath(path, spec);
      return pre + q + build(target) + q;
    });
    var url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    urls[path] = url;
    building[path] = false;
    return url;
  }

  var entry = build('/src/main.js');
  var tag = document.createElement('script');
  tag.type = 'module';
  tag.src = entry;
  document.body.appendChild(tag);
})();
</script>`;

html = html.replace('</body>', payload + '\n' + bootstrap + '\n</body>');

mkdirSync('dist', { recursive: true });
writeFileSync('dist/cairn-preview.html', html);
console.log('dist/cairn-preview.html —', (html.length / 1024).toFixed(0) + ' KB');
