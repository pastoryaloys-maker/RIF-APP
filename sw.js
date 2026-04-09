// ── RIF APP Service Worker ─────────────────────────────────────────────────────
// Version: bump this string whenever you deploy a new build so old caches clear
const CACHE_NAME = 'rif-app-v1';

// All the files your app needs to work 100% offline
const PRECACHE_URLS = [
  '/RIF-APP/',
  '/RIF-APP/index.html',
  '/RIF-APP/manifest.json',
  '/RIF-APP/icons/icon-72x72.png',
  '/RIF-APP/icons/icon-96x96.png',
  '/RIF-APP/icons/icon-128x128.png',
  '/RIF-APP/icons/icon-144x144.png',
  '/RIF-APP/icons/icon-152x152.png',
  '/RIF-APP/icons/icon-192x192.png',
  '/RIF-APP/icons/icon-384x384.png',
  '/RIF-APP/icons/icon-512x512.png',
  // External CDN assets — cached on first load so they work offline too
  'https://fonts.googleapis.com/css2?family=Syne:wght@600;700;800&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js'
];

// ── INSTALL: pre-cache all app shell files ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching app shell…');
        // Use individual adds so one failure doesn't block everything
        return Promise.allSettled(
          PRECACHE_URLS.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] Failed to cache:', url, err)
            )
          )
        );
      })
      .then(() => self.skipWaiting()) // Activate new SW immediately
  );
});

// ── ACTIVATE: clean up old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim()) // Take control of all pages immediately
  );
});

// ── FETCH: Network-first for API, Cache-first for everything else ──────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // ── 1. Anthropic API calls → always go to network (never cache) ──────────────
  if (url.hostname === 'api.anthropic.com') {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline — AI insights unavailable without internet.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // ── 2. Google Fonts → stale-while-revalidate (fonts load fast offline) ────────
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          const fetchPromise = fetch(request).then(response => {
            cache.put(request, response.clone());
            return response;
          });
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── 3. CDN scripts (Chart.js, jsPDF, html2canvas) → cache-first ──────────────
  if (url.hostname === 'cdnjs.cloudflare.com') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // ── 4. App shell (HTML, icons, manifest) → cache-first, fallback to network ──
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        // Only cache valid same-origin responses
        if (
          response.ok &&
          (url.origin === self.location.origin || url.hostname.includes('github.io'))
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback → serve cached index.html for navigation requests
        if (request.mode === 'navigate') {
          return caches.match('/RIF-APP/index.html');
        }
      });
    })
  );
});

// ── PUSH NOTIFICATIONS (future-ready) ─────────────────────────────────────────
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'RIF APP';
  const options = {
    body: data.body || 'You have a new reminder!',
    icon: '/RIF-APP/icons/icon-192x192.png',
    badge: '/RIF-APP/icons/icon-96x96.png',
    vibrate: [200, 100, 200],
    data: { url: data.url || '/RIF-APP/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow(event.notification.data.url || '/RIF-APP/')
  );
});
