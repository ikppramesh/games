/*
 * Service worker for Ramesh's Game Room. It sits at the site root, so its scope
 * covers the landing page and every game.
 * - Install: caches the landing-page shell so the hub opens offline straight away.
 * - Page navigations: network first, falling back to the cached copy when offline.
 * - Other same-origin files, plus the CDN and font files the games load:
 *   stale-while-revalidate, so a game works offline after one online visit and
 *   picks up updates on the next.
 * - PeerJS traffic (WebSocket and broker) is never intercepted, so online play is unchanged.
 * Bump CACHE_VERSION when the shell list or caching rules change.
 */
'use strict';

var CACHE_VERSION = 'gameroom-v1';
var SHELL = ['./', 'home.js', 'pwa.js', 'manifest.webmanifest', 'icon.svg'];
var CROSS_ORIGIN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(function (cache) {
        return cache.addAll(SHELL.map(function (path) {
          return new URL(path, self.location.href).href;
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (key) {
          return key !== CACHE_VERSION;
        }).map(function (key) {
          return caches.delete(key);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && CROSS_ORIGIN_HOSTS.indexOf(url.hostname) === -1) return;

  event.respondWith(req.mode === 'navigate' ? networkFirst(req) : staleWhileRevalidate(req));
});

function networkFirst(req) {
  return caches.open(CACHE_VERSION).then(function (cache) {
    return fetch(req).then(function (res) {
      if (res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(function () {
      return cache.match(req).then(function (hit) {
        return hit || cache.match(new URL('./', self.location.href));
      });
    });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(CACHE_VERSION).then(function (cache) {
    return cache.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        // Opaque responses (no-cors CDN scripts and styles) have status 0 but are still cacheable.
        if (res.status === 200 || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      });
      if (!hit) return network;
      network.catch(function () { /* offline: keep serving the cached copy */ });
      return hit;
    });
  });
}
