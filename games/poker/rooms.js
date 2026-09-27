/* Poker rooms: stakes plus a complete look for each - page colours (ui),
   the table (felt, rail, trim, logo), the card deck, and chips. The rules
   are the same everywhere; only the starting stack and blinds scale.
   Blinds are 1% / 2% of the starting stack, so General plays 10/20 on 1,000.

   Colour specs used by render.js: a CSS colour, or a metal tone name
   ('gold' | 'rose' | 'silver' | 'ice') which is drawn as a brushed-metal
   gradient. */
(function (global) {
  const WOOD = { kind: 'wood', stops: ['#5a3312', '#8f5d2c', '#6d4119', '#9c6734', '#5a3312'] };
  const MAHOGANY = { kind: 'wood', stops: ['#3a120a', '#6e2414', '#4a160c', '#7a2a18', '#3a120a'], inlay: '#d4af37' };
  const GOLD_TRIM = { kind: 'metal', stops: ['#8a6a1c', '#fff0b0', '#d4a73a', '#fff3c0', '#8a6a1c'] };
  const CHROME_TRIM = { kind: 'metal', stops: ['#6e7a86', '#ffffff', '#b8c4cf', '#f4f8fb', '#6e7a86'] };
  const PLATINUM_TRIM = { kind: 'metal', stops: ['#6f7780', '#f2f5f8', '#aab3bd', '#ffffff', '#6f7780'] };

  const list = [
    {
      id: 'general', name: 'General', icon: '🟢', section: 'rooms', start: 1000,
      tagline: 'Classic green baize',
      ui: { bg: '#050d08', bg2: '#12291c', panel: '#0f1d16', panel2: '#17301f', border: '#24463a', accent: '#3ddc84', accentText: '#062012', muted: '#9db8a8' },
      table: {
        room: ['#1d3326', '#0c170f', '#030604'],
        rail: { grad: ['#4d2e1d', '#2d180e', '#190c05'], sheen: '255,226,190', stitch: 'rgba(222,186,138,0.5)' },
        trim: WOOD, felt: ['#26965f', '#177a4a', '#0a4d2f'],
        line: 'rgba(255,232,160,0.17)', logo: 'I R   H O L D ’ E M', logoColor: 'rgba(255,232,160,0.16)', lamp: '255,236,190'
      },
      cards: {
        face: ['#ffffff', '#f7f3ea', '#ebe4d4'], sheen: 0.05, edge: 'rgba(0,0,0,0.3)', inner: null,
        ink: { black: '#15161a', red: '#c21a2b' },
        court: { bg: ['#fcecc0', '#e6bb5e'], trimBlack: '#1f3f8f', trimRed: '#b0182a', crown: 'gold', jewel: '#b0182a' },
        back: { base: ['#b3202d', '#6d0f19'], border: '#fbfaf6', pattern: 'lattice', patternColor: 'rgba(255,255,255,0.3)', medallion: '#7a1420', emblem: '#f0c878' }
      }
    },
    {
      id: 'golden', name: 'Golden', icon: '🟡', section: 'rooms', start: 10000,
      tagline: 'Gold rail & gold-foil cards',
      ui: { bg: '#0d0903', bg2: '#2a1d08', panel: '#1c1408', panel2: '#2a1f0c', border: '#4a3812', accent: '#f2c230', accentText: '#241800', muted: '#bba77a' },
      table: {
        room: ['#3a2a10', '#1a1206', '#050301'],
        rail: { grad: ['#2a1d10', '#16100a', '#0a0604'], sheen: '255,226,160', stitch: 'rgba(242,194,48,0.65)' },
        trim: GOLD_TRIM, felt: ['#1f7a52', '#135c3c', '#073322'],
        line: 'rgba(242,200,90,0.3)', logo: 'G O L D E N   R O O M', logoColor: 'rgba(242,200,90,0.3)', lamp: '255,230,160'
      },
      cards: {
        face: ['#fff1b8', '#ecc65e', '#c99a2e'], sheen: 0.28, edge: 'rgba(110,75,10,0.85)', inner: '#6b4a0a',
        ink: { black: '#1a1206', red: '#9e1020' },
        court: { bg: ['#fff6d6', '#f0d27a'], trimBlack: '#1a1206', trimRed: '#9e1020', crown: '#6b4a0a', jewel: '#9e1020' },
        back: { base: ['#1f160a', '#050300'], border: '#d4a73a', pattern: 'lattice', patternColor: 'rgba(242,194,48,0.4)', medallion: '#0b0803', emblem: 'gold' }
      }
    },
    {
      id: 'diamond', name: 'Diamond', icon: '💎', section: 'rooms', start: 50000,
      tagline: 'Ice-blue felt & crystal deck',
      ui: { bg: '#030a12', bg2: '#0b2336', panel: '#0a1a28', panel2: '#10263a', border: '#1d4260', accent: '#7fd4ff', accentText: '#03182a', muted: '#8fb2c8' },
      table: {
        room: ['#123049', '#07182a', '#02060b'],
        rail: { grad: ['#f0f3f7', '#c9d2dc', '#8b98a6'], sheen: '255,255,255', stitch: 'rgba(60,110,160,0.6)', light: true },
        trim: CHROME_TRIM, felt: ['#2a8fb8', '#1a6d91', '#0b3a52'],
        line: 'rgba(210,240,255,0.28)', logo: 'D I A M O N D   R O O M', logoColor: 'rgba(220,245,255,0.24)', lamp: '220,240,255'
      },
      cards: {
        face: ['#ffffff', '#f3f8fc', '#dce9f3'], sheen: 0.14, edge: 'rgba(40,90,140,0.5)', inner: 'ice',
        ink: { black: '#0e2a4a', red: '#c2185b' },
        court: { bg: ['#eaf6ff', '#b9dcf5'], trimBlack: '#0e2a4a', trimRed: '#c2185b', crown: 'ice', jewel: '#c2185b' },
        back: { base: ['#2a8fd6', '#0b3a70'], border: '#ffffff', pattern: 'diamond', patternColor: 'rgba(255,255,255,0.4)', medallion: '#0b3a70', emblem: 'ice', emblemSuit: 'D' }
      }
    },
    {
      id: 'platinum', name: 'Platinum', icon: '🪙', section: 'rooms', start: 100000,
      tagline: 'Graphite felt & brushed platinum',
      ui: { bg: '#08090b', bg2: '#1c2128', panel: '#14181d', panel2: '#1f252d', border: '#39424e', accent: '#dfe6ee', accentText: '#111418', muted: '#9aa5b1' },
      table: {
        room: ['#2a3038', '#12161b', '#040506'],
        rail: { grad: ['#2a2c30', '#141518', '#08090a'], sheen: '220,230,240', stitch: 'rgba(210,220,230,0.5)' },
        trim: PLATINUM_TRIM, felt: ['#556373', '#3a4553', '#1a2028'],
        line: 'rgba(230,236,242,0.22)', logo: 'P L A T I N U M   R O O M', logoColor: 'rgba(230,236,242,0.2)', lamp: '235,240,248'
      },
      cards: {
        face: ['#f9fafb', '#dde2e8', '#b3bcc6'], sheen: 0.32, edge: 'rgba(60,70,80,0.6)', inner: 'silver',
        ink: { black: '#111418', red: '#a3122a' },
        court: { bg: ['#ffffff', '#cfd6de'], trimBlack: '#111418', trimRed: '#a3122a', crown: 'silver', jewel: '#a3122a' },
        back: { base: ['#e3e8ee', '#8f99a4'], border: '#1b1f24', pattern: 'pinstripe', patternColor: 'rgba(20,24,28,0.28)', medallion: '#1b1f24', emblem: 'silver' }
      }
    },
    {
      id: 'vip', name: 'VIP Club', icon: '👑', section: 'rooms', start: 1000000,
      tagline: 'Purple velvet & gold',
      ui: { bg: '#0a0412', bg2: '#26103d', panel: '#190c28', panel2: '#261338', border: '#43245f', accent: '#c79bff', accentText: '#1a0730', muted: '#b09ac8' },
      table: {
        room: ['#2e1446', '#140820', '#040108'],
        rail: { grad: ['#241a2e', '#120c18', '#07040a'], sheen: '240,210,255', stitch: 'rgba(242,194,48,0.6)' },
        trim: GOLD_TRIM, felt: ['#7040a6', '#4c2178', '#240c3e'],
        line: 'rgba(242,200,120,0.28)', logo: 'V I P   C L U B', logoColor: 'rgba(242,200,120,0.28)', lamp: '240,210,255'
      },
      cards: {
        face: ['#fffdf7', '#f6efe0', '#e6d8bf'], sheen: 0.06, edge: 'rgba(80,40,110,0.45)', inner: 'gold',
        ink: { black: '#1e0f33', red: '#b0124f' },
        court: { bg: ['#f3e6ff', '#d8b8f5'], trimBlack: '#1e0f33', trimRed: '#b0124f', crown: 'gold', jewel: '#b0124f' },
        back: { base: ['#5b2a86', '#2a0f45'], border: '#fffdf7', pattern: 'damask', patternColor: 'rgba(242,194,48,0.45)', medallion: '#2a0f45', emblem: 'gold' }
      }
    },
    {
      id: 'royale', name: 'Royale', icon: '🎩', section: 'high', start: 10000000,
      tagline: 'Black tie. Monte-Carlo classic.',
      ui: { bg: '#050403', bg2: '#1b140c', panel: '#110d09', panel2: '#1d1712', border: '#3d3120', accent: '#d4af37', accentText: '#1a1204', muted: '#b5a58a', serif: true },
      table: {
        room: ['#2a1b12', '#120a06', '#020101'],
        rail: { grad: ['#1c1a18', '#0e0d0c', '#050505'], sheen: '255,236,200', stitch: 'rgba(212,175,55,0.55)' },
        trim: MAHOGANY, felt: ['#1f7048', '#135232', '#07301c'],
        line: 'rgba(212,175,55,0.38)', logo: 'R O Y A L E', logoColor: 'rgba(212,175,55,0.4)', lamp: '255,230,180', deco: true
      },
      cards: {
        face: ['#fffdf6', '#f6eedc', '#e8d8b8'], sheen: 0.08, edge: 'rgba(160,120,40,0.85)', inner: 'gold',
        ink: { black: '#141414', red: '#a51522' },
        court: { bg: ['#fbf2da', '#e8cf8f'], trimBlack: '#141414', trimRed: '#a51522', crown: 'gold', jewel: '#a51522' },
        back: { base: ['#8c1622', '#4a070f'], border: '#fffdf6', pattern: 'damask', patternColor: 'rgba(212,175,55,0.5)', medallion: '#4a070f', emblem: 'gold' }
      }
    },
    {
      id: 'elite', name: 'Elite', icon: '⚜️', section: 'high', start: 1000000000,
      tagline: 'Black & gold. The final table.',
      ui: { bg: '#020202', bg2: '#141008', panel: '#0b0a08', panel2: '#171410', border: '#3a2f16', accent: '#f5d27f', accentText: '#140e02', muted: '#a8997a', serif: true },
      table: {
        room: ['#15110a', '#070604', '#000000'],
        rail: { grad: ['#1c1c1e', '#0b0b0c', '#020202'], sheen: '255,255,255', stitch: 'rgba(245,210,127,0.6)' },
        trim: GOLD_TRIM, felt: ['#2a2622', '#181512', '#060504'],
        line: 'rgba(245,210,127,0.42)', logo: 'E L I T E', logoColor: 'rgba(245,210,127,0.45)', lamp: '255,235,190', filigree: true
      },
      cards: {
        face: ['#2b2b2f', '#121214', '#050506'], sheen: 0.13, edge: 'rgba(214,176,92,0.6)', inner: 'suit',
        ink: { black: 'gold', red: 'rose' },
        court: { bg: ['#26221a', '#0c0b08'], trimBlack: 'gold', trimRed: 'rose', crown: 'gold', jewel: '#0b0b0c' },
        back: { base: ['#161618', '#050506'], border: null, pattern: 'lattice', patternColor: 'rgba(214,176,92,0.32)', medallion: '#0b0b0c', emblem: 'gold' }
      }
    }
  ];

  for (const r of list) {
    r.smallBlind = r.start / 100;
    r.bigBlind = r.start / 50;
  }
  const byId = Object.fromEntries(list.map(r => [r.id, r]));

  // ₹ with Indian grouping; `short` uses lakh / crore for big numbers
  function inr(n, short) {
    n = Number(n || 0);
    const fmt = (x) => x.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    if (short && Math.abs(n) >= 1e7) return '₹' + fmt(n / 1e7) + ' Cr';
    if (short && Math.abs(n) >= 1e5) return '₹' + fmt(n / 1e5) + ' L';
    return '₹' + fmt(n);
  }

  global.PokerRooms = { list, get: (id) => byId[id] || byId.general, inr };
})(typeof self !== 'undefined' ? self : this);
