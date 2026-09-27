// Card rendering: realistic printed cards built from HTML + inline SVG symbols.
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const PALETTES = [['red', 'yellow', 'green', 'blue'], ['pink', 'teal', 'orange', 'purple']];
  const INK = '#141414';

  function isWild(f) { return f.color === 'wild'; }
  function needsColor(f) { return isWild(f) && f.type !== 'colorRoulette'; }
  function colorHex(color, theme) { return (theme.colors[color] || {}).hex || '#555'; }

  function faceName(f, theme) {
    const colorLabel = isWild(f) ? '' : (theme.colors[f.color] || {}).label + ' ';
    if (f.type === 'number') return `${colorLabel}${f.value}`;
    const label = theme.labels[f.type] || f.type;
    const n = f.draw ? ` +${f.draw}` : '';
    return `${colorLabel}${label}${n}`.trim();
  }

  // ---------- SVG symbols (viewBox 0 0 100 100) ----------
  const svg = (inner) => `<svg viewBox="0 0 100 100" aria-hidden="true">${inner}</svg>`;
  const outlined = `stroke="${INK}" stroke-width="7" paint-order="stroke" stroke-linejoin="round"`;

  function skipSym(c) {
    const ring = (stroke, w) => `<circle cx="50" cy="50" r="29" fill="none" stroke="${stroke}" stroke-width="${w}"/><line x1="29.5" y1="70.5" x2="70.5" y2="29.5" stroke="${stroke}" stroke-width="${w}"/>`;
    return ring(INK, 21) + ring(c, 12);
  }

  function reverseSym(c1, c2 = c1) {
    const arrow = 'M14 44 H55 V33 L82 50 L55 67 V56 H14 Z';
    return `<g transform="rotate(-45 50 50)">
      <path d="${arrow}" transform="translate(0 -17)" fill="${c1}" ${outlined}/>
      <path d="${arrow}" transform="rotate(180 50 50) translate(0 -17)" fill="${c2}" ${outlined}/>
    </g>`;
  }

  // Fanned mini cards, as printed in the middle of +2 / +4 cards.
  function miniCards(colors) {
    const n = colors.length;
    const w = 30, h = 44;
    return colors.map((c, i) => {
      const x = 50 - w / 2 + (i - (n - 1) / 2) * (n > 2 ? 12 : 14);
      const y = 50 - h / 2 + (i - (n - 1) / 2) * (n > 2 ? -3 : -8);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c}" stroke="${INK}" stroke-width="7" paint-order="stroke"/><rect x="${x + 2.5}" y="${y + 2.5}" width="${w - 5}" height="${h - 5}" rx="3" fill="none" stroke="#fff" stroke-width="2"/>`;
    }).join('');
  }

  function wildOval(p) {
    // quadrants: top-left p0, top-right p3, bottom-right p2, bottom-left p1
    return `<g transform="rotate(28 50 50)">
      <ellipse cx="50" cy="50" rx="31" ry="44" fill="#fff" stroke="${INK}" stroke-width="3"/>
      <path d="M50 50 L50 9 A28 41 0 0 1 78 50 Z" fill="${p[3]}"/>
      <path d="M50 50 L78 50 A28 41 0 0 1 50 91 Z" fill="${p[2]}"/>
      <path d="M50 50 L50 91 A28 41 0 0 1 22 50 Z" fill="${p[1]}"/>
      <path d="M50 50 L22 50 A28 41 0 0 1 50 9 Z" fill="${p[0]}"/>
    </g>`;
  }

  function flipSym(c) {
    const arc = (stroke, w) => `<path d="M24 52 A26 26 0 0 1 70 32" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/><path d="M76 48 A26 26 0 0 1 30 68" fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;
    return arc(INK, 18) + arc(c, 10)
      + `<path d="M60 22 L82 30 L68 46 Z" fill="${c}" ${outlined}/><path d="M40 78 L18 70 L32 54 Z" fill="${c}" ${outlined}/>`;
  }

  function rouletteSym(p) {
    let segs = '';
    for (let i = 0; i < 8; i++) {
      const a0 = (i * 45 - 90) * Math.PI / 180, a1 = ((i + 1) * 45 - 90) * Math.PI / 180;
      const x0 = 50 + 34 * Math.cos(a0), y0 = 52 + 34 * Math.sin(a0);
      const x1 = 50 + 34 * Math.cos(a1), y1 = 52 + 34 * Math.sin(a1);
      segs += `<path d="M50 52 L${x0.toFixed(1)} ${y0.toFixed(1)} A34 34 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)} Z" fill="${p[i % 4]}"/>`;
    }
    return `<circle cx="50" cy="52" r="37" fill="${INK}"/>${segs}<circle cx="50" cy="52" r="8" fill="#fff" stroke="${INK}" stroke-width="3"/><path d="M42 8 L58 8 L50 24 Z" fill="#fff" ${outlined}/>`;
  }

  function discardSym(c) {
    return `${miniCards([c, c, c])}<path d="M50 70 L50 94 M40 84 L50 95 L60 84" fill="none" stroke="${INK}" stroke-width="12" stroke-linecap="round"/><path d="M50 70 L50 94 M40 84 L50 95 L60 84" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>`;
  }

  function skipAllSym(c) {
    return `<g transform="translate(-12 -8) scale(.78)">${skipSym(c)}</g><g transform="translate(34 30) scale(.78)">${skipSym(c)}</g>`;
  }

  // ---------- faces ----------
  // Returns { center, corner } HTML for a face.
  function artwork(f, theme, side) {
    const c = isWild(f) ? '#fff' : colorHex(f.color, theme);
    const pal = PALETTES[side].map((k) => colorHex(k, theme));
    const num = (t, cls = '') => `<span class="num ${cls}" style="--nc:${c}">${esc(t)}</span>`;
    const small = (t) => `<span class="idx-t">${esc(t)}</span>`;
    const drawCorner = small('+' + (f.draw || ''));
    switch (f.type) {
      case 'number': {
        const underline = f.value === 6 || f.value === 9 ? ' ul' : '';
        return { center: num(f.value, underline), corner: small(f.value) };
      }
      case 'skip': return { center: svg(skipSym(c)), corner: svg(skipSym('#fff')) };
      case 'reverse': return { center: svg(reverseSym(c)), corner: svg(reverseSym('#fff')) };
      case 'draw':
        return { center: f.draw <= 4 ? svg(miniCards(Array(f.draw).fill(c))) : num('+' + f.draw, 'draw'), corner: drawCorner };
      case 'skipAll': return { center: svg(skipAllSym(c)), corner: svg(skipSym('#fff')) };
      case 'discardAll': return { center: svg(discardSym(c)), corner: small('ALL') };
      case 'flip': return { center: svg(flipSym(c)), corner: svg(flipSym('#fff')) };
      case 'wild': return { center: svg(wildOval(pal)), corner: svg(wildOval(pal)) };
      case 'wildDraw':
        return {
          center: f.draw <= 4 ? svg(miniCards([pal[3], pal[2], pal[1], pal[0]].slice(0, f.draw))) : `${svg(wildOval(pal))}${num('+' + f.draw, 'draw over')}`,
          corner: drawCorner,
        };
      case 'wildReverseDraw': return { center: `${svg(reverseSym(pal[0], pal[3]))}${num('+' + f.draw, 'badge')}`, corner: drawCorner };
      case 'wildDrawColor': return { center: `${svg(wildOval(pal))}${num('+?', 'draw over')}`, corner: small('+?') };
      case 'colorRoulette': return { center: svg(rouletteSym(pal)), corner: svg(rouletteSym(pal)) };
      default: return { center: num('?'), corner: small('?') };
    }
  }

  // opts: { side, extraClass, id, title, style }
  function renderFace(f, theme, opts = {}) {
    const side = opts.side || 0;
    const wild = isWild(f);
    const art = artwork(f, theme, side);
    const hasOval = !wild && f.type !== 'colorRoulette';
    const cls = ['card', 'face-up', wild ? 'wild' : '', `t-${f.type}`, opts.extraClass || ''].join(' ');
    const style = `--cc:${wild ? '#161616' : colorHex(f.color, theme)};${opts.style || ''}`;
    return `<div class="${cls}" style="${style}" ${opts.id != null ? `data-id="${opts.id}"` : ''} title="${esc(opts.title || faceName(f, theme))}">
      <div class="face">
        ${hasOval ? '<div class="oval"></div>' : ''}
        <div class="art">${art.center}</div>
        <div class="idx tl">${art.corner}</div>
        <div class="idx br">${art.corner}</div>
      </div>
    </div>`;
  }

  function renderBack(theme, extraClass = '', style = '') {
    const b = theme.back;
    return `<div class="card back ${extraClass}" style="${style}">
      <div class="face" style="background:${b.base}">
        <div class="back-oval" style="--oc:${b.oval}"><span class="${b.text.length > 4 ? 'long' : ''}" style="color:${b.textColor}">${esc(b.text)}</span></div>
      </div>
    </div>`;
  }

  window.UnoCards = { esc, isWild, needsColor, faceName, colorHex, renderFace, renderBack, PALETTES };
})();
