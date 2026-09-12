# Wander promotional video

`public/promo/wander-promo.mp4` is an 18-second vertical product promo, 720 × 1280,
24 fps, H.264 with AAC audio, approximately 3.7 MB. It is a standalone downloadable
asset, without autoplay or extra homepage loading.

The captions, cream background, terracotta invitation and travel drawing match
Wander. Three actual browser captures show the public trip prompt and the real
MapView component with fictional Tokyo stops. No private trips, booking details,
AI requests or account data were used. Map attribution remains in the captures.
This is an edited screenshot sequence, not a recording of an AI response.

## Timing

- 0–4.5s: Start with an idea.
- 4.5–9s: See your days on the map.
- 9–13.5s: Find your next stop.
- 13.5–18s: Wander invitation and site address.

The quiet music bed is synthesised from four original chords; no stock recording
or voice model is used. The video can also be understood muted.

## Editable sources

`tools/promo/edit.jsx` contains native Higgsedit text, media and fade tracks.
The three neighbouring screenshots and `soundtrack.py` preserve the inputs.
The exported source archive is also saved locally at
`output/promo/wander-promo-source.zip` and contains the Higgsedit project and fonts.

To rebuild in Higgsfield's sandbox, create `/home/user/wander-promo/assets`, copy
the screenshots there, copy `public/artwork/journey.webp` there, and copy the two
scripts to `/home/user/wander-promo`. Initialise `project` at 720x1280 and 24fps
using `higgsedit new`, then vendor the fonts with
`higgsedit fonts add project "Playfair Display:400" "DM Sans:400"`.
Run `higgsedit build edit.jsx` and `python3 soundtrack.py`. Mux
`project/renders/silent.mp4` with `bed.wav` using H.264 stream copy, AAC 128k and
`-movflags +faststart -shortest`.

Validation: all four scene holds inspected as rendered frames; ffprobe confirmed
18 seconds, 720x1280, H.264 video and AAC audio. Browser captures were taken at
phone width. The temporary capture route was removed before shipping.
