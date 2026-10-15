# iPhone home-screen web app audit

Scope: `index.html`, `src/main.tsx`, `src/styles.css`, `src/App.tsx`, `src/viewport.ts`, `src/layout.ts`, `src/api.ts`, `src/imageprep.ts`, `src/components/*`, `wrangler.jsonc`, `worker/index.ts`.
Audit date: 2026-10 (iOS 26 current; iOS 18.x still common). The audit itself was read-only; the Status column records the follow-up changes (P1 and P2 items, plus two P3 one-liners).

Evidence level: Apple/WebKit blog, MDN and Cloudflare docs were fetched. Firtman's iOS PWA notes (firt.dev) are a secondary source and are marked "secondary". Anything marked **device test** I could not verify from documentation and needs a real iPhone.

## Summary

| # | Item | Verdict | Pri | Status |
|---|------|---------|-----|--------|
| 1 | No web app manifest, no `apple-touch-icon`, no `apple-mobile-web-app-title` | gap | P1 | done (`public/`, `scripts/icons.mjs`); device test: icon and "Archive" label after Add to Home Screen |
| 2 | Access in front of manifest/icons (manifest is fetched without cookies by default) | risk | P1 | done in code (`crossorigin="use-credentials"`); Access bypass for the icon paths left to the owner, only if the installed icon shows a monogram |
| 3 | Expired Access session: XHR gets a cross-origin 302, app shows "Can't reach the archive" | risk | P1 | done (`src/session.ts`, `api.ts`, `SignedOut.tsx`, resume probe); device test: let a session expire on the phone |
| 4 | Cold start with expired session in standalone: where does the login page render | risk, device test | P1 | device test needed (no code change) |
| 5 | Keyboard handling on a fixed, clipped shell with sheets that hold inputs | risk, device test | P2 | done (`useKeyboardInset`, `--kb`); device test: edit sheet lower fields, label form, search, both orientations |
| 6 | Render-blocking Google Fonts stylesheet on cold start | gap | P2 | done (self-hosted latin woff2, Geist preloaded) |
| 7 | File input `accept` includes `.heic` and `.heif`; Safari conversion rules | risk, device test | P2 | done (extensions dropped on iOS only; `console.debug` of picked files); device test: the matrix in item 7 |
| 8 | Image loading attributes (`decoding`, intrinsic size) and large-bitmap memory | polish | P2 | done (`decoding="async"` on thumbs; downscaled decode in `imageprep.ts`); device test: a 48 MP / ProRAW upload |
| 9 | Reduced-motion rule turns infinite animations into a flicker/frozen spinner | gap (small) | P2 | done |
| 10 | `--faint` text contrast ~4.4:1 and 9.5-11px text sizes | polish | P2 | done (`--faint` #8F887D: 5.46:1 on --bg, 5.05:1 on --surface; labels 11px except the compact "Preview being made" tile) |
| 11 | Standalone height strategy (`100vh` + fixed) | OK, fragile | P3 | not changed (see note in item 11) |
| 12 | Service worker / offline / push / badging | not warranted | P3 | not changed |
| 13 | Tap highlight, `touch-action: manipulation`, long-press callout | polish | P3 | done (tap highlight on `html`, `touch-action: manipulation` on buttons/links); callout left as is |
| 14 | `navigator.vibrate` is a no-op on iOS | note | P3 | not changed |

Items that are already fine are listed in the last section so they are not re-litigated.

---

## 1. Manifest, icons, title, status bar, splash  (P1 gap)

**Best practice**
- A Home Screen web app on iOS/iPadOS 16.4+ is driven by a manifest with `display: standalone` (or `fullscreen`); without it, the site was historically saved as a bookmark. Manifest `icons` are honoured since 15.4, `id` since 16.4. If both exist, `apple-touch-icon` wins over manifest icons. With no icon at all, iOS 16.4+ makes a monogram from the first letter. https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- iOS 26 (Safari 26): every site added to the Home Screen opens as a web app by default, manifest or not (user can switch "Open as Web App" off). Safari 26 also accepts SVG and data-URL images for icons. https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- Secondary (https://firt.dev/notes/pwa-ios/): `apple-mobile-web-app-capable` is optional since iOS 11.3 and unnecessary for opening as an app on iOS 26, but `apple-touch-startup-image` splash screens still only work with it present, and `black-translucent` is still the only way to get content under the status bar. `apple-mobile-web-app-status-bar-style` is "no longer recommended" since iOS 15 in favour of `theme-color`, but see the previous point: you chose black-translucent deliberately. Manifest `icons` support PNG and (26+) SVG; **maskable and monochrome purposes are ignored on iOS**, so supply a full-bleed, square, opaque icon. Manifest `orientation` is ignored (no orientation lock on iOS); `minimal-ui` and `fullscreen` fall back to `standalone`.
- Home Screen icon: provide a 180x180 opaque PNG (`<link rel="apple-touch-icon" href="/apple-touch-icon.png">`). iOS rounds the corners itself; transparency renders black.
- Label: iOS uses `apple-mobile-web-app-title`, then the manifest `short_name`/`name`, then `<title>`. The label truncates at roughly 10-12 characters.

**Repo now**
- `index.html:4-7` has viewport, `theme-color #100F0E`, `apple-mobile-web-app-capable=yes`, status bar `black-translucent`. Good.
- `index.html:8` `<title>Anne Laddon · Archive</title>` is the only name source, so the Home Screen label will be a truncated "Anne Laddon ·...". No `apple-mobile-web-app-title`.
- `index.html:13` is a data-URI SVG favicon only. No `apple-touch-icon`, no manifest link. `ls` shows no `public/` directory; `dist/` contains only `index.html` and `assets/`.
- Unknown paths fall through to the SPA (`wrangler.jsonc` `not_found_handling: single-page-application`), so a request for `/apple-touch-icon.png` today returns HTML.

**Verdict:** gap, P1. The icon will be a generated monogram or a screenshot-like fallback on older iOS, and the label is awkward.

**Recommended change**
1. Add `public/` (Vite copies it to `dist/`) with `apple-touch-icon.png` (180x180, opaque `#100F0E` background with the existing mark), `icon-192.png`, `icon-512.png`, and `manifest.webmanifest`:
   ```json
   {
     "id": "/",
     "name": "Anne Laddon Archive",
     "short_name": "Archive",
     "start_url": "/",
     "scope": "/",
     "display": "standalone",
     "background_color": "#100F0E",
     "theme_color": "#100F0E",
     "icons": [
       { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
       { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
       { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
     ]
   }
   ```
   (The maskable entry is for Android/Chrome; iOS ignores it. Do not set `orientation`: iOS ignores it and you want both orientations.)
2. In `index.html`: `<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">`, `<link rel="apple-touch-icon" href="/apple-touch-icon.png">`, `<meta name="apple-mobile-web-app-title" content="Archive">`. Add `<meta name="mobile-web-app-capable" content="yes">` alongside the Apple tag so Chrome does not log a deprecation warning. Keep `apple-mobile-web-app-capable` and `black-translucent`.
3. Splash: iOS shows `background_color`/theme color, then the page. Because the page background is `#100F0E` from first paint (`styles.css:42`), a splash image set is not worth the 20+ device-size `apple-touch-startup-image` links. Skip.
4. Scope/start_url: `/` is correct. The `#/piece/<id>` deep links (`App.tsx:73`) are hash-only, so they stay in scope.

---

## 2. Cloudflare Access in front of the manifest and icons  (P1 risk)

**Best practice**
- Per the HTML spec / MDN, `<link rel="manifest">` is fetched **without credentials** unless `crossorigin="use-credentials"` is set. Behind Access, an uncredentialed request is redirected to the login domain, so the manifest silently fails. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/crossorigin and https://developer.mozilla.org/en-US/docs/Web/Manifest
- Cloudflare Access docs describe bypass policies for specific paths (e.g. a Bypass/Service-auth policy on `/manifest.webmanifest`, `/icon-*.png`, `/apple-touch-icon.png`); I did not re-fetch that page, so treat the exact policy UI as to-verify.

**Repo now:** no manifest exists, so there is nothing to break yet. `wrangler.jsonc` shows Access protects the whole Worker, including static assets.

**Verdict:** risk when item 1 is implemented.

**Recommended change:** use `crossorigin="use-credentials"` on the manifest link (done in item 1) and make sure the response has no wildcard CORS requirement (same origin, so fine). The apple-touch-icon is fetched by Safari at "Add to Home Screen" time in the user's signed-in context; if the icon ever shows as a monogram after install, add an Access bypass policy for the three icon/manifest paths. They contain nothing private.

---

## 3. Expired Access session during use  (P1 risk)

**Best practice**
- Cloudflare: when an application token expires, Access re-issues from the global token if still valid, otherwise requires the IdP again; sessions are fixed-length, not documented as sliding. Global session ceiling is one month; you have 30 days. For AJAX/SPAs, Access can return **401 instead of a 302** if the request carries `X-Requested-With: XMLHttpRequest`, which is the recommended way to detect expiry and force a page refresh. https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/
- A `fetch()` that is redirected to another origin without CORS headers rejects with a `TypeError`, indistinguishable from offline.

**Repo now**
- `src/api.ts:8-14`: `fetch()` without the header. A cross-origin 302 to `irving-family.cloudflareaccess.com` makes `fetch` throw, which is mapped to `ApiError(0, "Can't reach the archive...")`.
- `src/App.tsx:67` has a nice "You're signed out. Reload to sign in again." message, but it triggers only on `status === 401`, which Access never returns for this request as sent.
- `src/api.ts:60-71` upload uses `XMLHttpRequest`; same issue, shows "Upload interrupted".
- Nothing refreshes state when the app returns to the foreground (no `visibilitychange`/`pageshow` handler), so an app left in the app switcher for days wakes up stale, then fails on its first request.

**Verdict:** risk, P1. After 30 days (or earlier if you shorten it) the user sees a misleading "can't reach" error instead of a sign-in.

**Recommended change**
- Add `"X-Requested-With": "XMLHttpRequest"` to every `fetch` in `req()` and `xhr.setRequestHeader(...)` in `uploadImage`. On 401, show the existing signed-out message with a **Sign in** button doing `location.reload()` (a top-level navigation lets Access do its redirect). Extend `ApiError` so that status 401 or 403 is treated as "session expired" in the upload path too.
- Add a `pageshow`/`visibilitychange` listener that, after the page was hidden for more than ~5 minutes, refreshes the list (and does the cheap `api.me()` probe so expiry is noticed on resume, not on first tap).
- Keep this logic in the imperative shell (`api.ts`/`App.tsx`); classification of a response into `signed-out | offline | error` is a pure function worth unit-testing.

---

## 4. Auth redirects and scope in standalone  (P1 device test)

**Best practice / facts**
- Standalone navigation to an out-of-scope origin opens an in-app browser sheet (since iOS 12.2, secondary: https://firt.dev/notes/pwa-ios/). Older reports (iOS 11.3-12.1) said it left for Safari. Forum reports of OAuth round-trips failing in standalone are widespread but old (e.g. https://developer.apple.com/forums/thread/649699); I found no current Apple statement.
- Secondary: "Login cookies are copied to the installed app since iOS 17.2", i.e. signing in in Safari before adding to the Home Screen carries the session into the app. Storage is otherwise separate from Safari.
- Home Screen web apps keep their own storage and "their own counter of days of use"; WebKit says it does not expect first-party data of a Home Screen web app to be deleted by the 7-day script-writable-storage cap. The cap covers IndexedDB, localStorage, SessionStorage, service worker registrations and caches, and is measured in days of Safari use for a *browser tab*. Cookies set by the server (`Set-Cookie`, which is how `CF_Authorization` is set) are not in that list. https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- ITP third-party cookie blocking does not apply: the app and its API share one origin; the Access login is a top-level navigation to the team domain, then a redirect back to `<app>/cdn-cgi/access/authorized`, which is same-origin.

**Repo now:** the app itself makes no cross-origin top-level navigations. The only auth boundary is Access's own redirect when no valid `CF_Authorization` cookie exists, at cold start or on reload (item 3). Download links `PieceView.tsx:544,557` are same-origin `?download=1` with `Content-Disposition: attachment`, in-scope.

**Verdict:** the design is as good as it can be (single origin; no JS-driven OAuth). What I cannot confirm from documentation is whether, in an installed app on iOS 26, an Access redirect chain lands inside the app window or in the in-app browser sheet, and whether the final return to `/` closes the sheet and lands back in the app with the cookie visible to the app's own context. **Device test.**

**Recommended change / test plan**
1. In an installed copy, delete the `CF_Authorization` cookie (Settings > Apps > Safari > Advanced > Website Data, or wait out the session), cold-launch, complete login, and verify the app is showing the archive in the standalone window (no leftover sheet, no logged-out state).
2. Test once with first sign-in done in Safari then Add to Home Screen (cookie copy on 17.2+), and once signing in inside the installed app.
3. Raise Access session duration to the one-month maximum (already 30 days per the task) and consider enabling a one-time "keep me signed in" at the IdP, so re-login is rare.
4. Optional hardening: have the signed-out screen offer "Open in Safari" (`<a href="/" target="_blank">`) as an escape hatch if the in-app login sheet misbehaves.

---

## 5. Keyboard, `visualViewport`, scroll  (P2 risk, device test)

**Best practice**
- On iOS Safari the on-screen keyboard overlays the page: the layout viewport does not shrink, `100vh`/`dvh` do not change, and Safari scrolls the focused field into view by scrolling the layout viewport. The viewport meta key `interactive-widget` (`resizes-content` etc.) is documented on MDN, but I could not confirm support in Safari from the page; treat it as having no effect on iOS and use `window.visualViewport` (`height`, `offsetTop`, `resize`/`scroll` events) to position keyboard-aware UI. https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport
- Inputs with computed font-size below 16px make Safari zoom on focus. The workaround of `maximum-scale=1` / `user-scalable=no` hurts low-vision users; MDN and WCAG advise against it (iOS 10+ ignores it anyway).

**Repo now**
- Viewport meta `index.html:5` is `width=device-width, initial-scale=1, viewport-fit=cover`: correct, no zoom lock.
- All inputs are 16px: `.field` `styles.css:99`, search `TopBar.tsx:88` (`fontSize: 16`), label and add-value inputs use `.field` (`PieceView.tsx:578,676,688,692`). OK; no auto-zoom.
- No `visualViewport` use anywhere (grep). Sheets are `position: absolute; bottom: 0` inside a `position: fixed; overflow: clip` shell (`styles.css:63-66,119-124`). With the keyboard open, the edit form (`PieceView.tsx:387-392`), the image label form (`:577-578`) and the search box in the top bar will rely on Safari's scroll-into-view. In a clipped fixed shell that can shift the whole shell upward and leave a gap, or hide the field behind the keyboard. The comment at `styles.css:67` shows you already saw the clipped-box scroll problem once.

**Verdict:** risk, not proven. **Device test:** open the edit sheet, tap Description/Notes (lower fields) in portrait and landscape; open label form from the image menu; use search in landscape.

**Recommended change**
- Small hook `useKeyboardInset()` in `viewport.ts`: on `visualViewport` `resize`/`scroll`, compute `inset = max(0, innerHeight - vv.height - vv.offsetTop)`, write it to a CSS variable `--kb` on `.app`, and give sheets `padding-bottom: calc(env(safe-area-inset-bottom) ...)`/`max-height: calc(100% - var(--kb))`. Also `window.scrollTo(0,0)` on `focusout` so the layout viewport returns after dismissal. Keep the math pure (`insetFrom(innerHeight, vv)`), the listener in the shell.
- In landscape the keyboard covers most of the screen; for the edit sheet consider scrolling the focused field to the top of the sheet's own scroller (`scrollIntoView({block:"center"})` after `--kb` updates) instead of relying on Safari.

---

## 6. Fonts  (P2 gap)

**Best practice:** self-host critical fonts as woff2, same origin, `font-display: swap`, and preload the one or two used above the fold; a cross-origin render-blocking `<link rel=stylesheet>` adds DNS + TLS + CSS round trip before first paint. Google Fonts' CSS is render-blocking. https://web.dev/articles/font-best-practices

**Repo now:** `index.html:9-11` preconnects and loads a Google Fonts stylesheet with three families (Bricolage Grotesque variable 12..96/400..800, Geist, Geist Mono) and `display=swap`. Fallbacks are `ui-sans-serif, system-ui` (`styles.css:26-28`). Cold start of a Home Screen app on a weak connection waits for that stylesheet. Offline, it never paints with the designed font.

**Verdict:** gap, P2.

**Recommended change:** add `@fontsource-variable/bricolage-grotesque`, `@fontsource-variable/geist`, `@fontsource-variable/geist-mono` (latin subset only) so Vite emits hashed same-origin woff2 files; preload the body face; drop the Google preconnects and stylesheet. Same-origin files are cached for a year by Workers assets and need no extra Access consideration.

---

## 7. File inputs, camera, HEIC, multi-select  (P2 risk, device test)

**Best practice**
- `capture="environment"` on `<input type=file accept=image/*>` opens the camera directly on iOS Safari; `multiple` works with the Photos picker.
- HEIC conversion in Safari is driven by `accept`: Safari transcodes picked Photos images to the first concrete type listed in `accept`, and **adding `image/heic` (or a HEIC extension) can cause Safari 17+ to hand over *everything* as HEIC with renamed temp filenames**; reports from the Apple forums and a WebKit bug (Dec 2025, marked fixed, shipping version unconfirmed). https://developer.apple.com/forums/thread/743049 and https://bugs.webkit.org/show_bug.cgi?id=303803
- With plain `accept="image/*"` the picker behaviour on current iOS (whether you receive HEIC originals or converted JPEG) varies by source (Photos vs Files) and version. **Device test.**

**Repo now** (`UploadSheet.tsx:68-70`)
- Camera: `accept="image/*" capture="environment"`. OK.
- Photos: `accept="image/*" multiple`. OK.
- Files: `accept="image/*,.heic,.heif,.tif,.tiff" multiple`. The explicit `.heic`/`.heif` entries are the pattern that triggered the Safari 17+ conversion/rename reports; on the Files path this is probably harmless (originals come from the file system), but it is the one place to verify.
- Pipeline tolerates both outcomes: `imageprep.ts:21-25` falls back to "keep original, skip variants" when `createImageBitmap` cannot decode, and the Worker makes previews via Cloudflare Images (`worker/media.ts:57-58`, HEIC allowed). Uploads are sequential (`App.tsx:165-180`), which is right for memory.
- Safari can decode HEIC natively, so `createImageBitmap(file)` normally succeeds and the display/thumb JPEGs are generated on the phone.

**Verdict:** structurally good; confirm behaviour on a device.

**Recommended change**
1. Device test matrix: Photos picker with a HEIC photo (does `file.type` say `image/heic` or `image/jpeg`, what is `file.name`, size?), a screenshot (PNG), a Live Photo, Files app HEIC. Log `file.type/name/size` temporarily.
2. If the Files input shows renamed `.heic` for non-HEIC images, drop `.heic,.heif` from `accept` (Safari already lists them via `image/*`).
3. For large originals, the Files path should keep `image/*` plus `.tif,.tiff` only if TIFF is really wanted; Cloudflare Images does not decode TIFF (`media.ts:57` comment), so TIFFs get no server preview and, on iOS, `createImageBitmap` of a TIFF usually works, which is the only reason variants appear. Fine as is.

---

## 8. Image loading, formats, memory  (P2 polish)

**Best practice**
- Safari supports WebP (14+), AVIF (16+), HEIC natively in `<img>` is limited to Apple platforms; HDR image support arrives in Safari 26 with `dynamic-range-limit`. JPEG remains the safe delivery format and fits your "previews as JPEG" pipeline. https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/
- `loading="lazy"` plus `decoding="async"` and explicit `width`/`height` (or `aspect-ratio`) reduce main-thread decode jank and layout shift. `content-visibility: auto` with `contain-intrinsic-size` skips rendering for off-screen sections (Safari 18+; Safari 26 fixed several hit-testing/repaint bugs in it).
- iOS Safari limits canvas area (~16.7 megapixels historically) and kills tabs under memory pressure; decoding a 48 MP original into an `ImageBitmap` can use ~190 MB.

**Repo now**
- `loading="lazy"` on thumbs in Wall/Timeline/PieceView (`Wall.tsx:129`, `Timeline.tsx:185`, `PieceView.tsx:442,471`). Good. No `decoding="async"` anywhere. Hero images (`Timeline.tsx:149`, `PieceView.tsx:614`) have explicit pixel `width`/`height` styles in Timeline; others rely on a sized parent with `object-fit: cover`. Fine.
- `img { display:block }` and `.art-img` placeholder colour `#23201C` (`styles.css:133`) avoids flashes.
- Previews are served `private, max-age=31536000, immutable` (`worker/index.ts:141`); good for repeat opens. Originals are download-only (`index.ts:135`), so the phone never decodes a 48 MP file for display.
- `imageprep.ts:21` decodes the **full-size** bitmap before downscaling. For multi-hundred-megabyte ProRAW or 48 MP files this is the largest memory spike in the app, though it runs one file at a time.

**Verdict:** OK overall; two cheap improvements.

**Recommended change**
- Add `decoding="async"` to the `<img>` thumbs (React: `decoding="async"`).
- In `prepareImage`, request a downscaled decode where supported: `createImageBitmap(file, { resizeWidth, resizeHeight, resizeQuality: "high", imageOrientation: "from-image" })` sized from the first-pass dimensions, or fall back to the current path. That cuts peak memory for big sources; width/height for the record still need the original dimensions (read via a cheap `Image` header decode, or keep the full bitmap only when under ~24 MP).
- For a very long Wall, consider `content-visibility: auto; contain-intrinsic-size: auto 400px` on year sections. Only worth doing if scroll performance on an older iPhone is actually poor (measure in Safari Web Inspector before changing).

---

## 9. Reduced motion  (P2 small bug)

**Best practice:** honour `prefers-reduced-motion`; for infinite animations also set `animation-iteration-count: 1`, otherwise a 0.01ms duration with infinite repetition flickers. https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion

**Repo now** `styles.css:156-158`: `animation-duration: .01ms !important; transition-duration: .01ms !important`. `.skel` (shimmer, `:134`) and `.spinner` (`:154`) are `infinite`, so with Reduce Motion on, they cycle ~100,000x a second (visible as a static or flickering state, and the spinner no longer reads as busy).

**Verdict:** gap (small).

**Recommended change:** inside the media query add `animation-iteration-count: 1 !important;` and `scroll-behavior: auto !important;`, and give `.spinner` a non-motion cue (e.g. a pulsing opacity at low frequency or a static ring plus the text status the app already shows via toast). Also check `transform: translateX(-36px)` view transitions (`.viewL/.viewR`), `.popin` and `Timeline` playback animations; the global rule covers CSS but not JS-driven transforms (`PieceView.tsx:306` carousel `transition` is inline and `!important` in the stylesheet does override inline transitions, so it is covered).

---

## 10. Contrast and text size, Dynamic Type  (P2 polish)

**Best practice:** WCAG AA needs 4.5:1 for body-size text and 3:1 for large text/UI; Safari honours the iOS system text size only when text uses `font: -apple-system-body` (and the `-webkit-text-size-adjust` default); fixed px type never scales with Dynamic Type. https://webkit.org/blog/3709/using-the-system-font-in-web-content/ (secondary on Dynamic Type for web content, not re-fetched).

**Repo now**
- Palette (`styles.css:2-23`) on `#100F0E`: `--text`, `--text-2` and `--muted` (`#A39C91`, about 7:1) pass. `--faint` `#7F786E` is about 4.4:1 by my estimate, just under AA for normal text; it is used for counts, hints and captions (`styles.css:94`, `PieceView.tsx` several). `UploadSheet.tsx:57` uses `#8A847A` (slightly better).
- Several labels are 9.5-11px (`PieceView.tsx:445` 9.5px, `.lbl` 10.5px at `styles.css:82`); legible for mono caps but small. All sizes are px, so Dynamic Type has no effect. `-webkit-text-size-adjust:100%` (`:42`) is correct to stop landscape inflation.
- `user-select: none` on the whole shell (`styles.css:65`) removes text selection/Look Up from titles and notes; inputs re-enable it (`:99`). Acceptable for an art-wall UI, but it blocks copying a catalog number.
- Focus rings exist (`:51`). Buttons have `aria-label`s (e.g. `TopBar.tsx:84`). Touch targets are 44px (`.icon-btn`), chips 38px (below 44; borderline).

**Verdict:** polish. Dynamic Type for a custom, dense visual UI is a nice-to-have.

**Follow-up note:** the "New value" input for list fields (`PieceView.tsx` `FieldEditor`) was 14px, which makes Safari zoom on focus; it is now 16px.

**Recommended change:** lighten `--faint` to about `#8F887D` (passes 4.5:1 on `#100F0E`); bump the 9.5-10.5px labels to 11px; allow `user-select: text` on the info panel (catalog id, notes). If you want some Dynamic Type, convert body copy, not chrome, to `font: -apple-system-body` / rem-based sizes and test every layout at larger sizes first; do not do this casually.

---

## 11. Standalone height, safe areas, orientation  (OK, P3 fragile)

**Best practice**
- `viewport-fit=cover` plus `env(safe-area-inset-*)`, combined with `max()` for landscape gutters, is the WebKit-documented pattern. https://webkit.org/blog/7929/designing-websites-for-iphone-x/
- `100vh` in Safari tabs is the large viewport; `dvh/svh/lvh` (Safari 15.4+) fix this. In a Home Screen app there are no collapsing browser bars, so `vh`, `dvh`, `svh` and `lvh` are the same on current iOS (secondary and my knowledge; **device test** in landscape on iOS 26). With `black-translucent`, the viewport is the full screen and the safe-area top inset equals the status bar/Dynamic Island height.
- No orientation lock exists on iOS web apps (manifest `orientation` ignored, Screen Orientation lock partial since 16.4); layouts must adapt. `orientationchange` can fire before dimensions update.

**Repo now**
- `index.html:5` `viewport-fit=cover`. `styles.css:30-36` defines `--sat/--sab/--sal/--sar` and `--gl/--gr = max(16px, inset)`. Sheets add `env(safe-area-inset-bottom)` (`styles.css:123`, `UploadSheet.tsx:46`, `FilterSheet.tsx:46`). Matches the guidance.
- Standalone: `html.standalone .app { bottom:auto; height:100vh }` set by `navigator.standalone` (`main.tsx:8`) plus the same rule under `@media (display-mode: standalone)` (`styles.css:69-70`). Redundant but harmless; `navigator.standalone` is iOS-only and the media query is the standards-based signal. Note the `.app` fixed with `top/right/bottom/left: 0` already covers the screen in a normal tab (`styles.css:63-64`).
- `useLayout` (`viewport.ts`) reads `innerWidth/innerHeight` on `resize` and, defensively, on the next frame and at 250ms after `orientationchange`. This is the right pattern for iOS's stale-size report.
- `max-width: 520px` centered on wide screens (`styles.css:64`), landscape layout opts out (`:75`). Safe-area side insets in landscape handled via `--gl/--gr`.

**Verdict:** OK. Possible tidy-ups, all P3: use `100dvh` with `100vh` first as a fallback (`height: 100vh; height: 100dvh;`) so a future Safari change cannot reintroduce the gap, and delete the JS class if `display-mode: standalone` proves sufficient on a device (it has worked on iOS since 13).

**Follow-up note:** the `100dvh` line was not added. The home-screen fix exists because iOS reported the page height short by the status bar; if `dvh` follows that short value rather than the screen, it would bring the gap back. Try it on a device before adding it.

---

## 12. Service worker, offline, push, badging  (not warranted)

**Best practice / facts**
- Service workers are supported in Home Screen apps; Web Push needs iOS 16.4+ and an installed app, with permission requested from a user gesture; Declarative Web Push (no service worker) is iOS 18.4+; Badging API works for installed apps (16.4+); Screen Wake Lock works in installed apps on 18.4+. https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ and https://webkit.org/blog/16574/webkit-features-in-safari-18-2/ (the 18.4 items appear in the same post's text).
- Cold start offline in an installed app with no service worker shows Safari's "Cannot Open Page" error, not your UI.
- A service worker for an Access-protected origin must not cache HTML/API responses across sessions blindly: an expired session returns a login redirect, and a worker that serves a cached shell hides it; the `CF_Authorization` cookie is not visible to a worker's `fetch` as a way to check it.

**Repo now:** no service worker, no push, no badge. Data is private, personal and entirely server-held (D1/R2/Vectorize); all useful actions (browse, search, upload) need the network. Search is semantic server-side.

**Verdict:** not warranted. Push, badging and wake lock have no use case here.

**Recommended change (optional, P3):** if cold-start-offline matters (e.g. showing the archive on a gallery wall with poor Wi-Fi), the least risky option is a tiny service worker that precaches only the **static Vite assets and the font files** (`/assets/*`, cache-first, versioned by hash) and uses **network-first with no fallback caching** for navigation and `/api/*`. Do not cache `/img/*` originals; previews are already immutable-cached by the HTTP cache. Without that, add a friendlier `offline` state to the boot error screen (`App.tsx:197`) using `navigator.onLine` plus a Retry button, which costs nothing.

---

## 13. Touch and pointer details  (P3)

**Best practice:** `touch-action: manipulation` removes double-tap-zoom delay on custom controls; `-webkit-tap-highlight-color` should be set on the element that receives the tap; `-webkit-touch-callout: none` suppresses the long-press image callout where unwanted; avoid `:hover`-only affordances; `overscroll-behavior` is supported in Safari 16+.

**Repo now**
- `-webkit-tap-highlight-color: transparent` only on `button, input, textarea, select` (`styles.css:48`), not on `a` (download links `PieceView.tsx:544,557`) or `[role=button]` divs. Minor gray flash on those.
- `touch-action` used well: carousel `pan-y` (`PieceView.tsx:305`), hero `pan-y` (`Timeline.tsx:250`), timeline strip `none` (`Timeline.tsx:172`), slider thumbs (`FilterSheet.tsx:133`). No global `manipulation`.
- No `:hover` rules (grep). Good.
- `overscroll-behavior: none` on `body` (`styles.css:46`). Pull-to-refresh does not exist in iOS Safari or in Home Screen apps, so there is nothing to suppress; rubber-banding is avoided by the fixed shell. Inner `.scroll` containers still bounce, which is normal.
- Images use `draggable={false}`; long-press still shows iOS's image menu. For an art archive that may be a feature (Save/Copy/Share), so leave it unless unwanted.

**Recommended change:** move `-webkit-tap-highlight-color: transparent` to `html`; add `touch-action: manipulation` on `button, a, [role=button]`; decide deliberately about `-webkit-touch-callout`.

---

## 14. `navigator.vibrate`  (P3 note)

`src/util.ts:55` calls `navigator.vibrate?.()`; iOS Safari does not implement the Vibration API, so the haptic calls in `App.tsx` (e.g. lines 154, 174) do nothing on the target device. The try/catch and optional call keep it harmless. If tactile feedback matters, the only iOS-web route is the `<input type="checkbox" switch>` haptic trick (Safari 17.4+), which is not documented as supported behavior; I would not rely on it.

---

## Already fine (no action)

- Viewport meta: no `user-scalable=no`, no scale caps. Accessible zoom is preserved. `viewport-fit=cover` present. (`index.html:5`)
- `theme-color` and `background` colours match (`#100F0E`) so the area under the status bar and any rubber-band seam are the same colour (`styles.css:42-47`).
- 16px inputs everywhere; no auto-zoom.
- `-webkit-text-size-adjust: 100%` set for landscape (`styles.css:42`).
- Safe-area variables and `max()` gutters; sheets pad the home indicator.
- Orientation: no lock, live re-layout with iOS-stale-size workaround (`viewport.ts`).
- Hash-based deep links stay in scope (`App.tsx:73-90`); history uses `replaceState` correctly.
- Uploads sequential, with progress and error toasts; HEIC fallback path exists server-side.
- Immutable caching for previews; ETag/304 handling in `/img/*` (`worker/index.ts:131-145`).
- `prefers-reduced-motion` present (needs the iteration-count fix, item 9).
- `.sr-only` utility, `aria-label`s, focus-visible outlines, 44px primary touch targets.

## Suggested implementation order

1. P1: manifest + icons + title meta + `crossorigin="use-credentials"` (items 1-2). Then add `X-Requested-With` and 401 handling plus resume refresh (item 3). Run the cold-start/expired-session device test (item 4).
2. P2: keyboard inset hook after a device check (5); self-host fonts (6); verify the `accept` list and HEIC behaviour on a phone (7); `decoding=async` and downscaled decode (8); reduced-motion iteration count (9); contrast tweak (10).
3. P3: `100dvh` fallback, tap-highlight/touch-action globals, optional offline-friendly error state or static-asset-only service worker.
