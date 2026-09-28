import { defineManifest } from '@crxjs/vite-plugin';
import pkg from '../package.json' with { type: 'json' };

export default defineManifest({
  manifest_version: 3,
  name: 'Frame Notes',
  version: pkg.version,
  description:
    'Timestamped feedback on any video in your browser. Press Cmd+Shift+K to drop a note at the current frame.',
  minimum_chrome_version: '116',

  // `scripting` is for one job: injecting the content script into tabs that
  // were already open when the extension loaded, so the shortcut works there.
  permissions: ['storage', 'unlimitedStorage', 'tabs', 'sidePanel', 'scripting'],
  host_permissions: ['<all_urls>'],

  // The composer's stylesheet lives in the shadow root as a string, but the
  // fonts it references are still fetched by the page and must be reachable.
  web_accessible_resources: [
    { resources: ['assets/*'], matches: ['<all_urls>'] },
  ],

  background: {
    service_worker: 'src/background/worker.ts',
    type: 'module',
  },

  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },

  action: {
    default_title: 'Frame Notes — open review panel',
  },

  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.tsx'],
      run_at: 'document_idle',
      all_frames: false,
    },
    // Drive's video player is a cross-origin youtube.googleapis.com frame the
    // script above cannot reach. This one runs inside it and answers for the
    // video by message; it checks it is inside Drive before doing anything.
    // The worker relies on this staying the second entry.
    {
      matches: ['https://youtube.googleapis.com/embed/*'],
      js: ['src/content/frame-agent.ts'],
      run_at: 'document_idle',
      all_frames: true,
    },
  ],

  commands: {
    'add-note': {
      suggested_key: { default: 'Ctrl+Shift+K', mac: 'Command+Shift+K' },
      description: 'Add a note at the current timestamp',
    },
  },
});
