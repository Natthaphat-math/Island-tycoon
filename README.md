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
- **UI:** collapsible build drawer (left by default, switchable to the right) with category
  tabs and an **EDIT** toggle. In edit mode, tapping a building picks it up to move, rotate
  or sell (sell asks twice). Outside edit mode, taps only collect, fire or put out fires.
  All info and buttons live in one **dock** in the bottom corner opposite the drawer, which
  hops to the other corner if it would cover what you're touching. A phase clock and bar
  sit in the top bar, and the order card sits in the top corner.
- Autosaves to localStorage. Time only runs while the tab is visible.

## Run it

```sh
python3 -m http.server 8000   # then open http://localhost:8000/
node --test tests/*.test.js   # core logic tests (Node 18+, no dependencies)
```

Opening `index.html` straight from disk also works.

Mouse & keyboard: **1–8** pick a building · **R** or mouse wheel rotate · click to build ·
**E** edit mode (click a building to pick it up; **X** sells the held one) · **Esc** /
right-click cancel · **Tab** hide the drawer · **G** grid · **N** skip to the next phase
(testing).

Touch: tap a card, drag or tap to position, then ✓ (or tap the same tile again). EDIT, then
tap a building to move, rotate or sell it. Tap full buildings to collect, or to fire at
night. Tap fires to put them out. Tapping a building that isn't full shows its info in the
dock.
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

- Fixed internal resolution **320×180**; Phaser `pixelArt: true`, `roundPixels: true`.
- Only whole-number zoom. "Auto" picks the biggest whole multiple in *device* pixels, so
  each game pixel is an exact N×N block even on fractional-DPR phones.
- All art is drawn in code, pixel by pixel, into canvas textures (`src/pixel.js`). There
  are no image assets, and textures are never deleted at runtime.

## Files

```
index.html               page shell, controls, help sidebar
lib/phaser.min.js        Phaser 3.80.1 (vendored, so it works offline / on itch.io)
lib/break_eternity.min.js  big-number library (MIT, vendored)
src/core/grid.js         placement rules + aura evaluation (pure, tested)
src/core/economy.js      wallet, prices, fill/collect/combo, saves, number formatting (pure, tested)
src/core/night.js        day/dusk/night/dawn clock, raiders, firing, landing, fires + drain, loot (pure, tested)
src/core/orders.js       villager orders: draw, progress, reward, restore (pure, tested)
src/pixel.js             Painter (per-pixel drawing), pixel font, PixelText
src/common-art.js        UI panels, cards, currency icons, bubbles, badges, lights
src/styles/sunlit.js     palette, sprites, island map and starting layout
src/styles/square-terrain.js  smooth pixel coastline + water animation
src/scene.js             rendering, drawer, dock, edit mode, placement, raiders, orders card, dawn report
src/main.js              boot, integer zoom, page controls
tests/*.test.js          node:test suites for the core (grid, economy, night, orders)
```

## Next

- Money sinks (see the design discussion): building upgrades, land expansion, night tools,
  prestige.
- Day events (fish shoals, merchant ship).
- Prestige with diamonds.
- Copy/paste save codes (`Economy.serialize` / `deserialize` already validate input).
- Balance pass on all the placeholder numbers.
