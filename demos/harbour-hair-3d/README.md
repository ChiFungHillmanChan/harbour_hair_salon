# Harbour Hair — interior study

A standalone, offline-capable HTML interior demo. The model uses the salon's own seven gallery photographs for its finishes and furniture, with the layout updated from the owner's description. Dimensions remain estimates, not a measured survey.

## Build

From the repository root (with the main project's dependencies already installed):

```sh
pnpm --dir demos/harbour-hair-3d install
pnpm --dir demos/harbour-hair-3d build
```

The build compiles Tailwind utilities, bundles Three.js and embeds the reference photographs into `public/harbour-hair-3d.html`. Open that file directly in a WebGL 2 capable browser, or serve `public/` with a local HTTP server. No API keys, database, CDN connection, or Next.js server is required. The output can be shared as one HTML file. No production deployment is performed.

## Experience

- Orbit and zoom the dollhouse; see an overhead plan; enter at eye level.
- Walk with WASD / arrow keys or touch controls; drag to look. Basic collision prevents passing through walls and major furniture; eye height follows the two steps up to the styling floor.
- Visit reception, styling, wash and colour zones; take a guided tour.
- Explore the fixed photo-based finishes; adjust daylight and reset the view.
- Inspect the real source photographs and save a PNG of the model.
- Toggle the eye for a model-only view; press it again (or Escape) to restore controls.

## Design and evidence

The model keeps the defining dark speckled tiled floor, white walls, halo mirrors, hydraulic chairs, pale fluted reception desk, wash basins, privacy screen, high window, product shelves and rolled towels. The calligraphy is reproduced as a texture from the salon photo, not transcribed. Material choices are removed; the floor, walls and furniture retain the actual salon palette.

The owner's layout corrections reserve approximately 80% of the wash/colour section for the service area and 20% for the side aisle. Reception has a gently inset entrance, giving the salon a stepped rather than rectangular footprint. The latest entrance photographs supersede the earlier 10/20/30 sketch: the inset is smaller and the glazed reception side continues all the way to the wash divider, where one glass return meets the straight main wall. The former projecting glass pocket is removed; a compact circular clothes rail stands just inside this single step. The wall behind the rail is solid white; glazing remains only along reception and at the short corner return. The high horizontal wall strips are removed. The smaller toilet is recessed behind a longer flat, continuous white reception screen without a projecting return, with the staff exit kept clear. A compact sink sits directly beside the WC on its wash-divider side, recessed to the same front line and facing the aisle in the same direction as the toilet door.

Three sideways wash stations follow the divider. The latest close-up photographs replace the earlier long-bed approximation with compact shampoo couches: oval bowls integrated into black padded head surrounds, shallow reclined upholstery, an ivory lower shell, a black cylindrical head pedestal and an angular ivory foot support. The room is narrower and shorter, with closer styling stations and less unused floor area; chairs and bowls retain human-scale proportions instead of stretching to fill the old room. This supersedes the earlier 70% wash-length interpretation.

The transverse colour counter has open cubbies on both faces, with visible gaps between towels, bottles and colour stock. A taller open tower terminates its wall end. Only the side aisle has two steps; the rest of that edge is occupied by the colour bar. Looking from the styling floor toward reception, the steps and glass step with its circular coat rack are on the left. A landing connects the stair to the central styling aisle. The reception frontage has pale vertical ribs over narrow dark grooves, with a dark countertop and a pale edge.

New close-up references refine the entrance to frameless, lightly tinted glass with small chrome patch hinges, a long pull handle and staggered reflective/frosted rectangles. Reception has pale grey ribs over dark grooves, a light stone top, wooden-coloured Harbour Hair sign, leaflets and a ceramic bowl. The WC has a white six-panel moulded door and round chrome knob, without an invented WC plaque. Beside it is a charcoal cupboard with an oak worktop, a round inset steel basin, pale tiled splashback, shallow wood-edged upper storage and colour bottles. The sink bay is widened to an estimated 80 cm; reception, WC and the entrance move forward together by 35 cm to preserve the existing staff gap. The wash, styling and public aisle positions remain unchanged.

The room dimensions, 18 cm step rises, toilet footprint and glazing projection are visual estimates. Source photographs are retained unchanged, including photographs showing two basins; the model keeps the three stations specified by the owner. The toilet interior is illustrative; its position, white door and full-height enclosure are based on the supplied references. Furniture is modelled from the photographs rather than a manufacturer’s measured specification.

Hidden spaces and exact measurements are deliberately not claimed. Daylight settings are visual explorations, not recorded salon conditions.

Sources checked 29 September 2026:
- https://www.harbourhair.co.uk/contact
- https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/
- Local originals: `public/images/gallery/salon-1.webp` through `salon-7.webp`

The interface uses a slate-blue canvas, Harbour blue (#174F7F), frost-blue accents, warm ivory model surfaces and charcoal furniture. Quiet tools frame the detailed miniature. System sans-serif typography keeps the file independent of font services. Styling is compiled Tailwind; there is no runtime CSS CDN.

## Website and performance

The public website embeds this file at `/3d` and `/zh-hk/3d`, linked as **3D** in desktop and mobile navigation. No Three.js code loads on other routes. The iframe loads lazily and sends visibility notifications; hidden tabs, offscreen frames and photo/export dialogs stop the render loop. Resting scenes stop rendering after camera damping settles.

The website passes its selected language to both the iframe and direct-open link (`?lang=en-GB` or `?lang=zh-HK`). The standalone file defaults to English and includes Traditional Chinese translations for navigation, room labels, lighting, dialogs, photo captions, hints, accessibility labels and errors. Changing website language reloads the same scene in that language. Physical salon signs and the Harbour Hair brand remain as photographed.

`rendering.js` merges static furniture parts by material while retaining cutaway-wall visibility. Touch devices, narrow views and low-core devices use a 30 fps cap, at most 1 million drawing-buffer pixels and DPR 1.15, with static mirror faces and no shadow pass. Desktop uses a 60 fps cap, 2.2 million pixel budget, 512px reflections and cached 1024px shadows. Device performance still varies; viewport tests are not a substitute for real phone GPU testing. The model keeps mouse, keyboard, touch walking controls and short-landscape layouts.

Run `pnpm demo:test` and `pnpm demo:build` before committing. CI installs the pinned demo dependencies, runs layout/rendering tests, audits them and checks the generated HTML against the committed file. Production continues through the existing GitHub Actions workflow after CI passes. The asset allows only same-origin framing; all other site routes retain their existing frame-denial headers.

## Source structure

- `index.html` — semantic tool interface and photo dialogs
- `interface.js` — UI state and input events
- `i18n.js` / `i18n.test.js` — standalone EN/ZH translations, locale selection and coverage checks
- `scene.js` — geometry, materials, lighting, navigation and rendering
- `layout.js` — shared room dimensions, furniture collision and floor height
- `layout.test.js` — walking route, fixture clearance and stair-height checks
- `rendering.js` / `rendering.test.js` — device budgets and static mesh batching with transform/visibility checks
- `build.mjs` — standalone HTML bundler

Three.js is MIT licensed; its notice is retained in the bundled output.
