/* Board themes for Snakes & Ladders: the words, player colours and page
   accents for each one. The board artwork for each theme lives in
   render.js (STYLES). The host picks the theme; it travels in the game
   state so every player sees the same board. */
(function (global) {
  const list = {
    classic: {
      name: 'Regular', icon: '🎲', title: 'Snakes & Ladders',
      colors: ['#e53935', '#1e88e5', '#43a047', '#fdd835'],
      botNames: ['Red', 'Blue', 'Green', 'Yellow'],
      roll: 'Roll the Die',
      hint: 'Climb the ladders, dodge the snakes - first to square 100 wins. A new board every game.',
      win: '{name} wins!',
      accent: '#f2c230', accentDim: '#9c7a12', accentText: '#1d1604'
    },
    batman: {
      name: 'Batman', icon: '🦇', title: 'Snakes & Ladders: Gotham',
      colors: ['#f6c93b', '#4fd1c5', '#e05263', '#a78bfa'],
      botNames: ['Batman', 'Robin', 'Batgirl', 'Nightwing'],
      roll: 'Roll the Batarang Die',
      hint: 'Climb the ladders, dodge the snakes, race the Batmobile to square 100 to save Gotham.',
      win: '{name} saved Gotham!',
      accent: '#f6c93b', accentDim: '#a8860f', accentText: '#14120a'
    },
    spider: {
      name: 'Spider-Man', icon: '🕷️', title: 'Snakes & Ladders: Web City',
      colors: ['#e11d2e', '#2563eb', '#111827', '#f59e0b'],
      botNames: ['Spidey', 'Miles', 'Gwen', 'Peter'],
      roll: 'Roll the Web Die',
      hint: 'Swing up the ladders, dodge the snakes, first to square 100 wins.',
      win: '{name} swings to victory!',
      accent: '#e8323f', accentDim: '#8f1520', accentText: '#ffffff'
    },
    frozen: {
      name: 'Frozen', icon: '❄️', title: 'Snakes & Ladders: Ice Kingdom',
      colors: ['#3b82f6', '#8b5cf6', '#06b6d4', '#ec4899'],
      botNames: ['Elsa', 'Anna', 'Olaf', 'Kristoff'],
      roll: 'Roll the Snowflake Die',
      hint: 'Climb the icy ladders, dodge the snakes, first to reach the ice palace on 100 wins.',
      win: '{name} reached the ice palace!',
      accent: '#7cc8f2', accentDim: '#2f6f99', accentText: '#06223a'
    },
    barbie: {
      name: 'Barbie', icon: '💖', title: 'Snakes & Ladders: Dream House',
      colors: ['#ec4899', '#8b5cf6', '#f59e0b', '#14b8a6'],
      botNames: ['Barbie', 'Ken', 'Skipper', 'Stacie'],
      roll: 'Roll the Sparkle Die',
      hint: 'Climb the ladders, dodge the snakes, first to the Dream House on 100 wins.',
      win: '{name} made it to the Dream House!',
      accent: '#ff5fa8', accentDim: '#a3246a', accentText: '#ffffff'
    }
  };
  const order = ['classic', 'batman', 'spider', 'frozen', 'barbie'];
  const get = (id) => list[id] || list.classic;
  global.SNLThemes = { list, order, get, DEFAULT: 'classic' };
})(window);
