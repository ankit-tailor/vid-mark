export type AdapterId =
  | 'youtube'
  | 'loom'
  | 'twitter'
  | 'linkedin'
  | 'generic';

export interface Note {
  id: string;
  /** Playback position in seconds. Fractional — formatted on display. */
  t: number;
  text: string;
  /** Absolute URL that opens the video at `t`. Baked at capture time. */
  link: string;
  createdAt: number;
}

export interface VideoMeta {
  key: string;
  title: string;
  url: string;
  adapter: AdapterId;
  duration: number | null;
  count: number;
  updatedAt: number;
}

export interface PageState {
  hasVideo: boolean;
  adapter: AdapterId;
  adapterLabel: string;
  key: string;
  title: string;
  url: string;
  duration: number | null;
  currentTime: number;
}

export type NoteDraft = Pick<Note, 't' | 'text' | 'link'>;
export type NoteMeta = Pick<VideoMeta, 'title' | 'url' | 'adapter' | 'duration'>;
