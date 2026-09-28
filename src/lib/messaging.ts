import type {
  Note,
  NoteDraft,
  NoteMeta,
  PageState,
  VideoMeta,
  VideoState,
} from './types';

/**
 * Typed message contracts.
 *
 * Two directions, deliberately kept apart:
 *   background — anything that touches storage. Sent with chrome.runtime.
 *   page       — anything that touches the video. Sent with chrome.tabs.
 *   frame      — a video in a cross-origin child frame (Drive). Content
 *                scripts cannot reach sibling frames, so the top frame asks
 *                the worker, which relays to the frame agent.
 *
 * Broadcasts flow one way only: background → side panel.
 */

type BackgroundContract = {
  'notes:add': {
    req: { key: string; meta: NoteMeta; note: NoteDraft };
    res: { ok: boolean };
  };
  'notes:list': {
    req: { key: string };
    res: { notes: Note[]; meta: VideoMeta | null };
  };
  'notes:update': {
    req: { key: string; id: string; patch: Partial<Note> };
    res: { ok: boolean };
  };
  'notes:delete': { req: { key: string; id: string }; res: { ok: boolean } };
  'notes:clear': { req: { key: string }; res: { ok: boolean } };
  'index:list': { req: Record<string, never>; res: { videos: VideoMeta[] } };
  'page:navigated': { req: { state: PageState }; res: { ok: boolean } };
  'frame:video': { req: { op: VideoOp; t?: number }; res: VideoState | null };
  'frame:compose': { req: Record<string, never>; res: { ok: boolean } };
};

/**
 * Every op answers with the state *after* it ran, or null when no frame agent
 * is listening — the player frame hasn't loaded, or this page has none.
 */
export type VideoOp = 'state' | 'pause' | 'play' | 'seek';

/** Worker → frame agent. Only the agent listens for this type. */
export type FrameRequest = { type: 'frame:video'; op: VideoOp; t?: number };

type PageContract = {
  'page:state': { req: Record<string, never>; res: PageState };
  'page:compose': { req: Record<string, never>; res: { ok: boolean } };
  'page:seek': { req: { t: number }; res: { ok: boolean } };
};

export type BackgroundType = keyof BackgroundContract;
export type PageType = keyof PageContract;

export type BackgroundRequest = {
  [K in BackgroundType]: { type: K } & BackgroundContract[K]['req'];
}[BackgroundType];

export type PageRequest = {
  [K in PageType]: { type: K } & PageContract[K]['req'];
}[PageType];

/** Background → side panel. Fire-and-forget; nobody may be listening. */
export type Broadcast =
  | { type: 'notes:changed'; key: string }
  | { type: 'page:changed'; state: PageState };

export function sendToBackground<K extends BackgroundType>(
  type: K,
  payload: BackgroundContract[K]['req']
): Promise<BackgroundContract[K]['res']> {
  return chrome.runtime.sendMessage({ type, ...payload });
}

/**
 * Resolves to null when no content script is present — chrome:// pages, the
 * Web Store, and the built-in PDF viewer all refuse injection. Callers treat
 * null as "nothing to annotate here", not as an error.
 */
export async function sendToPage<K extends PageType>(
  tabId: number,
  type: K,
  payload: PageContract[K]['req']
): Promise<PageContract[K]['res'] | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type, ...payload });
  } catch {
    return null;
  }
}

export function broadcast(message: Broadcast): void {
  chrome.runtime.sendMessage(message).catch(() => {});
}

export async function activeTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}
