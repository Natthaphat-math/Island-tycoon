# Island Tycoon

Prototype of a pixel-art island tycoon game (Phaser 3, no build step). It's played actively: no idle or offline income.
The art direction is **Sunlit 3/4**: 16px top-down tiles with 3/4-view sprites and the
Endesga-32 palette. The other two explored directions (pastel isometric, micro 8px) are in
git history (commit `f627912`).

**Done so far:**
- **Grid & placement:** 1×1, L-3, line-3, T-4, 2×2 and big L-5 footprints, with rotation,
  moving, selling and a live aura preview.
- **Economy:** buildings fill up over their cycle, then *wait* until tapped. There's no
  auto-collect and no offline income. Tapping within 1.5s of filling is **PERFECT** (×1.5;
  the coin flashes gold). Fast tap streaks give +10% per step, up to ×3. Costs grow ×1.15
  per copy. All money is `break_eternity.js` Decimals.
- **Money sinks:**
  - **Upgrades** (per building, silver, levels 1–5; the price triples per level): income
    buildings get ×2 output per level. Markets add +0.25 to their boost per level.
    Watchtowers reload faster and guard one tile wider from level 3. Selling refunds half
    of the upgrade silver too.
  - **Land** (build menu, LAND tab): buy dotted tiles next to the island, one at a time
    (sea → sand, sand → grass). The price grows ×1.35 per tile, and the terrain is
    re-rendered and saved.
  - **Merchant ship** (`src/core/merchant.js`): docks once a day for 30s. It sells a fire
    bucket (saves the next fire), a net (that night's raiders are 30% slower) and cannonballs
    (fired from the night toolbar at the closest raider), plus currency swaps: bronze →
    silver or silver → gold.
- **Fishing** (`src/core/fishing.js`): by day a ripple appears on the water by the shore.
  Tap it to cast, then wait 2.5–6s for a bite (you can keep collecting meanwhile). Which
  fish it is (sardine, snapper, tuna or pearlfish, weighted by rarity) stays a secret, shown
  as "???" and a silhouette, until it's landed and revealed on a catch card. It shows
  a set of coins; tap buildings that make them, in order, each within 2s of the last or the
  set restarts. A gauge drains all the time; correct taps and finished sets fill it (after each set
  there's a 1.5s pause, and the gauge holds still), and a full gauge lands the fish (never before 2 sets). Rarer fish want rarer coins, even ones
  the island can't make yet. Caught fish go to the hold (sell them in the fish book) and the
  book itself: every species ever caught adds +5% to all income, for good.
- **Music** (`src/audio/`): a small Web Audio synth and step sequencer. There are no audio
  files; songs are note data. The day theme comes in three arrangements, picked in
  Settings: Sunlit Marimba, Pocket Breeze (chiptune) and Tidal Pixels (a mix of the two).
  Layers follow the clock (sparse morning, full midday, warmer afternoon) and fade out at
  dusk; dusk and night tracks come later. Coin taps are tuned to the current chord, climb
  the pentatonic scale during a streak, snap to the beat (optional), and a 3+ streak
  brings in an extra percussion layer. `music-lab.html` plays the songs on their own.
- **Villager orders** (`src/core/orders.js`): one small daytime goal at a time (tap a
  building type N times, reach a streak, land N perfect taps, earn X bronze, build Y). Each
  pays bonus bronze, and the next arrives shortly after.
- **Day/night loop** (`src/core/night.js`):
  - Day (90s) → dusk (12s): raiders appear offshore, each showing a row of currency pips.
  - Night: tap a **full building inside tower coverage** to fire its batch at the raider
    whose next pip matches that building's currency (closest to shore first). Finish the
    row to sink it for loot (bronze, sometimes a diamond).
  - At least 3 raiders a night (up to 8). When there are more raiders than sea lanes, the
    extras queue further out and come in later.
  - **Shield pips** (from day 3): answered by tapping a watchtower itself (3s reload).
  - **War canoe** every 5th night: double size, 3 extra pips, slower, 5× loot plus 2
    diamonds.
  - A raider that lands steals 10% of bronze, silver and gold and sets a building on fire.
    Tap the fire 10× to put it out. Meanwhile the building earns nothing and burns 1% of
    your bronze per second (at least 1), shown as red numbers. Left alone for 6s, a fire
    **spreads** to a touching building, and again every 6s.
  - Dawn shows a report, then the next day starts. Raiders grow in number and pip count
    with the days.
- **UI:** a menu rail (left by default, switchable to the right in settings) with **Build**
  (a drawer with category tabs plus LAND), **Edit**, the **fish book** and **settings**
  in two tabs: Sound (day music, volume, coins on the beat) and Game (how to play, menu side,
  grid, reset view, fullscreen, skip phase, new island).
- **Editing:** hold a building to enter edit mode, then drag & drop it. An invalid drop
  snaps back. The building stays selected, and the dock offers rotate (in place, nudging
  one tile if needed), upgrade, sell (asks twice) and done. Tap empty space to leave edit
  mode. On desktop, right-click a building to pick it up and left-click to drop it.
  Outside edit mode, taps only collect, fish, fire or put out fires.
- **Camera:** drag to pan, pinch or mouse wheel to zoom between 1× and 3×. The zoom glides
  smoothly and then settles on a whole number, so pixels stay crisp. The world is a
  640×400 sea around the island. Raiders start far out, and any that are off-screen get
  blinking markers on the screen edge.
- All info and buttons live in one **dock** in the bottom corner opposite the menu, which
  hops to the other corner if it would cover what you're touching. A phase clock and bar
  sit in the top bar, and the order card sits in the top corner.
- Autosaves to localStorage. Time only runs while the tab is visible.

## Run it

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
node --test tests/*.test.js   # core logic tests (Node 18+, no dependencies)
```

Opening `index.html` straight from disk also works.

Mouse & keyboard: **1–8** pick a building · **R** rotate (the held or selected building) ·
click to build · wheel zoom (rotates while holding a new building) · **+ / −** zoom · drag
to pan · right-click a building to pick it up, left-click to drop · **E** edit mode
(**X** sells the selected building) · **Esc** cancel / close · **Tab** build menu ·
**B** fish book · **G** grid · **N** skip to the next phase (testing).

Touch: tap a card, drag or tap to position, then ✓ (or tap the same tile again). Hold a
building to pick it up and drag it. Tap full buildings to collect, or to fire at night.
Tap ripples to fish. Tap fires to put them out. Tapping a building that isn't full shows
its info in the dock. Pinch to zoom, drag to pan.
- Held sideways, phones go edge-to-edge: the page header hides behind a ≡ button, and
  safe areas and notches are respected. Held upright, a banner suggests turning sideways.
- The game surface blocks scrolling, pinch-zoom, text selection and long-press callouts.
  Coins have enlarged hit boxes, and taps on a building's tile count even when the sprite
  is small.

## How it's built

- **`src/core/grid.js`** holds the rules: building roster, footprints, rotation, placement
  checks, aura cells, and `evaluate()` (every building's multiplier and output) plus
  `preview()` (what placing something would change). It's pure functions over a plain JSON
  state object, doesn't depend on Phaser, and is covered by `tests/`. The state is already
  serialisable for localStorage autosave and save codes later.
- **`src/scene.js`** only renders that state and turns input into core calls.
- **Shaped buildings** (longhouse, workshop, plantation) aren't hand-drawn per rotation.
  `compound()` in `sunlit.js` draws a hip roof and south-facing walls for *any* footprint,
  and `field()` does the same for crops. Every rotation, and any future shape, gets a
  sprite and correctly placed night-window lights for free. New shapes are data-only:
  add a footprint to `Core.BUILDINGS` and a one-line `shaped(...)` call.
- Auras are a Chebyshev radius around the footprint (1 = the touching ring). Economy auras
  cover land only, defense auras reach over the sea. Rules are data in `Core.RULES`:
  additive bonuses are summed, multipliers are multiplied:
  `mult = (1 + Σadd) × Πmul`. All numbers are placeholders.

## Rendering setup

- The game fills the whole screen (phone, tablet or window) at **device resolution**: one
  game pixel is one device pixel, so every art pixel is an exact N×N block at any zoom.
  Phaser `pixelArt: true`, `roundPixels: true`; rotation, window resizes and browser bars
  resize the canvas live.
- Two cameras. The UI camera draws every scroll-factor-0 object at the biggest whole-number
  scale that still leaves a layout of at least 320×180 UI pixels (wider on phones, taller
  on iPads), and the UI is rebuilt when that layout changes. The world camera pans and
  zooms; zoom settles on whole numbers, from "whole sea visible" to 1.5× the UI scale.
  Before each render, every object is filtered to exactly one of the two cameras.
- The page is only the game; "How to play" (the rules) opens from Settings. On
  iPhone/iPad, Share → Add to Home Screen runs it without the browser bars.
- All art is drawn in code, pixel by pixel, into canvas textures (`src/pixel.js`). There
  are no image assets, and textures are never deleted at runtime.

## Files

```
index.html               full-screen page shell, how-to-play overlay
lib/phaser.min.js        Phaser 3.80.1 (vendored, so it works offline / on itch.io)
lib/break_eternity.min.js  big-number library (MIT, vendored)
src/core/grid.js         placement rules + aura evaluation (pure, tested)
src/core/economy.js      wallet, prices, fill/collect/combo, saves, number formatting (pure, tested)
src/core/night.js        day/dusk/night/dawn clock, raiders, firing, landing, fires + drain, loot (pure, tested)
src/core/orders.js       villager orders: draw, progress, reward, restore (pure, tested)
src/core/merchant.js     merchant ship visits, offers, night tools (pure, tested)
src/core/fishing.js      ripples, casting, coin sets, gauge, fish book bonus, selling (pure, tested)
src/pixel.js             Painter (per-pixel drawing), pixel font, PixelText
src/common-art.js        UI panels, cards, currency icons, bubbles, badges, lights
src/styles/sunlit.js     palette, sprites, island map and starting layout
src/styles/square-terrain.js  smooth pixel coastline + water animation
src/scene.js             rendering, cameras, menu rail, dock, drag & drop editing, fishing, raiders, modals
src/main.js              boot, full-screen sizing, page API (help, fullscreen, grid, side)
src/audio/music.js       synth voices, reverb/echo, sequencer, tuned coin sounds
src/audio/songs.js       the day theme and its three arrangements (note data)
src/audio/soundtrack.js  connects music to the game: phases, settings, coin taps
music-lab.html           standalone page to compare the arrangements
tests/*.test.js          node:test suites for the core (grid, economy, night, orders, merchant, fishing)
```

## Next

- More fish, and fishing upgrades (rods, bait).
- Full desktop polish (keyboard panning, drag from a card onto the map).
- Prestige with diamonds.
- Copy/paste save codes (`Economy.serialize` / `deserialize` already validate input).
- Balance pass on all the placeholder numbers.
