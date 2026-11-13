/*
 * PWA glue shared by the landing page and every game. It is loaded from the site root,
 * so its own URL gives the base for every link.
 * - Adds the web-app manifest, theme colour and home-screen tags to <head>.
 * - Adds a small base stylesheet for touch: no double-tap zoom, no pull-to-refresh
 *   (which would reload a game mid-match), no accidental text selection.
 *   Form fields keep their own selection.
 * - Registers sw.js so the pages open offline.
 * Kept as a separate file because the CSP forbids inline scripts.
 */
(function () {
  'use strict';

  var THEME_COLOR = '#1d4ed8';
  var TOUCH_CSS = [
    'html, body { overscroll-behavior: none; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }',
    'body { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }',
    'input, textarea, [contenteditable] { -webkit-user-select: text; user-select: text; }'
  ].join('\n');

  var base = new URL('./', document.currentScript.src).href;

  function addTo(tag, attrs) {
    var el = document.createElement(tag);
    Object.keys(attrs).forEach(function (name) { el.setAttribute(name, attrs[name]); });
    document.head.appendChild(el);
  }

  addTo('link', { rel: 'manifest', href: base + 'manifest.webmanifest' });
  addTo('meta', { name: 'theme-color', content: THEME_COLOR });
  addTo('meta', { name: 'mobile-web-app-capable', content: 'yes' });
  addTo('meta', { name: 'apple-mobile-web-app-capable', content: 'yes' });
  addTo('meta', { name: 'apple-mobile-web-app-title', content: 'Game Room' });

  var style = document.createElement('style');
  style.textContent = TOUCH_CSS;
  document.head.appendChild(style);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register(base + 'sw.js').catch(function (err) {
      console.warn('Offline support is unavailable:', err);
    });
  }
})();
