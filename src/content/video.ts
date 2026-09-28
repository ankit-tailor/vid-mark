import { sendToBackground, type VideoOp } from '@/lib/messaging';
import type { VideoState } from '@/lib/types';
import type { Adapter } from './adapters';

/**
 * The video the top frame is annotating, wherever it actually plays.
 *
 * Usually that is a <video> in this document. On Drive it is in a cross-origin
 * player frame, reachable only by message, so every operation is async and any
 * of them can come back null if the frame has gone away underneath us.
 */
export interface VideoHandle {
  pause(): Promise<VideoState | null>;
  play(): Promise<void>;
  seek(t: number): Promise<void>;
  /** Bring the player into view. A no-op when it lives in another frame. */
  reveal(): void;
}

export function snapshot(v: HTMLVideoElement): VideoState {
  return {
    currentTime: v.currentTime,
    duration: isFinite(v.duration) ? v.duration : null,
    paused: v.paused,
  };
}

function local(v: HTMLVideoElement): VideoHandle {
  return {
    pause: async () => {
      v.pause();
      return snapshot(v);
    },
    play: () => v.play().catch(() => {}),
    seek: async (t) => {
      v.currentTime = t;
    },
    reveal: () => v.scrollIntoView({ block: 'center', behavior: 'smooth' }),
  };
}

function frameCall(op: VideoOp, t?: number): Promise<VideoState | null> {
  return sendToBackground('frame:video', { op, t }).catch(() => null);
}

const remote: VideoHandle = {
  pause: () => frameCall('pause'),
  play: async () => {
    await frameCall('play');
  },
  seek: async (t) => {
    await frameCall('seek', t);
  },
  reveal: () => {},
};

/** The video plus its state at the moment it was found, or null for none. */
export async function findVideo(
  adapter: Adapter
): Promise<{ video: VideoHandle; state: VideoState } | null> {
  const el = adapter.findVideo();
  if (el) return { video: local(el), state: snapshot(el) };
  if (!adapter.remote) return null;

  const state = await frameCall('state');
  return state ? { video: remote, state } : null;
}
