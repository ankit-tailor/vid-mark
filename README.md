# Frame Notes

Timestamped feedback on any video in your browser. Watch, hit `⌘⇧K`, type, keep
watching. Export the whole set as a paste-ready list of comments with deep links.

**Scope:** YouTube · Loom · X · LinkedIn · your own web app · local files · any
HTML5 `<video>`, including ones inside a web component's shadow root.
Notes are stored locally in `chrome.storage.local` — no account, no backend.

React 19 · TypeScript · Vite · Tailwind v4 · shadcn/ui on Base UI · MV3 via crxjs.

## Setup

```bash
pnpm install
pnpm build          # writes dist/
```

Then `chrome://extensions` → **Developer mode** → **Load unpacked** → select `dist/`.
Pin the toolbar icon; clicking it opens the review panel.

For local video files, open the extension's **Details** page and enable
**Allow access to file URLs** — Chrome withholds `file://` from extensions by default.

```bash
pnpm dev            # HMR for the side panel; content script reloads on save
pnpm test           # adapter URL logic
pnpm typecheck
```

## Use

| | |
|---|---|
| `⌘⇧K` / `Ctrl+Shift+K` | Pause and drop a note at the current frame |
| | Chrome drops the binding if another extension owns it — check `chrome://extensions/shortcuts`. The content script also listens for the chord itself, so it works either way. |
| `Enter` | Save and keep going · `Shift+Enter` newline · `Esc` close |
| Click the toolbar icon | Open the review panel |
| Click any note | Seek the video to that timestamp — in the rail or the panel |
| **Library** | Every video you've taken notes on |
| **Copy feedback** | Whole set to clipboard, Slack or Markdown |

The composer is a rail: it opens against the right edge showing every note
already on this video, and saving appends to that list rather than closing it.
Playback stays paused until you press `Esc`, then resumes where it was.

Export looks like this:

```
Feedback on "Q3 Dashboard Demo"
https://www.loom.com/share/abc123

• 0:14 — intro drags, cut the first 8s → https://www.loom.com/share/abc123?t=14
• 1:23 — typo in the header here → https://www.loom.com/share/abc123?t=83
```

## Layout

```
src/
  manifest.config.ts     typed MV3 manifest (crxjs)
  background/worker.ts   sole owner of chrome.storage; command routing
  content/
    adapters.ts          per-site: find video, stable identity key, deep link
    index.tsx            shadow-root mount, page state, seek, SPA navigation
    composer-store.ts    external store bridging chrome events → React
    Composer.tsx         the notes rail + toasts
  sidepanel/             review panel (Panel.tsx)
  components/ui/         shadcn components (Base UI)
  lib/
    messaging.ts         typed message contracts
    format.ts            time formatting + Slack/Markdown export
    types.ts
test/adapters.test.ts    URL identity and deep-link formats
```

### Five constraints worth knowing before editing

**The content script's CSS is imported with `?inline`.** A normal CSS import
would have crxjs add it to the manifest's `content_scripts.css`, which injects
Tailwind's reset into the host page and restyles the site underneath you. Keeping
it a JS string means it only ever reaches the shadow root.

**`globals.css` defines its tokens on `:root, :host`.** Inside a shadow root
`:root` never matches, so without `:host` every `var(--background)` in the
composer would resolve to nothing. The same applies to `.dark, :host(.dark)`.

**The composer swallows keystrokes at window-capture phase.** Host pages bind
single-key hotkeys to `document` (YouTube: `k`, `j`, space, digits). Without the
shield in `content/index.tsx`, typing feedback would scrub the video underneath.
The shield's `stopPropagation()` ends the event outright, so nothing below
`window` ever sees it — which is why the composer binds Enter/Esc at
window-capture too, rather than with `onKeyDown`. React handlers do not run.

**No `rem` in anything the content script renders.** `rem` resolves against the
*host page's* `<html>`, which a shadow root cannot override, and YouTube sets it
to `10px` — every Tailwind size would render at 62.5%. `globals.css` pins the
scale tokens (`--spacing`, `--text-*`, `--radius`) to px under `:host`, so
utilities are safe but rem literals like `text-[0.8rem]` are not. `:host` never
matches in the side panel, which keeps rem and so keeps honouring browser
font-size settings.

**Font `url()`s are rewritten at mount.** Bundled asset URLs are root-relative,
which in a content script points at the host page (`youtube.com/assets/…`).
`content/index.tsx` rewrites them through `chrome.runtime.getURL`, and the files
are listed in `web_accessible_resources`. Chrome does honour `@font-face` inside
a shadow root; without the rewrite the composer silently falls back to Times.

### Adding a site

Append an adapter to `src/content/adapters.ts` and register it in `ALL` ahead of
`generic`. It needs `matches`, `findVideo`, `key`, `title`, `deepLink`, and
`hideChrome`. The `generic` adapter already handles any page with a plain
`<video>`, so a custom one is only worth writing when a site has a stable ID in
the URL worth keying against, or a deep-link format of its own.

## Known limits

- **Google Drive** falls back to the generic adapter. The player sits in a
  cross-origin iframe, so notes key off the URL and timestamps may not resolve.
- **Loom's `?t=`** parameter is unverified against a live share link. If exported
  timestamps come back ignored, `loom.deepLink` is the single line to change.
- **X and LinkedIn have no timestamp parameter.** Their deep links carry an
  inert `#t=` fragment, so the link opens the post at 0:00. The note text still
  leads with the timestamp, so a reader knows where to scrub to. Both key off
  the post id — the status id on X, the activity urn on LinkedIn — read from the
  URL, or from the enclosing post when the video is being watched in a feed.
- **DRM video** (Netflix and friends) is out of scope.
- No frame screenshots yet. Every adapter already implements `hideChrome()` for
  that path — capture goes through `chrome.tabs.captureVisibleTab` in the worker,
  because a cross-origin video taints a canvas and `toDataURL()` throws.
