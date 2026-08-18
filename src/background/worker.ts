import {
  activeTabId,
  broadcast,
  sendToPage,
  type BackgroundRequest,
} from '@/lib/messaging';
import type { Note, NoteMeta, VideoMeta } from '@/lib/types';

/**
 * Service worker: storage owner + command router.
 *
 * MV3 tears this down after ~30s idle, so it holds no state between messages.
 * Everything lives in chrome.storage.local and is re-read on demand.
 *
 * Schema
 *   "index"        -> Record<key, VideoMeta>   one entry per video ever noted
 *   "notes:<key>"  -> Note[]                   sorted by timestamp
 */

const INDEX_KEY = 'index';
const notesKey = (key: string) => `notes:${key}`;

type Index = Record<string, VideoMeta>;

async function readIndex(): Promise<Index> {
  const stored = await chrome.storage.local.get(INDEX_KEY);
  return (stored[INDEX_KEY] as Index) ?? {};
}

async function readNotes(key: string): Promise<Note[]> {
  const k = notesKey(key);
  const stored = await chrome.storage.local.get(k);
  return (stored[k] as Note[]) ?? [];
}

async function writeNotes(
  key: string,
  notes: Note[],
  meta?: NoteMeta
): Promise<void> {
  notes.sort((a, b) => a.t - b.t);
  const index = await readIndex();

  if (notes.length === 0) {
    delete index[key];
    await chrome.storage.local.remove(notesKey(key));
  } else {
    index[key] = {
      ...index[key],
      ...meta,
      key,
      count: notes.length,
      updatedAt: Date.now(),
    };
    await chrome.storage.local.set({ [notesKey(key)]: notes });
  }
  await chrome.storage.local.set({ [INDEX_KEY]: index });
  broadcast({ type: 'notes:changed', key });
}

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// --- message routing -------------------------------------------------------

async function handle(msg: BackgroundRequest): Promise<unknown> {
  switch (msg.type) {
    case 'notes:add': {
      const notes = await readNotes(msg.key);
      notes.push({ id: newId(), createdAt: Date.now(), ...msg.note });
      await writeNotes(msg.key, notes, msg.meta);
      return { ok: true };
    }

    case 'notes:list': {
      const [notes, index] = await Promise.all([readNotes(msg.key), readIndex()]);
      return { notes, meta: index[msg.key] ?? null };
    }

    case 'notes:update': {
      const notes = await readNotes(msg.key);
      const note = notes.find((n) => n.id === msg.id);
      if (note) Object.assign(note, msg.patch);
      await writeNotes(msg.key, notes);
      return { ok: !!note };
    }

    case 'notes:delete': {
      const notes = (await readNotes(msg.key)).filter((n) => n.id !== msg.id);
      await writeNotes(msg.key, notes);
      return { ok: true };
    }

    case 'notes:clear': {
      await writeNotes(msg.key, []);
      return { ok: true };
    }

    case 'index:list': {
      const index = await readIndex();
      return {
        videos: Object.values(index).sort((a, b) => b.updatedAt - a.updatedAt),
      };
    }

    case 'page:navigated': {
      // Relayed from the content script so an open panel can re-target.
      broadcast({ type: 'page:changed', state: msg.state });
      return { ok: true };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: BackgroundRequest, _sender, respond) => {
  handle(msg).then(respond, (err) => respond({ ok: false, error: String(err) }));
  return true; // async respond
});

// --- commands + action -----------------------------------------------------

/**
 * Tabs that were already open when the extension was installed or reloaded have
 * no content script in them, and `sendToPage` reports that as null rather than
 * throwing. Injecting on demand is what makes the shortcut work on the tabs the
 * user already has open — otherwise it silently does nothing until they reload,
 * which reads as "the shortcut is broken".
 */
async function compose(tabId: number): Promise<void> {
  if (await sendToPage(tabId, 'page:compose', {})) return;

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js;
  if (!files?.length) return;

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch {
    return; // chrome://, the Web Store, the PDF viewer — nothing to annotate
  }
  await sendToPage(tabId, 'page:compose', {});
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'add-note') return;
  const tabId = await activeTabId();
  if (tabId === null) return;
  await compose(tabId);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {});
});
