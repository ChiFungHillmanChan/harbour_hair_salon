# Evidence-aware hair colour preview

User approved the preceding research/design and requested implementation directly on `main` on 2026-09-29. Scope is the existing browser-only photo/video try-on. Preserve unrelated working changes and never invent salon measurements. The user subsequently authorized commit, push and production deployment through the existing GitHub CI/CD after mobile/iPad verification and build checks.

## Behaviour

- Separate deposit-only, permanent-colour lift, and pre-lightening then colour. Default to deposit and unknown history; previously coloured/unknown hair must not receive an unsupported natural-hair lift promise.
- Ask natural/coloured/lightened/unknown history and none/some/mostly/unknown grey coverage. Pre-lightening uses either the current photographed base or an explicitly hypothetical orange/yellow/pale-yellow base.
- Use robust hair-interior colour sampling, reject empty/unusable samples, surface exposure and uneven-colour limitations, show approximate upper/middle/lower hair-region estimates (not anatomically detected roots). A photo cannot reveal dye chemistry or recover natural colour under old dye.
- Keep generic 1–10 preview levels explicitly distinct from PRIMIENCE 4–15 reference swatches. Current shades remain illustrative, never relabelled as measured manufacturer colours.
- Record shade identity/provenance and colour-space metadata, with a tested format for future measured tress records. Measured CIELAB needs illuminant/observer/measurement context and starting-base/treatment conditions. Do not ship fabricated records or claim that colour-space conversion is calibration.
- Existing photo and video paths share the same request and context reporting. Initial photo paints after canvas mount; changing/removing media clears stale analysis. Zero preview strength returns the original image exactly.
- Keep original texture/lighting, make residual warm-base differences visible, cap deposit lightening, warn on unattainable targets across all shades. Confidence is a quality indication, never a probability of salon success.
- All new customer copy in English and Traditional Chinese. Practical capture guidance and honest preview limitations. Keep the existing visual language and accessibility.

## Shared contract

In `constants.ts`: `HairConsultation` has `treatment: 'deposit' | 'permanent' | 'prelighten'`, `history: 'natural' | 'coloured' | 'lightened' | 'unknown'`, `lightenedBase: 'current' | 'orange' | 'yellow' | 'pale-yellow'`, `greyCoverage: 'none' | 'some' | 'mostly' | 'unknown'`. `DEFAULT_CONSULTATION` is deposit/unknown/current/unknown. Add optional `consultation` to `RecolorRequest`; legacy bleachState is supported conservatively.

Extend `HairAnalysis` with optional `quality: 'usable' | 'limited' | 'unusable'`, `issues: AnalysisIssue[]`, `levelRange: [HairLevel, HairLevel]`, `lab: LabColor`, `regions: {position:'upper'|'middle'|'lower'; level:HairLevel; lab:LabColor}[]`. `LabColor` is `{l:number;a:number;b:number}` with explicit D65/2-degree provenance in colour metadata. Quality issue values: `no-hair`, `too-dark`, `overexposed`, `uneven-colour`. Legacy numeric fields stay compatible with worker/fixtures; unusable estimates must not be displayed as a valid level or recoloured.

Extend `ResolvedRecolorContext` with `notices: RecolorNotice[]`, using `uncalibrated`, `deposit-limit`, `history-unknown`, `previous-colour`, `lightened-base-assumed`, `warm-base`, `grey-coverage`, `photo-unreliable`, `needs-lightening`. Retain the existing context fields for compatibility. UI translates notice codes; it must not render raw English engine messages.

`ColorPalette` replaces `bleachState/onBleachStateChange` with `consultation/onConsultationChange`, adds `analysis: HairAnalysis | null` and `notices: RecolorNotice[]`, retaining existing shade/strength/level props. `VideoTryOn` adds `onContextChange(context: ResolvedRecolorContext | null)`; parent memoizes request and callback to avoid render loops.

## Research and limits

- Shiseido: https://www.shiseido-professional.com/com/en/products/hair-color/primience.html — shade lines depend on substrate/grey proportion; swatches are conditional.
- Wella: https://www.wella.com/professional/m/_master/products/koleston_perfect/pdfs/koleston-perfect_usagebooklet.pdf — depth, tone, exposed underlying pigment and product-specific lifting.
- Kim & Suk (2022): https://library.imaging.org/admin/apis/public/api/ist/website/downloadArticle/ei/34/15/COLOR-374 — measured hair-tress Lab lookup tables; limited products/substrates, no universal accuracy claim.
- W3C: https://www.w3.org/TR/css-color-4/ — colour-space conversion, reference whites and colour differences.

Physical tress dyeing, spectral measurement and independent salon validation require real samples and are not obtainable by code changes. Deliver the collection format/protocol and honest fallback now; do not advertise a numeric accuracy percentage.
