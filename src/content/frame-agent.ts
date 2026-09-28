import type { FrameRequest } from '@/lib/messaging';
import { sendToBackground } from '@/lib/messaging';
import type { VideoState } from '@/lib/types';
import { snapshot } from './video';

/**
 * Frame agent: runs inside Drive's video player frame.
 *
 * Drive plays video in a youtube.googleapis.com embed, which is cross-origin to
 * the Drive page, so the top-frame content script can neither see the <video>
 * nor reach into the frame. This script has no UI. It only answers the
 * worker-relayed `frame:video` ops, and forwards the shortcut when the player
 * has focus.
 *
 * The manifest matches every youtube.googleapis.com embed, and the worker
 * injects this into every frame of tabs that predate the extension, so it
 * checks it is really inside Drive before doing anything.
 */

const params = new URL(location.href).searchParams;
const inDrive =
  location.hostname === 'youtube.googleapis.com' &&
  params.get('ps') === 'docs' &&
  params.get('post_message_origin') === 'https://drive.google.com';

function video(): HTMLVideoElement | null {
  return (
    document.querySelector<HTMLVideoElement>('video.html5-main-video') ??
    document.querySelector('video')
  );
}

async function run(msg: FrameRequest): Promise<VideoState | null> {
  const v = video();
  if (!v) return null;
  switch (msg.op) {
    case 'pause':
      v.pause();
      break;
    case 'play':
      await v.play().catch(() => {});
      break;
    case 'seek':
      if (typeof msg.t === 'number') v.currentTime = msg.t;
      break;
  }
  return snapshot(v);
}

if (inDrive) {
  chrome.runtime.onMessage.addListener((msg: FrameRequest, _sender, respond) => {
    if (msg?.type !== 'frame:video') return false;
    run(msg).then(respond, () => respond(null));
    return true; // async respond
  });

  // Clicking the player moves keyboard focus into this frame, and the top
  // frame's own chord listener never sees keys pressed here.
  window.addEventListener(
    'keydown',
    (e) => {
      if (!e.shiftKey || !(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.code !== 'KeyK' && e.key.toLowerCase() !== 'k') return;
      e.preventDefault();
      e.stopPropagation();
      void sendToBackground('frame:compose', {}).catch(() => {});
    },
    true
  );
}
