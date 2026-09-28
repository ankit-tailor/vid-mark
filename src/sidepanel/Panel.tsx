import * as React from 'react';
import { ClapperboardIcon, LibraryIcon, TrashIcon, VideoOffIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Item, ItemActions, ItemContent, ItemMedia } from '@/components/ui/item';
import { Kbd, SHORTCUT_KEYS } from '@/components/ui/kbd';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

import { fmtRelative, fmtTime, renderExport, type ExportFormat } from '@/lib/format';
import { activeTabId, sendToBackground, sendToPage } from '@/lib/messaging';
import type { Note, PageState, VideoMeta } from '@/lib/types';

type View = 'current' | 'library';

/** Derived from the listener signature — @types/chrome renames this interface
 *  between releases, and the shape is what matters. */
type TabChangeInfo = Parameters<
  Parameters<typeof chrome.tabs.onUpdated.addListener>[0]
>[1];

interface CurrentVideo {
  state: PageState | null;
  meta: VideoMeta | null;
  notes: Note[];
}

const EMPTY: CurrentVideo = { state: null, meta: null, notes: [] };

/**
 * Re-reads whenever storage changes, the page navigates, or the user switches
 * tabs. Cheap enough that targeted invalidation isn't worth the bookkeeping.
 */
function usePanelData(view: View) {
  const [current, setCurrent] = React.useState<CurrentVideo>(EMPTY);
  const [videos, setVideos] = React.useState<VideoMeta[]>([]);

  const refresh = React.useCallback(async () => {
    if (view === 'library') {
      const { videos } = await sendToBackground('index:list', {});
      setVideos(videos);
      return;
    }

    const tabId = await activeTabId();
    const state = tabId === null ? null : await sendToPage(tabId, 'page:state', {});
    if (!state) {
      setCurrent(EMPTY);
      return;
    }
    const { notes, meta } = await sendToBackground('notes:list', { key: state.key });
    setCurrent({ state, meta, notes });
  }, [view]);

  React.useEffect(() => {
    void refresh();

    const onMessage = () => void refresh();
    const onTabUpdated = (_id: number, info: TabChangeInfo) => {
      if (info.status === 'complete') void refresh();
    };

    chrome.runtime.onMessage.addListener(onMessage);
    chrome.tabs.onActivated.addListener(onMessage);
    chrome.tabs.onUpdated.addListener(onTabUpdated);
    return () => {
      chrome.runtime.onMessage.removeListener(onMessage);
      chrome.tabs.onActivated.removeListener(onMessage);
      chrome.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }, [refresh]);

  return { current, videos, refresh };
}

function NoteRow({
  note,
  onSeek,
  onDelete,
}: {
  note: Note;
  onSeek: () => void;
  onDelete: () => void;
}) {
  return (
    <Item
      className="cursor-pointer rounded-none border-b border-border hover:bg-muted/60"
      onClick={onSeek}
    >
      <ItemMedia>
        <Badge variant="secondary" className="tabular-nums">
          {fmtTime(note.t)}
        </Badge>
      </ItemMedia>
      <ItemContent className="whitespace-pre-wrap break-words">
        {note.text}
      </ItemContent>
      <ItemActions>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Delete note"
          className="opacity-0 transition-opacity group-hover/item:opacity-100 focus-visible:opacity-100"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <TrashIcon />
        </Button>
      </ItemActions>
    </Item>
  );
}

function CurrentView({
  current,
  refresh,
}: {
  current: CurrentVideo;
  refresh: () => Promise<void>;
}) {
  const { state, notes } = current;

  if (!notes.length) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            {state?.hasVideo ? <ClapperboardIcon /> : <VideoOffIcon />}
          </EmptyMedia>
          <EmptyTitle>
            {state?.hasVideo ? 'No notes yet' : 'No video detected'}
          </EmptyTitle>
          <EmptyDescription>
            {state?.hasVideo ? (
              <>
                Press{' '}
                {SHORTCUT_KEYS.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}{' '}
                while watching to drop a note at the current frame.
              </>
            ) : state?.adapter === 'drive' ? (
              // Drive's preview overlay has no file id in the URL and opens
              // without a navigation, so only the file's own page is supported.
              'Previews on Drive aren’t supported yet — open the video’s own file link (drive.google.com/file/d/…) and the panel will pick it up.'
            ) : (
              'Open a YouTube, Loom, X, LinkedIn, or Google Drive video — or any page with a video — and the panel will pick it up.'
            )}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea className="h-full">
      {notes.map((note) => (
        <NoteRow
          key={note.id}
          note={note}
          onSeek={async () => {
            const tabId = await activeTabId();
            if (tabId !== null) await sendToPage(tabId, 'page:seek', { t: note.t });
          }}
          onDelete={async () => {
            if (!state) return;
            await sendToBackground('notes:delete', { key: state.key, id: note.id });
            await refresh();
          }}
        />
      ))}
    </ScrollArea>
  );
}

function LibraryView({ videos }: { videos: VideoMeta[] }) {
  if (!videos.length) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing saved yet</EmptyTitle>
          <EmptyDescription>Notes you take will collect here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ScrollArea className="h-full">
      {videos.map((video) => (
        <Item
          key={video.key}
          className="cursor-pointer rounded-none border-b border-border hover:bg-muted/60"
          onClick={() => chrome.tabs.create({ url: video.url })}
        >
          <ItemContent>
            <span className="truncate font-medium">{video.title || video.url}</span>
            <span className="text-xs text-muted-foreground">
              {video.count} note{video.count === 1 ? '' : 's'} ·{' '}
              {fmtRelative(video.updatedAt)}
            </span>
          </ItemContent>
        </Item>
      ))}
    </ScrollArea>
  );
}

export function Panel() {
  const [view, setView] = React.useState<View>('current');
  const [format, setFormat] = React.useState<ExportFormat>('slack');
  const [copied, setCopied] = React.useState(false);
  const { current, videos, refresh } = usePanelData(view);

  const { state, meta, notes } = current;

  const subtitle = React.useMemo(() => {
    if (view === 'library') {
      return `${videos.length} video${videos.length === 1 ? '' : 's'} with notes`;
    }
    if (notes.length) {
      const suffix = state?.adapterLabel ? ` · ${state.adapterLabel}` : '';
      return `${notes.length} note${notes.length === 1 ? '' : 's'}${suffix}`;
    }
    return state?.hasVideo
      ? `${state.adapterLabel} · no notes yet`
      : 'No video on this page';
  }, [view, videos.length, notes.length, state]);

  async function copyExport() {
    if (!notes.length) return;
    await navigator.clipboard.writeText(
      renderExport(format, meta ?? state, notes)
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  const showFooter = view === 'current' && notes.length > 0;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex-none border-b border-border px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <h1 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {view === 'library' ? 'Library' : meta?.title || state?.title || 'Frame Notes'}
          </h1>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setView(view === 'library' ? 'current' : 'library')}
          >
            {view === 'library' ? 'Back' : 'Library'}
          </Button>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      </header>

      <main className="min-h-0 flex-1">
        {view === 'library' ? (
          <LibraryView videos={videos} />
        ) : (
          <CurrentView current={current} refresh={refresh} />
        )}
      </main>

      {showFooter && (
        <footer className="flex flex-none items-center gap-2 border-t border-border bg-muted/40 px-3.5 py-2.5">
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[format]}
            // Base UI hands back an array; ignore the empty one so clicking the
            // active option can't leave the export with no format at all.
            onValueChange={(value) => {
              const next = value[0] as ExportFormat | undefined;
              if (next) setFormat(next);
            }}
          >
            <ToggleGroupItem value="slack">Slack</ToggleGroupItem>
            <ToggleGroupItem value="markdown">Markdown</ToggleGroupItem>
          </ToggleGroup>

          <Button className="flex-1" onClick={copyExport} disabled={copied}>
            {copied
              ? `Copied ${notes.length} note${notes.length === 1 ? '' : 's'}`
              : 'Copy feedback'}
          </Button>
        </footer>
      )}
    </div>
  );
}
