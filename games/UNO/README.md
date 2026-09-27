# UNO Ultimate

A web-based UNO game you can play against the computer or with friends anywhere, using a shareable link.

- **Single player:** play against 1–9 computer opponents.
- **Multiplayer:** 2–10 seats per room. Share the link, and any empty seats can be filled with computer players.
- **Game modes:** Classic UNO, UNO Flip, UNO Show 'em No Mercy, Liar's UNO, and Mega Draw (+15), which is an example of a home-made mode.
- **Themes:** Classic, Frozen ❄, Ramayanam 🏹, Mahabharatam ⚔
- **House rules in the lobby:** starting hand size, stacking draw cards, draw until you can play, 7-0 swapping, liar mode, and a knock-out card limit.
- **Custom cards in the lobby:** add cards such as *Wild Draw +15 ×4* with no code changes.
- **Reconnects:** if you refresh or lose your connection, you go back to your seat. A computer plays for a disconnected player after 15 seconds.

## How it runs

UNO runs entirely in the browser, with no server. It's served as static files from the Game Room site (GitHub Pages / Vercel).

- **Solo games** run inside your own browser.
- **Online games:** the player who presses **Create room** hosts the game in their browser. Friends who open the invite link connect straight to that browser over WebRTC ([PeerJS](https://peerjs.com)), the same way Poker works. The host's browser enforces the rules and sends each player only their own hand.
- If a guest refreshes or drops, they rejoin their seat automatically, and a computer plays for them after 15 seconds. **If the host closes their tab, the room ends**, because the game lives in the host's browser.

To play locally, serve the repo root with any static server:

```bash
python3 -m http.server 8000
# open http://localhost:8000/games/UNO/
```

## How to play

1. Enter your name.
2. **Play vs Computer:** pick a mode, a theme and how many opponents, then press **Play now**.
3. **Play with Friends:** press **Create room**, then **Copy link** and send it. Friends open the link and press **Join**. As host, you can add computer players, change the mode, theme and house rules, then press **Start**.
4. Cards you can play are raised and outlined. Press **UNO!** when you are down to 2 or 1 cards. If you forget, others can **Catch** you for +2.

### Mode notes
- **UNO Flip:** a Flip card turns every card over to the Dark side (Draw 5, Skip Everyone, Wild Draw Colour). You can see the *other* side of your opponents' cards.
- **No Mercy:** draw cards stack, you draw until you can play, 7 swaps hands, 0 passes all hands, and anyone who reaches 25 cards is knocked out.
- **Liar's UNO:** every card is played face-down while you *announce* what it is, and lying is allowed. The next player either believes you or calls **LIAR!**
  - Caught lying: take the card back and draw 2.
  - Wrong accusation: the accuser draws 2.

## Adding your own modes and themes

### A new theme
Edit [js/themes.js](js/themes.js): copy an existing theme block, give it a new key, and change the card colours and their names, the action-card names, the table cloth, the table edge, and the printed card back. It appears in the theme menus automatically.

To preview your theme, open `games/UNO/dev/gallery.html` on your local server. It shows every card type in every theme.

### A new game mode
1. Copy [core/variants/megadraw.js](core/variants/megadraw.js) to a new file.
2. Change its `id`, `name`, `description`, default `rules`, and `buildDeck()` (the list of cards).
3. Register it in [core/variants/index.js](core/variants/index.js).
4. Run `npm run build` to regenerate `js/engine.bundle.js`, the browser copy of `core/`.

The card types the engine understands are listed at the top of [core/engine/cards.js](core/engine/cards.js): numbers, skip, reverse, draw +N, skip everyone, discard all, flip, wild, wild draw +N, wild reverse draw +N, colour roulette and wild draw colour. Any combination and any +N value works, for example a "UNO +15" deck.

If you want a card type with a completely new effect, add a `case` for it in `resolvePlay()` in [core/engine/game.js](core/engine/game.js), then run `npm run build`.

## Project layout

```
core/                  rules + rooms (plain CommonJS; the single source of truth)
  rooms.js             rooms, invite codes, host controls, reconnects, bot timing
  engine/game.js       the rules engine (the host enforces the rules: players can't cheat)
  engine/bot.js        computer player AI
  engine/cards.js      card types and matching rules
  variants/            one file per game mode
js/
  engine.bundle.js     GENERATED from core/ by `npm run build` - don't edit
  net.js               in-browser stand-in for the old Socket.IO server + PeerJS
  app.js               client UI
  cards.js, themes.js  card rendering and theme definitions
index.html, css/style.css, assets/logo.png
tools/bundle.js        builds js/engine.bundle.js
tests/simulate.js      plays thousands of bot-only games in every mode to catch rule bugs
```

Run the rules test with `npm test`.
