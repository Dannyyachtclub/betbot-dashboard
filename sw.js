/* BetBot Terminal service worker — build r73-20261117.
 *
 * Deliberately minimal. Its only jobs: make the app installable and let
 * the shell open fast / offline. Freshness of DATA always wins:
 *
 *  - version.json is NEVER intercepted. The page's build check must see
 *    the live stamp on every poll, exactly as it did before this worker
 *    existed — a cached copy here would defeat the self-refresh.
 *  - dashboard.json (the live feed) is network-first; a cached copy is
 *    served only when the network itself fails.
 *  - HTML / navigations are network-first for the same reason; the
 *    cached shell is only an offline fallback.
 *  - Static art (banners, icons, fonts) is cache-first: it only changes
 *    when the build stamp (and therefore this cache name) changes.
 */
var BUILD = 'r73-20261117';
var SHELL = 'betbot-shell-' + BUILD;
var RUNTIME = 'betbot-runtime-' + BUILD;
var CORE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(SHELL)
      .then(function (c) { return c.addAll(CORE); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return (k !== SHELL && k !== RUNTIME) ? caches.delete(k) : Promise.resolve();
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* version.json — hands off. No respondWith: the browser takes its
     normal network path and the build self-check sees the live stamp. */
  if (url.pathname.replace(/\/+$/, '').endsWith('/version.json')) return;

  /* Live data feed — network-first, cache only as an offline fallback.
     The page fetches with a cache-busting ?t= query, so the copy is kept
     under the canonical (query-free) URL or the fallback could never hit. */
  if (url.hostname === 'raw.githubusercontent.com' &&
      url.pathname.endsWith('/dashboard.json')) {
    var canonical = url.origin + url.pathname;
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(RUNTIME).then(function (c) { c.put(canonical, copy); });
        return res;
      }).catch(function () { return caches.match(canonical); })
    );
    return;
  }

  /* Navigations / the document itself — network-first, shell fallback. */
  if (req.mode === 'navigate' ||
      url.pathname.endsWith('/index.html') ||
      url.pathname.endsWith('/betbot-dashboard/')) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(SHELL).then(function (c) { c.put('./index.html', copy); });
        return res;
      }).catch(function () { return caches.match('./index.html'); })
    );
    return;
  }

  /* Static art and fonts — cache-first, then network (and keep a copy). */
  if (/\.(?:jpe?g|png|webp|svg|gif|mp4|webm|woff2?|ttf|css)$/i.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(RUNTIME).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }
  /* Everything else: untouched, default network behaviour. */
});
