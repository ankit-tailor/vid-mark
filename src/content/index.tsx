import { createRoot } from "react-dom/client";
import css from "@/styles/globals.css?inline";
import type { PageRequest } from "@/lib/messaging";
import { sendToBackground } from "@/lib/messaging";
import type { Note, PageState } from "@/lib/types";
import { resolveAdapter } from "./adapters";
import { composerStore } from "./composer-store";
import { ContentRoot } from "./Composer";
import { findVideo } from "./video";

/**
 * Content script entry point.
 *
 * Owns page-side concerns only: which video, what time, seek, and the composer.
 * All persistence goes through the service worker so there is exactly one copy
 * of the storage logic.
 */

const adapter = resolveAdapter();

// --- shadow root -----------------------------------------------------------

/**
 * The UI renders inside a shadow root so host-page CSS can't reach it and our
 * Tailwind reset can't leak out. `?inline` keeps the stylesheet as a JS string
 * — importing it normally would have crxjs inject it into the page instead,
 * where it would restyle the site underneath us.
 */
function mountUi(): void {
  // The worker injects this script on demand into tabs that predate the
  // extension. If a reload left an orphaned copy behind, its DOM is still in
  // the page but its runtime is dead — clear it rather than stack a second UI.
  document.getElementById("vid-mark-root")?.remove();

  const host = document.createElement("div");
  host.id = "vid-mark-root";
  host.style.cssText = "all:initial;position:static;";

  const shadow = host.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  // Bundled `url()`s are root-relative, which inside a content script resolves
  // against the *host page* — `youtube.com/assets/manrope.woff2`, a 404. Chrome
  // does honour @font-face inside a shadow root, so pointing the sources back
  // at the extension is all it takes for the composer to get its real typeface.
  //
  // Every root-relative url, not just `/assets/`: the dev server serves fonts
  // from `/node_modules/.vite/deps/`, so matching the build's layout alone left
  // the composer falling back to a system font for the whole of `pnpm dev`.
  style.textContent = css.replace(
    /url\((['"]?)\/([^'")]+)\1\)/g,
    (_, quote: string, path: string) =>
      `url(${quote}${chrome.runtime.getURL(path)}${quote})`,
  );

  // Forced dark: the composer floats over video, where a light card reads as
  // a page element rather than an overlay.
  const mount = document.createElement("div");
  mount.className = "dark";

  shadow.append(style, mount);
  document.documentElement.appendChild(host);

  createRoot(mount).render(<ContentRoot />);

  /**
   * Host pages bind single-key hotkeys to document/window (YouTube: k, j, space,
   * digits). Typing in the composer would trigger them. Window capture runs
   * before any of those handlers, and shadow events retarget to `host` at this
   * level — so swallowing anything aimed at us is both safe and sufficient.
   *
   * The cost, and it is not obvious: `stopPropagation()` here ends the event's
   * journey entirely. It never descends to the textarea, so neither React's
   * delegated listeners nor a listener on the element itself ever run — which
   * is why the composer binds its own keys at this same window/capture level
   * rather than with `onKeyDown`. Sibling listeners on the same node and phase
   * still fire (only `stopImmediatePropagation` would cut those off), and they
   * run in registration order, so the composer's handler — registered later,
   * when it opens — sees every event this shield hides from the page.
   */
  const shield = (e: Event) => {
    if (composerStore.isOpen() && e.composedPath().includes(host)) {
      e.stopPropagation();
    }
  };
  for (const type of ["keydown", "keyup", "keypress"]) {
    window.addEventListener(type, shield, true);
  }
}

mountUi();

// --- page state ------------------------------------------------------------

/** Snapshot of the page for the side panel. A null video is a valid answer. */
async function pageState(): Promise<PageState> {
  const found = await findVideo(adapter);
  return {
    hasVideo: !!found,
    adapter: adapter.id,
    adapterLabel: adapter.label,
    key: adapter.key(),
    title: adapter.title(),
    url: location.href,
    duration: found?.state.duration ?? null,
    currentTime: found?.state.currentTime ?? 0,
  };
}

async function startComposer(): Promise<void> {
  if (composerStore.isOpen()) return;
  const found = await findVideo(adapter);
  if (!found) {
    composerStore.toast("No video found on this page");
    return;
  }
  // Finding a video in another frame is a round trip; the other entry path
  // (command vs. chord) may have opened the composer meanwhile.
  if (composerStore.isOpen()) return;

  const { video } = found;
  const wasPlaying = !found.state.paused;
  // Pausing reports where playback actually stopped, which is a moment later
  // than the state we found it in.
  const state = (wasPlaying && (await video.pause())) || found.state;

  // Snapshot identity now. A client-side route change while the composer is
  // open would otherwise file the note against whatever video loaded next.
  const key = adapter.key();
  const meta = {
    title: adapter.title(),
    url: location.href,
    adapter: adapter.id,
    duration: state.duration,
  };

  // The rail leads with the notes already on this video, so they are read
  // before it opens — filling an empty list in afterwards would flash.
  const notes = await sendToBackground("notes:list", { key })
    .then((r) => r.notes)
    .catch(() => [] as Note[]);

  // That await is short but not free, and a router can move underneath it.
  if (adapter.key() !== key || composerStore.isOpen()) return;

  composerStore.open({
    notes,
    startTime: state.currentTime,
    onSeek: (t) => {
      void video.seek(t);
    },
    onDismiss: () => {
      if (wasPlaying) void video.play();
    },
    // The timestamp comes from the caller, not from open time: the rail stays
    // up across saves, and clicking a note seeks the video underneath it.
    onSave: async (t, text) => {
      const link = adapter.deepLink(t);
      await sendToBackground("notes:add", {
        key,
        meta,
        note: { t, text, link },
      });
      const { notes } = await sendToBackground("notes:list", { key });
      return notes;
    },
  });
}

/**
 * Second path to the same door. `chrome.commands` is the primary one, but its
 * binding is a user-level setting we cannot read or repair: Chrome silently
 * drops our suggested key when another extension already claims it, and the
 * shortcut then does nothing with no indication why. Listening for the chord
 * ourselves means it works out of the box regardless. `startComposer` is a
 * no-op while the composer is open, so both paths firing still opens one.
 */
window.addEventListener(
  "keydown",
  (e) => {
    if (!e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey) return;
    if (e.code !== "KeyK" && e.key.toLowerCase() !== "k") return;
    e.preventDefault();
    e.stopPropagation();
    void startComposer();
  },
  true,
);

chrome.runtime.onMessage.addListener((msg: PageRequest, _sender, respond) => {
  switch (msg.type) {
    case "page:state":
      void pageState().then(respond);
      return true; // async respond

    case "page:compose":
      void startComposer();
      respond({ ok: true });
      return false;

    case "page:seek":
      void findVideo(adapter).then(async (found) => {
        if (found) {
          await found.video.seek(msg.t);
          found.video.reveal();
        }
        respond({ ok: !!found });
      });
      return true; // async respond
  }
  // Anything else — the frame agent's `frame:video` — is not ours to answer.
  return false;
});

// --- SPA navigation --------------------------------------------------------

/**
 * Patching history.pushState from the isolated world would be useless — the
 * page's own calls run in a different JS context. `yt-navigate-finish` is a
 * real DOM event so it does cross over, and a cheap poll covers every other
 * client-side router.
 */
let lastHref = location.href;

function onNavigated(): void {
  lastHref = location.href;
  if (composerStore.isOpen()) composerStore.close();
  void pageState().then((state) =>
    sendToBackground("page:navigated", { state }),
  );
}

window.addEventListener("yt-navigate-finish", onNavigated);
window.addEventListener("popstate", () => {
  if (location.href !== lastHref) onNavigated();
});
setInterval(() => {
  if (location.href !== lastHref) onNavigated();
}, 1000);
