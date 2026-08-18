import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Textarea } from '@/components/ui/textarea';
import { fmtTime } from '@/lib/format';
import type { Note } from '@/lib/types';
import { cn } from '@/lib/utils';
import {
  composerStore,
  type ComposerRequest,
  type ToastMessage,
} from './composer-store';

/**
 * The rail: the notes already on this video, with the composer pinned beneath
 * them. Saving keeps the surface open and appends to the list, so a review is
 * one continuous session rather than a series of one-shot popups.
 *
 * It anchors to the right edge and enters from it, which makes leaving read as
 * the reverse of arriving. Both directions ease out — an entrance is the moment
 * the user is watching most closely, and ease-in spends it standing still.
 */
const EXIT_MS = 100;

function Composer({ request }: { request: ComposerRequest }) {
  const [text, setText] = React.useState('');
  const [notes, setNotes] = React.useState<Note[]>(request.notes);
  const [t, setT] = React.useState(request.startTime);
  const [phase, setPhase] = React.useState<'enter' | 'shown' | 'exit'>('enter');
  const [saving, setSaving] = React.useState(false);
  /** The note just written, so it can announce itself and scroll into view. */
  const [added, setAdded] = React.useState<string | null>(null);

  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const exiting = React.useRef(false);

  /**
   * Notes are kept in timestamp order, so a new one can land anywhere in the
   * list. This nudges the list to it — and only the list: `scrollIntoView`
   * would walk up and scroll the host page too, yanking the video out of view
   * mid-note.
   */
  React.useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-note="${added}"]`);
    if (!list || !row) return;

    const rowBox = row.getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
    else if (rowBox.bottom > listBox.bottom) {
      list.scrollTop += rowBox.bottom - listBox.bottom;
    }
  }, [added]);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setPhase('shown'));
    inputRef.current?.focus();
    return () => cancelAnimationFrame(frame);
  }, []);

  /** Play the exit transition, then hand control back to the store. */
  const close = React.useCallback(() => {
    if (exiting.current) return;
    exiting.current = true;
    setPhase('exit');
    setTimeout(() => composerStore.close(), EXIT_MS);
  }, []);

  const save = React.useCallback(async () => {
    const value = text.trim();
    if (!value || saving) return;

    setSaving(true);
    setText('');
    try {
      const before = new Set(notes.map((n) => n.id));
      const next = await request.onSave(t, value);
      setNotes(next);
      setAdded(next.find((n) => !before.has(n.id))?.id ?? null);
    } catch {
      // Put the draft back rather than swallow it — this is someone's writing.
      setText(value);
      composerStore.toast('Could not save note');
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  }, [text, saving, notes, request, t]);

  /**
   * Bound at window/capture rather than as `onKeyDown`, because the shield in
   * `content/index.tsx` stops propagation for our events one step earlier —
   * nothing bound below window ever runs. See the comment there; the ordering
   * this depends on is spelled out in full.
   *
   * `latest` keeps the listener itself stable while still reading current state.
   */
  const latest = React.useRef({ save, close });
  latest.current = { save, close };

  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // `e.target` is retargeted to the shadow host this far out, so it can
      // never be the textarea. The composed path still holds the real one.
      if (!inputRef.current || e.composedPath()[0] !== inputRef.current) return;
      // Enter commits a line to an IME candidate list, not to the note.
      if (e.isComposing || e.keyCode === 229) return;

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void latest.current.save();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        latest.current.close();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  function seek(to: number) {
    request.onSeek(to);
    setT(to);
    inputRef.current?.focus();
  }

  return (
    <div
      className={cn(
        'fixed right-6 bottom-8 z-[2147483647] flex w-90 flex-col',
        'max-h-[min(70vh,560px)] overflow-hidden rounded-2xl',
        'border border-border bg-card/85 text-card-foreground backdrop-blur-xl',
        'shadow-[0_1px_2px_oklch(0_0_0/0.3),0_24px_56px_-16px_oklch(0_0_0/0.7)]',
        'transition-[opacity,transform] ease-out',
        phase === 'shown'
          ? 'translate-x-0 opacity-100 duration-150'
          : 'translate-x-2 opacity-0 duration-100'
      )}
      role="dialog"
      aria-label="Notes on this video"
    >
      <div className="flex flex-none items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold tracking-[-0.01em]">Notes</h2>
        <span className="truncate text-xs text-muted-foreground">
          {notes.length
            ? `${notes.length} on this video`
            : 'none yet on this video'}
        </span>
      </div>

      {/* Plain overflow rather than <ScrollArea>: this list is short, and the
          fewer measuring components inside a shadow root the better. */}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            data-note={note.id}
            onClick={() => seek(note.t)}
            className={cn(
              'grid w-full grid-cols-[auto_1fr] items-start gap-2.5 rounded-lg',
              'px-2.5 py-2 text-left transition-colors hover:bg-muted',
              note.id === added && 'animate-in fade-in slide-in-from-top-1'
            )}
          >
            <Badge variant="secondary" className="tabular-nums">
              {fmtTime(note.t)}
            </Badge>
            <p className="text-[13px] leading-5 break-words whitespace-pre-wrap">
              {note.text}
            </p>
          </button>
        ))}

        {!notes.length && (
          <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
            The first one lands at {fmtTime(t)}.
          </p>
        )}
      </div>

      <div className="flex-none border-t border-border bg-foreground/[0.03] p-3">
        <div className="flex items-start gap-2">
          <Badge variant="secondary" className="mt-px tabular-nums">
            {fmtTime(t)}
          </Badge>
          <Textarea
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
            placeholder="Add a note here…"
            className="max-h-30 min-h-0 resize-none border-0 px-0 py-0 text-[13px] leading-5 shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent"
          />
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-muted-foreground">
            <Kbd>Enter</Kbd> save · <Kbd>Esc</Kbd> close
          </span>
          <Button size="sm" onClick={() => void save()} disabled={!text.trim()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function Toast({ toast }: { toast: ToastMessage }) {
  const [shown, setShown] = React.useState(false);

  React.useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    const hide = setTimeout(() => setShown(false), 2000);
    const drop = setTimeout(() => composerStore.dismissToast(toast.id), 2200);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(hide);
      clearTimeout(drop);
    };
  }, [toast.id]);

  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-8 left-1/2 z-[2147483647] -translate-x-1/2',
        'rounded-xl border border-border bg-card/85 px-4 py-2.5 text-sm',
        'text-card-foreground shadow-2xl backdrop-blur-xl',
        'transition-[opacity,transform] duration-150 ease-out',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
      )}
    >
      {toast.text}
    </div>
  );
}

export function ContentRoot() {
  const state = React.useSyncExternalStore(
    composerStore.subscribe,
    composerStore.snapshot
  );

  return (
    <>
      {state.composer && (
        // Remount per open so every session starts with an empty draft.
        <Composer key={state.composer.id} request={state.composer} />
      )}
      {state.toast && <Toast key={state.toast.id} toast={state.toast} />}
    </>
  );
}
