// Theme registry. A theme only changes how cards and the table look — never the rules.
// To add a theme: copy one of the blocks below, give it a new key, and change the values.
//
//   colors  – the 4 normal colours (red/yellow/green/blue) and the 4 UNO Flip dark-side colours
//             (pink/teal/orange/purple). `label` is the name players see ("Rama Blue").
//   labels  – names for action cards (shown in tooltips and the game log).
//   felt    – table cloth colour (normal side / UNO Flip dark side).
//   rim     – the table edge: [light, dark] colours of the wood or metal.
//   room    – the background around the table.
//   back    – the printed card back: `base` background, `oval` colour, `text` and `textColor`.
//   fx      – optional subtle particles (e.g. snow).
(function () {
  const baseLabels = {
    skip: 'Skip', reverse: 'Reverse', draw: 'Draw', wild: 'Wild', wildDraw: 'Wild Draw',
    skipAll: 'Skip Everyone', discardAll: 'Discard All', colorRoulette: 'Colour Roulette', flip: 'Flip',
    wildDrawColor: 'Wild Draw Colour', wildReverseDraw: 'Wild Reverse Draw',
  };

  window.UNO_THEMES = {
    classic: {
      name: 'Classic',
      colors: {
        red: { hex: '#d72600', label: 'Red' },
        yellow: { hex: '#ecc80a', label: 'Yellow' },
        green: { hex: '#379711', label: 'Green' },
        blue: { hex: '#0956bf', label: 'Blue' },
        pink: { hex: '#d6246e', label: 'Pink' },
        teal: { hex: '#008c8c', label: 'Teal' },
        orange: { hex: '#f06a0f', label: 'Orange' },
        purple: { hex: '#6a2c9e', label: 'Purple' },
      },
      labels: baseLabels,
      felt: { light: '#1c5c38', dark: '#3a2150' },
      rim: ['#7a4a24', '#3b220f'],
      room: 'radial-gradient(ellipse at 50% 35%, #2a2622 0%, #121110 60%, #070707 100%)',
      back: { base: 'radial-gradient(circle at 50% 50%, #262626, #0b0b0b)', oval: '#d72600', text: 'UNO', textColor: '#f6d31c' },
      accent: '#e8c46a',
      fx: null,
    },

    frozen: {
      name: 'Frozen',
      colors: {
        red: { hex: '#b3174f', label: 'Anna Rose' },
        yellow: { hex: '#e2b53c', label: 'Olaf Gold' },
        green: { hex: '#1f7a66', label: 'Kristoff Pine' },
        blue: { hex: '#1d8fd1', label: 'Elsa Ice' },
        pink: { hex: '#d25a9c', label: 'Aurora Pink' },
        teal: { hex: '#139ea8', label: 'Glacier Teal' },
        orange: { hex: '#e08840', label: 'Sven Amber' },
        purple: { hex: '#5e45a8', label: 'Northern Violet' },
      },
      labels: { ...baseLabels, skip: 'Freeze', reverse: 'Whirlwind', draw: 'Snowball', wild: 'Ice Magic', wildDraw: 'Blizzard', skipAll: 'Deep Freeze', flip: 'Thaw', wildDrawColor: 'Avalanche' },
      felt: { light: '#24506b', dark: '#2a2458' },
      rim: ['#c9d3da', '#6f7f8b'],
      room: 'radial-gradient(ellipse at 50% 30%, #1b2d3d 0%, #0b141d 60%, #05080c 100%)',
      back: {
        base: 'radial-gradient(circle at 25% 25%, rgba(255,255,255,.10) 1.5px, transparent 2.5px) 0 0 / 10px 10px, linear-gradient(160deg, #144a74, #07203a)',
        oval: '#dff3ff', text: 'FROZEN', textColor: '#0d4f80',
      },
      accent: '#a9dcf5',
      fx: { chars: ['❄', '❅', '•'], color: 'rgba(255,255,255,.35)', count: 22 },
    },

    ramayanam: {
      name: 'Ramayanam',
      colors: {
        red: { hex: '#c2410c', label: 'Hanuman Saffron' },
        yellow: { hex: '#d9a106', label: 'Sita Gold' },
        green: { hex: '#2b7a3b', label: 'Lakshmana Green' },
        blue: { hex: '#1b4f9c', label: 'Rama Blue' },
        pink: { hex: '#b82a5e', label: 'Surpanakha Rose' },
        teal: { hex: '#0b7285', label: 'Vibhishana Teal' },
        orange: { hex: '#d9480f', label: 'Agni Flame' },
        purple: { hex: '#5b1a86', label: 'Ravana Violet' },
      },
      labels: { ...baseLabels, skip: 'Vanavasa', reverse: 'Pushpaka', draw: 'Bana', wild: 'Brahmastra', wildDraw: 'Vanara Sena', skipAll: 'Setu', flip: 'Lanka', wildDrawColor: 'Dashanana', discardAll: 'Agni Pariksha', colorRoulette: 'Maya Mriga' },
      felt: { light: '#5a1712', dark: '#2e1240' },
      rim: ['#a8742c', '#4a2a0c'],
      room: 'radial-gradient(ellipse at 50% 30%, #2c1a12 0%, #140b07 60%, #070403 100%)',
      back: {
        base: 'repeating-linear-gradient(45deg, rgba(214,165,70,.20) 0 1.5px, transparent 1.5px 7px), repeating-linear-gradient(-45deg, rgba(214,165,70,.20) 0 1.5px, transparent 1.5px 7px), linear-gradient(160deg, #5e140e, #2e0806)',
        oval: '#cf9a36', text: 'राम', textColor: '#4a0f0a',
      },
      accent: '#e0b25a',
      fx: null,
    },

    mahabharatam: {
      name: 'Mahabharatam',
      colors: {
        red: { hex: '#b3261e', label: 'Bhima Red' },
        yellow: { hex: '#d4960f', label: 'Yudhishthira Gold' },
        green: { hex: '#2d7d3f', label: 'Nakula-Sahadeva Green' },
        blue: { hex: '#16549a', label: 'Arjuna Blue' },
        pink: { hex: '#a8234f', label: 'Draupadi Rose' },
        teal: { hex: '#0b6b7a', label: 'Krishna Teal' },
        orange: { hex: '#d06a00', label: 'Karna Sun' },
        purple: { hex: '#4d2f9e', label: 'Duryodhana Violet' },
      },
      labels: { ...baseLabels, skip: 'Chakravyuha', reverse: 'Sudarshana', draw: 'Gandiva', wild: 'Vishwaroopa', wildDraw: 'Bhishma Vow', skipAll: 'Kurukshetra', flip: 'Maya Sabha', wildDrawColor: 'Shakuni Dice', discardAll: 'Gita', colorRoulette: 'Dice Game' },
      felt: { light: '#1d2b4d', dark: '#2d1838' },
      rim: ['#b0823e', '#4d3212'],
      room: 'radial-gradient(ellipse at 50% 30%, #231c14 0%, #100c08 60%, #050403 100%)',
      back: {
        base: 'repeating-conic-gradient(from 0deg at 50% 50%, rgba(232,184,100,.14) 0 9deg, transparent 9deg 18deg), linear-gradient(160deg, #2a1c0c, #120b04)',
        oval: '#b88235', text: 'महाभारत', textColor: '#1f1406',
      },
      accent: '#e2b56e',
      fx: null,
    },
  };
})();
