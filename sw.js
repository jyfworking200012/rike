/* 日课 · 一亩三分地 —— Service Worker
 *
 * 更新纪律（踩过坑，写死）：
 *   1. 每次改 index.html 必须 bump CACHE 版本号，否则 activate 不会清旧缓存。
 *   2. HTML 入口走 network-first —— 联网时永远拿最新，断网才回退缓存。
 *      早期版本把 index.html 也做成 cache-first，导致新版本推上去了手机还看旧页面。
 *   3. 其余静态资源（字体、图标）走 cache-first，快，且改得少。
 */
const CACHE = 'town-v10';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

// HTML 入口：网络优先
function isHTML(req) {
  if (req.mode === 'navigate') return true;
  const url = new URL(req.url);
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // 字体等外域资源交给浏览器

  if (isHTML(e.request)) {
    // 网络优先：拿到就更新缓存，拿不到回退缓存
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const cp = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // 其他资源：缓存优先
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        const cp = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, cp)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});

// 允许页面主动要求跳过等待 / 检查更新
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
  if (e.data === 'CHECK') self.registration.update().catch(() => {});
});
