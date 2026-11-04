(function () {
  'use strict';

  var FAV_KEY = 'gameroom.favs';
  var RECENT_KEY = 'gameroom.recent';
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* storage unavailable */ }
  }

  var cards = Array.prototype.slice.call(document.querySelectorAll('.card'));
  var liveCards = cards.filter(function (c) { return c.classList.contains('live'); });
  var favs = load(FAV_KEY);
  var filter = 'all';
  var query = '';

  function idOf(card) { return card.getAttribute('data-id'); }

  /* ---------- animated particle background ---------- */
  var canvas = document.getElementById('bg');
  if (canvas && !reduceMotion) {
    var ctx = canvas.getContext('2d');
    var pts = [];
    var mouse = { x: -999, y: -999 };
    var w, h;
    var glyphs = ['♠', '♥', '♦', '♣', '♞', '●', '■', '▲'];
    var resize = function () {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
      var n = Math.min(40, Math.floor(w * h / 30000));
      pts = [];
      for (var i = 0; i < n; i++) {
        pts.push({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.25, vy: -0.1 - Math.random() * 0.3,
          s: 12 + Math.random() * 18, g: glyphs[i % glyphs.length],
          a: 0.04 + Math.random() * 0.08
        });
      }
    };
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', function (e) { mouse.x = e.clientX; mouse.y = e.clientY; });
    resize();
    (function frame() {
      ctx.clearRect(0, 0, w, h);
      for (var i = 0; i < pts.length; i++) {
        var p = pts[i];
        var dx = p.x - mouse.x, dy = p.y - mouse.y, d = Math.sqrt(dx * dx + dy * dy);
        if (d < 140 && d > 0) { p.x += dx / d * 1.2; p.y += dy / d * 1.2; }
        p.x += p.vx; p.y += p.vy;
        if (p.y < -30) { p.y = h + 30; p.x = Math.random() * w; }
        if (p.x < -30) p.x = w + 30;
        if (p.x > w + 30) p.x = -30;
        ctx.globalAlpha = p.a;
        ctx.fillStyle = i % 2 ? '#4fd1c5' : '#f6ad55';
        ctx.font = p.s + 'px sans-serif';
        ctx.fillText(p.g, p.x, p.y);
      }
      requestAnimationFrame(frame);
    })();
  }

  /* ---------- 3D tilt + cursor glow ---------- */
  cards.forEach(function (card) {
    if (reduceMotion || !card.classList.contains('live')) return;
    card.addEventListener('pointermove', function (e) {
      if (e.pointerType === 'touch') return;
      var r = card.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width;
      var y = (e.clientY - r.top) / r.height;
      card.style.setProperty('--mx', (x * 100) + '%');
      card.style.setProperty('--my', (y * 100) + '%');
      card.style.transform = 'perspective(700px) rotateX(' + ((0.5 - y) * 10) + 'deg) rotateY(' + ((x - 0.5) * 12) + 'deg) translateY(-4px)';
    });
    card.addEventListener('pointerleave', function () { card.style.transform = ''; });
  });

  /* ---------- reveal on scroll ---------- */
  if ('IntersectionObserver' in window && !reduceMotion) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.1 });
    cards.forEach(function (c, i) {
      c.style.transitionDelay = (i % 6) * 60 + 'ms';
      io.observe(c);
    });
  } else {
    cards.forEach(function (c) { c.classList.add('in'); });
  }

  /* ---------- favourites ---------- */
  function renderFavs() {
    liveCards.forEach(function (c) {
      var on = favs.indexOf(idOf(c)) !== -1;
      var btn = c.querySelector('.fav');
      c.classList.toggle('is-fav', on);
      if (btn) {
        btn.textContent = on ? '★' : '☆';
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
  }
  liveCards.forEach(function (c) {
    var btn = c.querySelector('.fav');
    if (!btn) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var id = idOf(c), i = favs.indexOf(id);
      if (i === -1) favs.push(id); else favs.splice(i, 1);
      save(FAV_KEY, favs);
      renderFavs();
      applyFilter();
    });
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); btn.click(); }
    });
  });

  /* ---------- recently played ---------- */
  liveCards.forEach(function (c) {
    c.addEventListener('click', function () {
      var id = idOf(c);
      var r = load(RECENT_KEY).filter(function (x) { return x !== id; });
      r.unshift(id);
      save(RECENT_KEY, r.slice(0, 4));
    });
  });
  function renderRecent() {
    var wrap = document.getElementById('recent');
    var list = document.getElementById('recent-list');
    var ids = load(RECENT_KEY);
    list.innerHTML = '';
    var shown = 0;
    ids.forEach(function (id) {
      var c = document.querySelector('.card[data-id="' + id + '"]');
      if (!c) return;
      var a = document.createElement('a');
      a.className = 'chip-link';
      a.href = c.getAttribute('href');
      a.textContent = c.getAttribute('data-icon') + ' ' + c.querySelector('h2').textContent;
      list.appendChild(a);
      shown++;
    });
    wrap.hidden = shown === 0;
  }

  /* ---------- search + filters ---------- */
  var search = document.getElementById('search');
  var empty = document.getElementById('empty');

  function matches(c) {
    var tags = (c.getAttribute('data-tags') || '').split(' ');
    if (filter === 'fav' && favs.indexOf(idOf(c)) === -1) return false;
    if (filter !== 'all' && filter !== 'fav' && tags.indexOf(filter) === -1) return false;
    if (query) {
      var hay = (c.textContent + ' ' + tags.join(' ')).toLowerCase();
      if (hay.indexOf(query) === -1) return false;
    }
    return true;
  }
  function applyFilter() {
    var any = false;
    cards.forEach(function (c) {
      var ok = matches(c);
      c.classList.toggle('hidden', !ok);
      if (ok) any = true;
    });
    document.querySelectorAll('.section').forEach(function (s) {
      s.hidden = !s.querySelector('.card:not(.hidden)');
    });
    empty.hidden = any;
  }
  search.addEventListener('input', function () {
    query = search.value.trim().toLowerCase();
    applyFilter();
  });
  document.querySelectorAll('.filter').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.filter').forEach(function (x) {
        x.classList.remove('active');
        x.setAttribute('aria-pressed', 'false');
      });
      b.classList.add('active');
      b.setAttribute('aria-pressed', 'true');
      filter = b.getAttribute('data-filter');
      applyFilter();
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== search) {
      e.preventDefault();
      search.focus();
    } else if (e.key === 'Escape' && document.activeElement === search) {
      search.value = '';
      query = '';
      search.blur();
      applyFilter();
    }
  });

  /* ---------- surprise me ---------- */
  document.getElementById('random').addEventListener('click', function () {
    var pool = liveCards.filter(function (c) { return !c.classList.contains('hidden'); });
    if (!pool.length) pool = liveCards;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    var n = 0;
    var timer = setInterval(function () {
      liveCards.forEach(function (c) { c.classList.remove('spot'); });
      var c = n < 10 ? liveCards[Math.floor(Math.random() * liveCards.length)] : pick;
      c.classList.add('spot');
      if (++n > 10) {
        clearInterval(timer);
        c.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
        setTimeout(function () { window.location.href = pick.getAttribute('href'); }, 900);
      }
    }, 90);
  });

  /* ---------- counters ---------- */
  document.getElementById('count-live').textContent = liveCards.length;
  document.getElementById('count-soon').textContent = cards.length - liveCards.length;

  renderFavs();
  renderRecent();
  applyFilter();
})();
