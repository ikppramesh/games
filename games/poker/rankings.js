/* Hand rankings cheat sheet - a beginner-friendly chart of the ten poker
   hands (best to worst) with example cards, shown beside the table. While a
   hand is in play it highlights the row matching your current best hand. */
(function (global) {
  // [key, title, blurb, example cards; a trailing "~" marks a kicker (dimmed)]
  const HANDS = [
    ['royal', 'Royal Flush', 'A K Q J 10, all one suit', ['AD', 'KD', 'QD', 'JD', 'TD']],
    [8, 'Straight Flush', 'Five in a row, all one suit', ['JS', 'TS', '9S', '8S', '7S']],
    [7, 'Four of a Kind', 'Four cards of the same rank', ['9H', '9C', '9D', '9S', 'KH~']],
    [6, 'Full House', 'Three of a kind + a pair', ['AH', 'AC', 'AD', '3S', '3H']],
    [5, 'Flush', 'Any five of the same suit', ['KC', 'TC', '8C', '7C', '5C']],
    [4, 'Straight', 'Five in a row, mixed suits', ['TH', '9C', '8D', '7S', '6H']],
    [3, 'Three of a Kind', 'Three cards of the same rank', ['7H', '7D', '7C', 'QS~', '3H~']],
    [2, 'Two Pair', 'Two different pairs', ['JH', 'JC', '5D', '5S', '7H~']],
    [1, 'Pair', 'Two cards of the same rank', ['AH', 'AC', 'KD~', 'JS~', '7H~']],
    [0, 'High Card', 'Nothing else - highest card plays', ['KH', '8C~', 'QD~', '2S~', '7H~']]
  ];
  const SUIT = { S: '♠︎', H: '♥︎', D: '♦︎', C: '♣︎' };

  function miniCard(code) {
    const kicker = code.endsWith('~');
    const rank = code[0] === 'T' ? '10' : code[0];
    const suit = code[1];
    const red = suit === 'H' || suit === 'D';
    return `<span class="mini-card${red ? ' red' : ''}${kicker ? ' kicker' : ''}">` +
      `<span class="mc-rank">${rank}</span><span class="mc-suit">${SUIT[suit]}</span></span>`;
  }

  function mount(el) {
    el.innerHTML = `
      <div class="rk-head">
        <h2>Hand Rankings</h2>
        <button class="rk-close" type="button" aria-label="Close hand rankings">&times;</button>
      </div>
      <p class="rk-intro">Make the best 5-card hand from your 2 cards + the 5 on the table. Higher beats lower.</p>
      <ol class="rk-list">
        ${HANDS.map(([key, title, blurb, cards], i) => `
          <li class="rk-row" data-key="${key}" title="${title}: ${blurb}">
            <div class="rk-title"><span class="rk-num">${i + 1}</span>${title}<span class="rk-you">You</span></div>
            <div class="rk-cards">${cards.map(miniCard).join('')}</div>
            <div class="rk-blurb">${blurb}</div>
          </li>`).join('')}
      </ol>
      <p class="rk-foot">Dimmed cards are "kickers" - they only break ties.</p>`;
  }

  // category key for a player's cards so far (works preflop with only 2 cards)
  function currentKey(cards) {
    if (!cards || cards.length < 2) return null;
    if (cards.length >= 5) {
      const best = PK.bestHand(cards);
      if (!best) return null;
      return best.rank[0] === 8 && best.rank[1] === 14 ? 'royal' : best.rank[0];
    }
    const counts = {};
    for (const c of cards) counts[c.rank] = (counts[c.rank] || 0) + 1;
    const sets = Object.values(counts).sort((a, b) => b - a);
    if (sets[0] >= 4) return 7;
    if (sets[0] === 3) return 3;
    if (sets[0] === 2) return sets[1] === 2 ? 2 : 1;
    return 0;
  }

  function highlight(el, cards) {
    const key = currentKey(cards);
    el.querySelectorAll('.rk-row').forEach(row => {
      row.classList.toggle('current', key !== null && row.dataset.key === String(key));
    });
  }

  global.PokerRankings = { mount, highlight };
})(window);
