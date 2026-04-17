# Karrie's Kitchen — Claude Code Context

## Project overview

Karrie's Kitchen is a **single-file HTML recipe app** (`KarriesKitchen.html`). No build tools, no framework, no server — open it in any browser and it runs. All data persists in `localStorage`. The Anthropic API is called directly from the browser using the user's own API key.

The file is ~1,265 lines structured as: `<style>` → `<body HTML>` → `<script>`. All CSS, HTML, and JS live in one file. Do not split into separate files unless explicitly asked.

> **v2 rebuild lives in a separate repo.** The full Vite + React + TypeScript rebuild per the April 2026 plan is at `kosdiaz-design/Karries-Kitchen-2`. This repo (v1) keeps shipping bug fixes until v2 reaches parity, then gets retired. Do not add v2 code here.

---

## Tech stack

- **HTML/CSS/JS** — vanilla, no dependencies, no npm
- **Fonts** — Google Fonts: `Playfair Display` (headings) + `DM Sans` (body)
- **AI** — Anthropic API `claude-haiku-4-5-20251001` called via `fetch` with header `anthropic-dangerous-direct-browser-access: true`
- **Storage** — `localStorage` only (no backend, no database)
- **Deployment** — static HTML file; can be served on Railway or GitHub Pages with a minimal Express wrapper

---

## localStorage keys

| Key | Contents |
|-----|----------|
| `ck_imported` | `Recipe[]` — all user-imported recipes |
| `ck_tracking` | `{ [recipeId]: { rating: string\|null, log: LogEntry[] } }` |
| `ck_urls` | `{ [recipeId]: string, ['cat_'+id]: string }` — YouTube URL overrides and category overrides for built-in recipes |
| `ck_api_key` | Anthropic API key string |
| `ck_units` | `'us'` or `'metric'` |
| `ck_theme` | `'light'` or `'dark'` |
| `dd_imported` | **Legacy key** — migrated to `ck_imported` on first load. Do not delete migration code. |
| `dd_tracking` | **Legacy key** — migrated to `ck_tracking` on first load. |

---

## Data model

### Recipe object

```js
{
  id: number,               // built-ins: 1–12; imported: 100+
  title: string,            // lowercase, e.g. "banana bread"
  category: string,         // see Categories section
  source: string,           // e.g. "Toasty Apron" or "Manual entry"
  ytUrl: string,            // YouTube or source URL, empty string if none
  yield: string,            // e.g. "4 servings" or "12 bars"
  baseServings: number,     // numeric base for serving adjuster
  prep: string,             // e.g. "20 min"
  cook: string,             // e.g. "45 min" or "None"
  storage: string,          // e.g. "Fridge 3 days"
  calories: number|null,
  macros: null | {
    protein: string,        // e.g. "18g"
    fat: string,
    carbs: string,
    fibre: string
  },
  ingredients: [{ a: string, n: string }],  // a = amount string, n = name
  steps: string[],          // condensed one-liners
  tips: string[]
}
```

### Tracking object (per recipe id)

```js
{
  rating: 'A'|'B'|'C'|'D'|'F'|null,
  log: [{ date: string, note: string }]   // date = "Apr 9, 2026" format
}
```

---

## Categories

Valid category values and their display labels:

| Value | Label |
|-------|-------|
| `protein` | Protein bar |
| `mousse` | Mousse |
| `chia` | Chia pudding |
| `breakfast` | Breakfast |
| `lunch` | Lunch |
| `dinner` | Dinner |
| `dessert` | Dessert |
| `snack` | Snack |
| `soup` | Soup |
| `salad` | Salad |
| `bread` | Bread |
| `drink` | Drink |
| `sides` | Sides |
| `other` | Other |

The constants `ALL_CATS` (array) and `CAT_LABEL` (object) at the top of `<script>` are the source of truth. Update both when adding a category.

Tag CSS classes follow the pattern `.tag-{category}`. Each maps to a color pair from the CSS variables. See the `/* ── Tag colors ── */` section.

---

## Pages

The app has two pages toggled via `switchPage(p, btn)`:

| ID | Nav label | Description |
|----|-----------|-------------|
| `page-recipes` | Recipes | Home — search, filter pills, card grid |
| `page-admin` | Admin | AI Setup + 4-tab import/add panel |

### Admin tabs (inside `page-admin`)

| Tab ID | Panel ID | Function |
|--------|----------|----------|
| YouTube | `panel-youtube` | Paste transcript → AI extract |
| Web URL | `panel-url` | Paste page text + URL → AI extract |
| Instagram / Facebook | `panel-social` | Paste caption → AI extract |
| Manual | `panel-manual` | Form-based manual recipe entry |

All three AI tabs use the shared `runExtraction(text, urlRef, source, ...)` function. The `source` string (`'yt'`, `'web'`, `'social'`) maps to element IDs via a naming convention (e.g. `${source}-extract-btn`, `${source}-spinner`, `${source}-error`, etc.).

---

## Key functions

### Navigation & rendering
- `switchPage(p, btn)` — shows `page-{p}`, marks nav tab active
- `switchAdminTab(tab, btn)` — shows `panel-{tab}` within Admin
- `renderGrid()` — rebuilds the recipe card grid applying `currentFilter` and `searchQuery`
- `onSearch(val)` / `clearSearch()` — live search, filters by title + category + ingredient names

### Modal
- `openModal(id)` — finds recipe, sets `modalServings`, builds and injects modal HTML
- `closeModal()` — hides overlay, clears `activeModalId`
- `buildIngSection(id, servings)` — returns the ingredients HTML block including serving bar and collapsible wrapper
- `refreshIngSection(id)` — re-renders just the ingredient section in place (used by stepper and unit toggle)
- `toggleIngredients(id)` — shows/hides the `.ing-collapsible` div
- `buildTrackPanel(id)` — returns the tracker HTML (stats, rating buttons, log)
- `refreshTrackPanel(id)` — updates tracker in place without re-rendering the whole modal
- `saveCategory(id)` / `saveUrl(id)` — save category or URL edits from inside the modal

### Serving adjuster & units
- `changeServings(id, delta)` — increments/decrements `modalServings`, calls `refreshIngSection`
- `setUnitSystem(sys, id)` — sets `unitSystem` ('us'|'metric'), saves to localStorage, refreshes
- `scaleAmt(amtStr, factor, system)` — scales a single amount string; returns original if unparseable
- `parseAmt(s)` — parses an amount string into `{ qty, unit, unitInfo }`
- `reduceUS(qty, unitInfo)` — converts to best-fit US unit (tsp → tbsp at 3 tsp, tbsp → cup at 12 tsp)
- `toMetric(qty, unitInfo)` — converts US amounts to metric

### Tracking
- `getTrack(id)` — returns tracking object for recipe id (or default empty)
- `setRating(id, grade)` — saves A–F rating, re-renders grid + panel
- `addLogEntry(id, note)` — adds a dated log entry
- `deleteLogEntry(id, idx)` — removes a log entry by index
- `quickMarkMade(id)` — marks made with optional note from the input field

### Admin / import
- `runExtraction(text, urlRef, source, btnId, spinnerId, errId, previewId, previewCountId, addBtnId, previewCardId)` — shared AI extraction engine
- `showAdminPreview(recipes, ...)` — renders recipe preview card from AI result
- `addPending(source)` — adds `pendingMap[source]` recipes to `imported`, saves, navigates to grid
- `addManual()` — reads manual form fields, constructs recipe object, saves
- `extractFromYT()` / `extractFromWeb()` / `extractFromSocial()` — wrappers that call `runExtraction` with correct element IDs

### API key
- `saveKey()` — validates, saves to localStorage, calls `showKeySaved(k)`
- `showKeySaved(k)` — hides entry row, shows masked display (`sk-ant-a••••••••xyz`)
- `editKey()` — restores entry row for re-input

### Theme
- `toggleTheme()` / `applyTheme(t)` — light/dark toggle, saves to `ck_theme`

---

## CSS architecture

### Design tokens (CSS variables)
All colors use `--variable` names so dark mode works by swapping `:root` values under `[data-theme="dark"]`. Never hardcode hex colors in new components — use existing variables or add new ones in both `:root` and `[data-theme="dark"]`.

Key variables:
```
--cream          page background
--warm-white     card / modal / header background
--text-dark      primary text
--text-mid       secondary text
--text-light     muted / placeholder text
--border         subtle border (0.1 alpha)
--border-mid     emphasis border (0.18 alpha)
--radius         14px card corners
--radius-sm      8px inner element corners
--tt             transition shorthand
```

Color pairs (light bg + dark text) for tags and accents:
```
--green-light / --green-text
--purple-light / --purple-text
--amber-light / --amber-text
--blue-light / --blue-text
--teal-light / --teal-text
--pink-light / --pink-text
--red-light / --red-text
```

### Layout patterns
- **Card grid**: `.grid` — `repeat(auto-fill, minmax(280px, 1fr))`, gap 14px
- **Modal 2-col**: `.modal-2col` — `1fr 1fr` grid, collapses to 1 col at ≤580px. Left = ingredients, right = instructions.
- **Admin manual form**: `.manual-grid` — `1fr 1fr`, collapses at ≤540px
- **Filter pills**: `.filter-row` — flex wrap, centered

---

## AI prompt structure

All three import tabs use the same prompt template in `runExtraction`. The prompt:
1. Sends the raw text (truncated to 8000 chars)
2. Asks for a JSON array using the full category list (`CAT_LIST_STR`)
3. Requests `baseServings` as a number
4. Requests `ytUrl` pre-filled with the source URL
5. Expects US customary units in ingredient amounts

The model is `claude-haiku-4-5-20251001`. Do not change to Sonnet unless the user asks — Haiku is faster and cheaper for extraction.

---

## Built-in recipes

12 built-in recipes (IDs 1–12) defined in the `BUILTIN` const array. These are read-only in the array but their `category` and `ytUrl` can be overridden via `customUrls` in localStorage (`cat_{id}` and `{id}` keys respectively). The `init()` function applies these overrides on load.

**Do not renumber built-in IDs.** Imported recipes start at ID 100+.

---

## Known patterns to follow

### Adding a new category
1. Add value + label to `ALL_CATS` array and `CAT_LABEL` object
2. Add `.tag-{value}` CSS rule in the tag colors section (pick a color pair)
3. Add a filter button in `#filter-row` HTML
4. Add option to the `<select id="m-cat-in">` in the Manual tab

### Adding a new admin tab
1. Add a `<button class="admin-tab" onclick="switchAdminTab('{name}', this)">` in `.admin-tabs`
2. Add `<div class="admin-panel" id="panel-{name}">` in the admin body
3. Follow the `source` naming convention for element IDs if using `runExtraction`

### Adding a new modal section
1. Build HTML as a template literal in `openModal`
2. Append to the `document.getElementById('m-body').innerHTML` assignment
3. If it needs in-place refresh, give it a stable `id="section-${id}"` and write a `refreshX(id)` function

### Modifying the serving adjuster
- `buildIngSection` returns the full HTML; `refreshIngSection` swaps it in place
- `modalServings` and `modalBaseServings` are module-level state — reset in `openModal`
- `modalIngredients` is set from `r.ingredients` in `openModal`

---

## What NOT to do

- Do not add `npm`, `node_modules`, or a build step — this is intentionally zero-dependency
- Do not use `innerHTML` on user-provided text without sanitisation if adding user-facing text input that renders HTML
- Do not change localStorage keys from `ck_*` — the migration from `dd_*` already ran and changing keys again will lose data
- Do not remove the `dd_imported` / `dd_tracking` migration block in `init()` — users may still have old data
- Do not add `position: fixed` elements inside the modal — the modal is already `overflow-y: auto` and fixed children collapse it
- Do not inline large amounts of data in the script tag — the BUILTIN array is already long; new recipes should be added to it carefully

---

## Planned features (not yet built)

From the Karrie's Kitchen enhancement plan:

| Feature | Notes |
|---------|-------|
| Shopping list / pantry check | Per-recipe ingredient checklist; Publix vs Walmart split |
| Persistent pantry memory | localStorage per recipe — staples pre-checked |
| Print / PDF recipe card | Clean single-page print view, no UI chrome |
| Multi-device sync | Would require Railway + Postgres backend |
| ISF 27:17 integration | Hook into the ISF platform nutrition module |

---

## Deployment (Railway)

To deploy on Railway:

1. Create `server.js`:
```js
const express = require('express');
const path = require('path');
const app = express();
app.use(express.static('.'));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'KarriesKitchen.html')));
app.listen(process.env.PORT || 3000);
```

2. Create `package.json`:
```json
{
  "name": "karries-kitchen",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^4.18.0" }
}
```

3. Push both files + `KarriesKitchen.html` to GitHub
4. Connect repo to Railway → auto-deploys on every push

**Note:** Because this app uses `localStorage`, data does not persist across devices or browsers in the Railway deployment. For shared data, a Postgres backend would be needed (see Planned features).
