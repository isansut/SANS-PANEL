# SANS PANEL

A local web panel for driving one NinjaSaga.cc **or** NinjaSaga.online account. A small Node server talks
to the game's AMF/HTTP endpoints and exposes them as REST routes plus a WebSocket
log stream; the UI is a single HTML file.

It started as a fork of an older multi-game Ninja Saga panel. Everything except the
`ninjasaga` base game has been stripped out.

Not affiliated with NinjaSaga.cc or Ninja Saga. Run it on your own account at your
own risk.

# Credits

This project is derived from an older multi-game Ninja Saga panel. [Original Repo](https://github.com/AmahLiax/Ninja-Sage-Ninja-Saga-base-game-Panel/)
Credit and acknowledgment go to the original project author and contributors for their work.
This version has been modified to focus exclusively on the ninjasaga base game.
Please refer to the original repository and its license for attribution requirements and applicable terms.

## Requirements

- Node.js 18 or newer
- npm

## Run

```sh
npm install
npm start
```

Then open http://127.0.0.1:8000.

`npm run launch` starts the server and opens that URL in your browser.

Environment overrides:

- `PORT` — default `8000`
- `HOST` — default `127.0.0.1`

There is no authentication in front of the panel, so leave it bound to localhost.
If you expose the port, anyone who can reach it can drive the account.

## What it does

- Login and character selection, with quick login for the last account used.
- Live character readout: level, EXP, gold, tokens, rank, account type.
- Automated runs: leveling (missions, rank exams, level caps), TP training,
  SS training, Eudemon Garden, Mother's Day event, session bootstrap.
- Sakura and Halloween events, each with a target enemy to pick.
- Clan War: war list, target clan, delays, stamina refill source, bleeding mode,
  manual recruiters, captcha resume/verify.
- Settings for anti-detection delays, auto-spend, event resource policy and timing,
  Special Jounin class skill, TP/SS loop counts, and verbose debug logs.
- Live log stream over WebSocket, with text search, level filters and auto-follow.

## Links

- GitHub: [isansut](https://github.com/isansut)
