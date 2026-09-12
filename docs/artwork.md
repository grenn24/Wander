# Wander illustrations

## Homepage atlas background

`hero-atlas.webp` is a 1920 × 1086, 186,192-byte illustration generated with
Higgsfield MCP / GPT Image 2 on 12 September 2026, job
`e9ebc4c0-4205-469e-a397-ebede768b5e3`. The source PNG was resized and compressed
with Sharp (WebP quality 80). No runtime generation or subscription is needed.

`HeroAtlas.jsx` places it only behind the homepage hero, with separately drawn
CSS/SVG routes and a slow light wash. Both animations pause off-screen, in hidden
tabs and through the pause button; reduced-motion visitors get a still drawing.
Dark mode uses inversion/blending; mobile uses a quieter crop from the right.
Keep it decorative, non-interactive and hidden from assistive technology/print.

Final generation prompt:

> A refined editorial atlas illustration to become a subtle background for Wander, a warm travel planner website. Flat overhead map printed on pale cream paper #f4efe5. Delicate hand-drawn olive #909978 contour lines, light sage patches of forest, a few tiny muted terracotta architectural marks, fine warm grey streets and a meandering pale sand river. Fictional geographical landscape, not a real city, no labels or text. Build attractive cartographic detail mostly along the far left and right edges, upper-right and bottom corners. The middle 60 percent must remain very sparse, light cream negative space, so website headings and input fields will remain readable over it. Sophisticated travel-journal engraving with fine organic ink lines and very restrained translucent watercolor washes, harmonious with cream, terracotta #c9775e, olive, warm brown. Entire image is one continuous flat map surface, NOT a framed sheet or an object sitting on a desk. No folds, shadows, people, hands, luggage, coffee, compass roses, legends, numbers, words, border or watermark. NO route lines or location markers: those will be animated separately in code. Quiet, airy and elegant. Wide landscape 16:9. Keep linework legible for use at subtle opacity.

## Saved places addition

`places.webp` uses the journey drawing as its style reference (Higgsfield job
`8e523245-3b4b-4fd7-bb4a-d27dd832c875`). Displayed at 140px in the empty map stop
list, including a day with no located stops; never in search errors or results.

Prompt: Use case: illustration-story. A restrained editorial spot illustration for Wander travel planner. Match the supplied reference's delicate warm brown ink outlines, muted olive #909978 and terracotta #c9775e flat washes and pale sand #eee6d8. Landscape 3:2 canvas, pure solid white #ffffff background right to every edge, at least 18 percent blank margin around the subject. Subject: one small folded paper map with a SINGLE terracotta location pin standing on it and a small olive leaf beside it. Quiet three-quarter overhead view, compact simple silhouette legible at 130px wide, subtle hand-drawn irregularity. This is an EMPTY SAVED PLACES illustration; reassuring, no marked real destinations. No typography, letters, numbers, text, logo, watermark, border, gradients on the background, confetti, 3D or photorealism. No suitcase or coffee cup in this new drawing.

Generated with Higgsfield MCP, GPT Image 2, on 12 September 2026.
Four generations at an estimated one credit each; no runtime Higgsfield integration.

The four empty-state WebP files in `public/artwork/` total about 70 KB. Each is
640 × 430, with explicit rendered dimensions and lazy loading. Originals were
1024 × 688 PNGs; only resizing and WebP compression were applied.

Use `TravelArt` only for the homepage's final invitation and the empty trip,
packing and map stop-list states. Do not add it to populated lists, the map canvas, error messages or loading
states. The surrounding copy and controls remain the source of information.
CSS blends white into the light surface, and inverts/blends it into dark surfaces.
The glass map panel instead uses the small `paper-alpha.svg` presentation filter
to remove near-white paper before compositing. It keeps the drawing's original
colours and prevents a rectangular image background inside the isolated backdrop.
Keep the images outside transformed/opaque decorative wrappers so the blend can
sample the page. They are hidden from assistive technology and print layouts.

## Generation prompts

### journey.webp

Use case: illustration-story. Create a restrained editorial spot illustration for Wander, a calm travel planner with serif headings, cream paper surfaces and muted earthy accents. Landscape 3:2 canvas. Pure solid white background #ffffff all the way to every edge, no paper texture or gradient on the background. A single small cohesive composition centred with at least 18 percent white margin on every side. Delicate warm grey-brown ink outlines, flat muted olive #909978 and terracotta #c9775e washes, pale sand #eee6d8, very subtle hand-drawn irregularity. Sophisticated travel-journal print illustration, airy, modest and functional, legible displayed at 180px wide. No typography, letters, numbers, logos, watermarks, frame, decorative border, dramatic shadows, photorealism, 3D, sparkles or floating confetti. All marks belong to the objects; nothing around the outer white margin. A folded paper street map with a simple olive route, a small blank terracotta train ticket partly tucked underneath, and one tiny ceramic coffee cup. Quiet overhead view; the map is the focus. This will sit above a 'Where are you going?' prompt, gently suggesting the beginning of a trip.

### trips.webp

Use case: illustration-story. Create a restrained editorial spot illustration for Wander, a calm travel planner with serif headings, cream paper surfaces and muted earthy accents. Landscape 3:2 canvas. Pure solid white background #ffffff all the way to every edge, no paper texture or gradient on the background. A single small cohesive composition centred with at least 18 percent white margin on every side. Delicate warm grey-brown ink outlines, flat muted olive #909978 and terracotta #c9775e washes, pale sand #eee6d8, very subtle hand-drawn irregularity. Sophisticated travel-journal print illustration, airy, modest and functional, legible displayed at 180px wide. No typography, letters, numbers, logos, watermarks, frame, decorative border, dramatic shadows, photorealism, 3D, sparkles or floating confetti. All marks belong to the objects; nothing around the outer white margin. A small closed olive carry-on suitcase with a blank terracotta luggage tag, beside one folded pale sand map. Slight three-quarter view, compact balanced silhouette. This will appear only when someone's trip library is empty.

### packing.webp

Use case: illustration-story. Create a restrained editorial spot illustration for Wander, a calm travel planner with serif headings, cream paper surfaces and muted earthy accents. Landscape 3:2 canvas. Pure solid white background #ffffff all the way to every edge, no paper texture or gradient on the background. A single small cohesive composition centred with at least 18 percent white margin on every side. Delicate warm grey-brown ink outlines, flat muted olive #909978 and terracotta #c9775e washes, pale sand #eee6d8, very subtle hand-drawn irregularity. Sophisticated travel-journal print illustration, airy, modest and functional, legible displayed at 180px wide. No typography, letters, numbers, logos, watermarks, frame, decorative border, dramatic shadows, photorealism, 3D, sparkles or floating confetti. All marks belong to the objects; nothing around the outer white margin. A softly structured open olive travel bag with one folded pale sand shirt and a slim terracotta passport-shaped booklet peeking out. Simple three-quarter view, no clutter. This will appear only when a packing list is empty.
