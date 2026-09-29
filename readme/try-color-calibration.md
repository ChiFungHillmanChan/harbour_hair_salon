# Try-colour research, measurement and validation

Updated 2026-09-29. The browser preview is an **uncalibrated visual estimate**. It does not infer dye history, prescribe salon recipes, or promise an achievable result. No manufacturer measurements are bundled.

## Evidence used

- [Shiseido PRIMIENCE](https://www.shiseido-professional.com/com/en/products/hair-color/primience.html): swatches depend on hair conditions; product lines differ, including grey-coverage formulation. The supplied PRIMIENCE level ruler is 4–15. The app's illustrative 1–10 scale is separate, with no invented conversion.
- [Wella technical folder](https://www.wella.com/professional/m/_master/products/koleston_perfect/pdfs/koleston-perfect_usagebooklet.pdf): distinguish depth, tone, underlying exposed pigment and product-specific lift. This informs scenario distinctions, not brand-independent developer recipes.
- [Kim & Suk, Electronic Imaging 2022](https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/ei/34/15/COLOR-374): a measured CIELAB hair-tress lookup approach is relevant. Their limited product/base coverage does not establish general accuracy on previously coloured/grey hair.
- [W3C CSS Color 4](https://www.w3.org/TR/css-color-4/): reference whites, conversion and colour difference. The preview's sRGB-derived Lab is **D65, 2-degree**, whereas CSS `lab()` is D50. Convert/adapt correctly; do not paste D65 values into CSS `lab()` or compare unlike measurement conditions.
- [Sharma, Wu & Dalal reference pairs](https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/): used to verify the independent CIEDE2000 calculation. These are mathematical test vectors, not hair measurements.

## Current user flow

Choose deposit-only, permanent-colour lift, or pre-lightening then colour. Record natural/coloured/lightened/unknown history and grey coverage. Pre-lightening either uses the current photo or an explicitly assumed orange, yellow or pale-yellow base; selecting an assumption does not imply it can be achieved in one visit.

The photo analysis samples hair interiors and separates approximate upper/middle/lower image zones. These are not detected anatomical roots or individual treated sections. Exposure/variation checks can identify some unsuitable inputs, but cannot prove neutral illumination or recover true reflectance. A dark hair pixel is not enough evidence to diagnose underexposure. No automatic colour cast correction is applied without a trusted reference.

Every unmeasured shade remains labelled illustrative. Colour history affects conservative lift rules; grey coverage produces uncertainty guidance, not a simulated guaranteed coverage percentage. The strength slider is visual blending, not developer strength, processing time or a chemical recipe. Zero strength preserves original pixels.

Preset and custom colours share the same sRGB-derived screen parameters. Rendering uses continuous luminance and gradual warm-pigment blending so adjacent picker values do not switch between unrelated depth rules. These improvements make the visual model internally consistent; they are not measured chemical response curves.

## Collect physical measurements

1. Start with the salon's actual product line and a small representative selection of shades. Preserve the original brand/line/code/chart edition/market and its level scale. Never infer commercial shade codes from photographed RGB.
2. Prepare and label real tresses spanning the intended substrate/history, depth, undertone, grey percentage and porosity. Include relevant previously coloured bases; do not treat white reference hair as equivalent to bleached pale-yellow hair.
3. Have the stylist record the products and actual procedure used. For a pre-lighten-then-colour record, `beforeLab` describes the prepared substrate immediately **before colour application**; record the original substrate and pre-lightening steps in `historyNotes` and `productNotes`. A separate experiment is needed to predict whether an original head of hair can reach that prepared base.
4. Measure dry hair before/after, with fixed arrangement, backing, geometry and instrument settings. Retain the illuminant, observer and whether specular reflection is included. Take at least three repositioned measurements and retain raw readings in the source record; the project minimum of three is a collection rule, not a statistical accuracy guarantee. Store the averages in this format.
5. Photograph alongside a reference colour target under a fixed neutral light and fixed camera settings. Preserve the image profile; do not apply filters or automatic beautification. A grey card aids white balance/exposure; it is not a replacement for a full colour profile or a spectrophotometer.
6. Keep separate calibration and validation tresses/people. Do not evaluate only on records used to tune the model. Record daylight and salon-light appearance separately when relevant. Preserve consent for any identifiable customer images.

## File format

Save a JSON array of records conforming to `src/components/try-color/tressCalibration.ts`. Required fields:

| Field | Content |
|---|---|
| `schemaVersion`, `id` | `1`, unique measurement ID |
| `shade` | `brand`, `line`, `code`, `chartVersion`, `market` — exact product identity |
| `levelScale` | `id`, `label`, numeric `min`, `max` — original manufacturer reference |
| `base` | `history`, `level`, `undertone`, `greyPercent`, `porosity`, `historyNotes` |
| `process` | `method`, `productNotes`, `developerNotes`, `processingMinutes` — actual recorded service |
| `measurement` | `illuminant` (`D50`/`D65`), `observer` (`2-degree`/`10-degree`), `geometry`, `specular` (`included`/`excluded`), `instrument`, `replicateCount` |
| `beforeLab`, `afterLab` | `{ "l": number, "a": number, "b": number }` under the SAME measurement conditions |
| `evidence` | `measuredAt` (YYYY-MM-DD), `operator` (staff/reference ID), `sourceRecord` (raw readings/procedure reference) |

Enumerations: history `natural`/`coloured`/`lightened`/`unknown`; undertone `neutral`/`red`/`orange`/`yellow`/`pale-yellow`; porosity `low`/`normal`/`high`/`unknown`; method `deposit`/`permanent`/`prelighten`. For deposit products without developer, record “not used” in developerNotes. Do not fill absent facts with invented measurements. The synthetic unit-test fixture demonstrates structure only and must not become production shade data.

Validate a file locally:

```bash
pnpm exec tsx scripts/validate-hair-calibration.ts /absolute/path/measurements.json
```

Validation rejects missing metadata, invalid ranges/non-finite Lab, out-of-scale bases and duplicate IDs. It checks structure, not the truth of measurements. It neither uploads records nor automatically publishes them in the try-on. Once real data exists, review substrate/process compatibility before adding a measured lookup; do not interpolate across unrelated histories or brands just because a starting Lab happens to be close.

## Acceptance protocol

- Evaluate mask leakage/edges separately from colour error.
- Compare estimated starting depth/tone against independent stylist assessments under the reference conditions.
- Compare predicted and observed **after-colour** measurements using `deltaE2000` only under matching white/observer/geometry. Before-to-after distance measures a colour change, not prediction error.
- Report median and upper-tail errors, sample counts, spread across repeat measurements, lighting/device groups and failure cases. Set acceptance limits from this salon pilot; do not present an arbitrary Delta E threshold as universal hair-dye accuracy.
- Have stylists assess multi-tone hair, highlights, texture and grey coverage. One mean Lab and one colour-distance score do not describe an entire hairstyle.
- Publish only the tested scope. There is currently no basis for a numerical salon-result accuracy claim.
