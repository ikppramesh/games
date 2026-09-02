# 🎲 Ramesh's Game Room

A small collection of browser games you can play online with a friend — just open a link, no installs, no accounts.

Play it live:
- GitHub Pages: `https://ikppramesh.github.io/games/`
- Vercel: [https://irgames.vercel.app/](https://irgames.vercel.app/)

## Games

| Game | Status | Path |
|---|---|---|
| 🧊 Table Shuffleboard | Live | [`games/table-shuffleboard/`](games/table-shuffleboard/) |
| ♠️ Texas Hold'em Poker | Live | [`games/poker/`](games/poker/) |
| 🦇 Snakes & Ladders: Gotham | Live | [`games/snake-and-ladder/`](games/snake-and-ladder/) |
| ♟️ Chess | Planned | — |
| 🏠 Monopoly / Indian Business | Planned | — |
| ❌⭕ Tic Tac Toe | Planned | — |

## How online play works

These games are static HTML/JS/CSS — no backend server to run or pay for. Online multiplayer uses **WebRTC** (via [PeerJS](https://peerjs.com)) so two browsers connect **directly to each other**:

1. Player A opens the game and clicks **Create Game**, which generates a short room code and a shareable link.
2. Player A sends that code/link to Player B (text, WhatsApp, whatever).
3. Player B clicks **Join Game** and enters the code — the two browsers form a direct peer-to-peer connection and the match starts.

PeerJS's free public broker is only used to help the two browsers find each other; once connected, game moves travel directly between the two players' devices.

Poker and Snakes & Ladders extend this to a host + several guests (one table, up to 6 seats for poker, 4 for snakes & ladders) instead of 1-on-1 - the host runs the game and broadcasts state to every guest (personalized per-viewer for poker, so nobody sees anyone else's hole cards until showdown). All three games also have a practice/solo mode against computer-controlled opponents.

## Running locally

Any static file server works, e.g.:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying with GitHub Pages

Settings → Pages → Deploy from branch → `main` / `/ (root)`. The site will be available at `https://<username>.github.io/<repo>/`.

## Adding a new game

Create a new folder under `games/<game-name>/` with its own `index.html` (self-contained, or with its own CSS/JS files), then add a card for it on the root [`index.html`](index.html).
