# Photorealistic map appearance

Map page → Map appearance → Map type → **3D**. The default remains Road;
the choice is saved on this device. Satellite imagery and 3D retain natural
colours instead of applying the app's light/dark theme.

`GoogleMap` lazy-loads `PhotorealisticMap` and Google's `maps3d` library only
when selected. Preferences hydrate before either renderer mounts, avoiding an
unnecessary 2D map load for a saved 3D preference. Day filters, stop numbering,
colours, nearby suggestions, place cards, photos and activity editing use the
existing page callbacks. Lines connect stops within the same day; they are not
navigation routes. Shared-location pins fan out without moving their coordinates.

Use Map appearance to switch back to a flat map, and map gestures to rotate or
zoom. There is no extra 3D toolbar. Both renderers share the same photo-first
place card, photo viewer and action styling. Switching renderers preserves the
map centre and approximates the ground scale. Selecting another
day fits that day's stops. Maps in activity editors and Traveller navigation
retain their existing flat-map gestures and routes; they do not inherit 3D.

An initialization error, failed library import or 45-second initial loading
timeout returns to Road with a dismissible explanation. The 2D button also
works while 3D loads. Changing days or selections does not recreate the 3D map;
leaving 3D removes its element and listeners. Nearby selections and day framing
use a 0.9–1.4 second camera transition. Jumps over 20 km, large zoom changes and
reduced-motion preferences use an instant move. A newer selection cancels the
previous flight. Cards open after arrival with Google's automatic popover panning
disabled, so two competing camera moves cannot dismiss them. There is no automatic
fly-through.

## Google Cloud and availability

Uses the existing browser `NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY` with the weekly
Maps JavaScript API. No Higgsfield integration, tile proxy, separate Map Tiles
API, map ID or database migration is needed for this renderer.

Maps JavaScript API and billing must be enabled, with key/referrer restrictions
allowing the deployment. Google bills 3D loads under **Immersive Maps**, separately
from ordinary Dynamic Maps. Check actual usage, quotas and billing in the project's
Google Cloud console; the app does not change those settings.

- [Google's 3D overview and coverage](https://developers.google.com/maps/documentation/javascript/3d/overview)
- [API usage and billing](https://developers.google.com/maps/documentation/javascript/usage-and-billing)
- [Browser support and hardware acceleration](https://developers.google.com/maps/documentation/javascript/3d/support)

Photorealistic detail is not available everywhere. Google's renderer supplies
satellite/terrain imagery where detailed 3D coverage is absent. Keep Google's
attribution visible; do not cache imagery for offline trips.

## Validation

Regression tests cover saved appearance preferences, switching camera scale,
date-line crossings, invalid/empty coordinates, narrow framing and search bounds.
Local browser checks use fictional Tokyo stops with the real Google renderer:
3D scenery, keyboard selection and activity callbacks, day filters, phone-sized
cards and appearance switching, and a simulated `gmp-error` returning to Road. Physical
Android/iOS GPU performance and production billing settings require device/account
verification. The temporary preview route is removed before shipping.
