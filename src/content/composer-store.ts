import type { Note } from '@/lib/types';

/**
 * External store bridging the imperative content script to the React tree.
 *
 * The composer is opened by a keyboard command arriving over chrome.runtime —
 * outside React entirely — so state lives here and components subscribe via
 * useSyncExternalStore.
 */

export interface ComposerRequest {
  /** Distinguishes consecutive opens at the same timestamp, so React remounts. */
  id: number;
  /** Notes already on this video, sorted by timestamp. */
  notes: Note[];
  /** Playback position when the composer opened. */
  startTime: number;
  /** Seeks the video; the rail's timestamp follows it. */
  onSeek: (t: number) => void;
  /** Resolves with the video's full list, re-read so ids and order are real. */
  onSave: (t: number, text: string) => Promise<Note[]>;
  /** Runs once when the composer closes — used to resume playback. */
  onDismiss: () => void;
}

export interface ToastMessage {
  id: number;
  text: string;
}

interface State {
  composer: ComposerRequest | null;
  toast: ToastMessage | null;
}

let state: State = { composer: null, toast: null };
let toastSeq = 0;
let composerSeq = 0;

const listeners = new Set<() => void>();

function set(next: State): void {
  state = next;
  for (const listener of listeners) listener();
}

export const composerStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  snapshot: (): State => state,

  isOpen: (): boolean => state.composer !== null,

  open(request: Omit<ComposerRequest, 'id'>): void {
    set({ ...state, composer: { ...request, id: ++composerSeq } });
  },

  /**
   * Saving no longer closes anything — the rail stays open so the list keeps
   * building — so this is the only way out, whether the user pressed Esc or
   * navigated away.
   */
  close(): void {
    const request = state.composer;
    if (!request) return;
    set({ ...state, composer: null });
    request.onDismiss();
  },

  toast(text: string): void {
    set({ ...state, toast: { id: ++toastSeq, text } });
  },

  dismissToast(id: number): void {
    if (state.toast?.id !== id) return;
    set({ ...state, toast: null });
  },
};
