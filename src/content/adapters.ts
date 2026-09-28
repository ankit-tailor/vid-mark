import type { AdapterId } from '@/lib/types';

/**
 * Site adapters.
 *
 * Every adapter answers four questions about the video on the current page:
 *   findVideo()   which <video> element is the one the user means
 *   key()         a stable identity that survives URL noise, so notes re-attach
 *   deepLink(t)   a URL that opens this video at second t
 *   hideChrome()  temporarily hide native player UI; returns a restore fn
 *
 * hideChrome() is unused until frame capture lands, but adapters declare it now
 * so the capture path has nothing left to figure out per-site.
 */
export interface Adapter {
  id: AdapterId;
  label: string;
  matches(): boolean;
  findVideo(): HTMLVideoElement | null;
  key(): string;
  title(): string;
  deepLink(t: number): string;
  hideChrome(video: HTMLVideoElement | null): () => void;
  /**
   * The video plays in a cross-origin child frame, where `findVideo()` cannot
   * see it. The frame agent (`frame-agent.ts`) answers for it instead.
   */
  remote?: boolean;
}

/**
 * A plain `querySelectorAll` cannot see into a shadow root, so a `<video>` that
 * a web component encapsulates is invisible to it. Walking every element is not
 * free, so it only happens when the cheap query finds nothing — which on an
 * ordinary page is never.
 */
function allVideos(): HTMLVideoElement[] {
  const direct = [...document.querySelectorAll('video')];
  if (direct.length) return direct;

  const found: HTMLVideoElement[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const el of root.querySelectorAll('*')) {
      if (el instanceof HTMLVideoElement) found.push(el);
      else if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return found;
}

/** Largest video wins — skips the muted autoplay previews sites love to stack. */
function largestVideo(): HTMLVideoElement | null {
  const videos = allVideos().filter(
    // A `<source>` child counts: a video that hasn't been played yet has no
    // `src`, no `currentSrc` and `readyState` 0, but is still the real one.
    (v) => v.readyState > 0 || v.currentSrc || v.src || v.querySelector('source')
  );
  if (!videos.length) return null;
  return videos.sort(
    (a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight
  )[0];
}

const generic: Adapter = {
  id: 'generic',
  label: 'Video',
  matches: () => true,
  findVideo: largestVideo,

  key() {
    const u = new URL(location.href);
    // Query strings carry tracking junk and playlist state; path is the identity.
    if (u.protocol === 'file:') return `file:${decodeURIComponent(u.pathname)}`;
    return `url:${u.origin}${u.pathname}`;
  },

  title() {
    return document.title.trim() || location.hostname;
  },

  deepLink(t) {
    const u = new URL(location.href);
    // Media fragment. Chrome honours this natively on a bare video file, and
    // most players that care about deep links read it too.
    u.hash = `t=${Math.floor(t)}`;
    return u.toString();
  },

  hideChrome(video) {
    if (!video || !video.hasAttribute('controls')) return () => {};
    video.removeAttribute('controls');
    return () => video.setAttribute('controls', '');
  },
};

function youtubeVideoId(): string | null {
  const u = new URL(location.href);
  const v = u.searchParams.get('v');
  if (v) return v;
  const shorts = u.pathname.match(/^\/shorts\/([\w-]+)/);
  if (shorts) return shorts[1];
  const embed = u.pathname.match(/^\/embed\/([\w-]+)/);
  if (embed) return embed[1];
  if (location.hostname === 'youtu.be') return u.pathname.slice(1) || null;
  return null;
}

const youtube: Adapter = {
  id: 'youtube',
  label: 'YouTube',
  matches: () =>
    /(^|\.)youtube\.com$/.test(location.hostname) ||
    location.hostname === 'youtu.be',

  findVideo: () =>
    document.querySelector<HTMLVideoElement>('video.html5-main-video') ??
    largestVideo(),

  key() {
    const id = youtubeVideoId();
    return id ? `youtube:${id}` : generic.key();
  },

  title() {
    const h =
      document.querySelector('#title h1 yt-formatted-string') ??
      document.querySelector('h1.ytd-watch-metadata') ??
      document.querySelector('#title h1');
    const text = (h?.textContent || document.title).trim();
    return text.replace(/\s*-\s*YouTube$/, '');
  },

  deepLink(t) {
    const id = youtubeVideoId();
    return id ? `https://youtu.be/${id}?t=${Math.floor(t)}` : generic.deepLink(t);
  },

  hideChrome() {
    const player = document.querySelector('.html5-video-player');
    if (!player) return () => {};
    const had = player.classList.contains('ytp-autohide');
    player.classList.add('ytp-autohide');
    return () => {
      if (!had) player.classList.remove('ytp-autohide');
    };
  },
};

function loomShareId(): string | null {
  const m = location.pathname.match(/\/(?:share|embed)\/([0-9a-f]{16,})/i);
  return m ? m[1] : null;
}

const loom: Adapter = {
  id: 'loom',
  label: 'Loom',
  matches: () => /(^|\.)loom\.com$/.test(location.hostname),
  findVideo: largestVideo,

  key() {
    const id = loomShareId();
    return id ? `loom:${id}` : generic.key();
  },

  title() {
    return document.title.replace(/\s*[|–-]\s*Loom\s*$/i, '').trim();
  },

  deepLink(t) {
    const id = loomShareId();
    // NOTE: Loom's `?t=` param is seconds. Unverified against a live share
    // link — if timestamps come back ignored, this one line is the fix.
    return id
      ? `https://www.loom.com/share/${id}?t=${Math.floor(t)}`
      : generic.deepLink(t);
  },

  hideChrome: () => () => {},
};

/**
 * Neither X nor LinkedIn has a timestamp parameter, so their deep links carry a
 * media fragment the site ignores — the link opens the post at 0:00. The note
 * text still leads with the timestamp, so a reader knows where to scrub to.
 */
function twitterStatusId(): string | null {
  const m = location.pathname.match(/\/status(?:es)?\/(\d+)/);
  if (m) return m[1];

  // On a timeline the URL says nothing about which post, so identity comes from
  // the article the video sits in. Without this, every video in the feed would
  // key to `/home` and pile its notes together.
  const article = largestVideo()?.closest('article');
  const href =
    article?.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? '';
  const inline = href.match(/\/status\/(\d+)/);
  return inline ? inline[1] : null;
}

const twitter: Adapter = {
  id: 'twitter',
  label: 'X',
  matches: () => /(^|\.)(x|twitter)\.com$/.test(location.hostname),

  findVideo: () =>
    document.querySelector<HTMLVideoElement>(
      '[data-testid="videoPlayer"] video'
    ) ?? largestVideo(),

  key() {
    // twitter.com and x.com are the same post, so the key deliberately is not
    // host-derived — notes taken under either domain land in one pile.
    const id = twitterStatusId();
    return id ? `twitter:${id}` : generic.key();
  },

  title() {
    const text = document
      .querySelector('[data-testid="tweetText"]')
      ?.textContent?.trim();
    if (text) return text.length > 90 ? `${text.slice(0, 89)}…` : text;
    return document.title.replace(/\s*\/\s*(X|Twitter)\s*$/i, '').trim();
  },

  deepLink(t) {
    const id = twitterStatusId();
    // `/i/status/` redirects to the canonical post, so the author's handle —
    // which a timeline does not reliably give us — is not needed.
    return id
      ? `https://x.com/i/status/${id}#t=${Math.floor(t)}`
      : generic.deepLink(t);
  },

  hideChrome: () => () => {},
};

function linkedinActivityId(): string | null {
  // The urn is percent-encoded in the address bar more often than not.
  const href = decodeURIComponent(location.href);
  const urn = href.match(/urn:li:(?:activity|ugcPost):(\d+)/);
  if (urn) return urn[1];

  // /posts/<slug>-activity-<id>-<hash>
  const slug = location.pathname.match(/-activity-(\d+)-/);
  if (slug) return slug[1];

  // In the feed the URL is just /feed/, so the post's own urn is the identity.
  const post = largestVideo()?.closest('[data-urn], [data-id]');
  const attr =
    post?.getAttribute('data-urn') || post?.getAttribute('data-id') || '';
  const inline = attr.match(/urn:li:(?:activity|ugcPost):(\d+)/);
  return inline ? inline[1] : null;
}

const linkedin: Adapter = {
  id: 'linkedin',
  label: 'LinkedIn',
  matches: () => /(^|\.)linkedin\.com$/.test(location.hostname),

  findVideo: () =>
    document.querySelector<HTMLVideoElement>('video.vjs-tech') ?? largestVideo(),

  key() {
    const id = linkedinActivityId();
    return id ? `linkedin:${id}` : generic.key();
  },

  title() {
    return document.title.replace(/\s*\|\s*LinkedIn\s*$/i, '').trim();
  },

  deepLink(t) {
    const id = linkedinActivityId();
    return id
      ? `https://www.linkedin.com/feed/update/urn:li:activity:${id}/#t=${Math.floor(t)}`
      : generic.deepLink(t);
  },

  hideChrome: () => () => {},
};

function driveFileId(): string | null {
  const u = new URL(location.href);
  // /file/d/<id>/view, and /file/u/<n>/d/<id>/view when signed into several
  // accounts — the account index is not part of the file's identity.
  const m = u.pathname.match(/^\/file\/(?:u\/\d+\/)?d\/([\w-]+)/);
  if (m) return m[1];
  return u.pathname === '/open' ? u.searchParams.get('id') : null;
}

/**
 * Drive plays video in a youtube.googleapis.com embed whose URL carries only an
 * opaque token, never the file id. So identity, title and links come from the
 * Drive page, and the video itself is driven through the frame agent.
 */
const drive: Adapter = {
  id: 'drive',
  label: 'Google Drive',
  matches: () => location.hostname === 'drive.google.com',
  findVideo: largestVideo,
  remote: true,

  key() {
    const id = driveFileId();
    return id ? `drive:${id}` : generic.key();
  },

  title() {
    return document.title.replace(/\s*-\s*Google Drive\s*$/i, '').trim();
  },

  deepLink(t) {
    const id = driveFileId();
    // NOTE: Drive's `?t=` param is seconds. Unverified against a live file —
    // if timestamps come back ignored, this one line is the fix.
    return id
      ? `https://drive.google.com/file/d/${id}/view?t=${Math.floor(t)}`
      : generic.deepLink(t);
  },

  hideChrome: () => () => {},
};

const ALL: Adapter[] = [youtube, loom, twitter, linkedin, drive, generic];

export function resolveAdapter(): Adapter {
  return ALL.find((a) => a.matches()) ?? generic;
}
