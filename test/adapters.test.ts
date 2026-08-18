import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAdapter } from '../src/content/adapters.ts';

/**
 * Adapter URL logic.
 *
 * Deep links and identity keys fail silently — a wrong `?t=` just lands at 0:00,
 * and a forked key quietly splits one video's notes into two piles. Both are
 * pure URL math, so they are worth pinning down here.
 *
 * `adapters.ts` touches no DOM at import time, so stubbing the globals before
 * each call is enough; no browser environment is needed.
 */
function at(href: string, title = 'Some Title') {
  const url = new URL(href);
  Object.assign(globalThis, {
    location: {
      href,
      hostname: url.hostname,
      pathname: url.pathname,
      protocol: url.protocol,
      origin: url.origin,
    },
    document: {
      title,
      querySelector: () => null,
      querySelectorAll: () => [],
    },
  });
  const adapter = resolveAdapter();
  return {
    id: adapter.id,
    key: adapter.key(),
    link: adapter.deepLink(83.7),
    title: adapter.title(),
  };
}

test('routes each host to its adapter', () => {
  assert.equal(at('https://www.youtube.com/watch?v=abc').id, 'youtube');
  assert.equal(at('https://m.youtube.com/watch?v=abc').id, 'youtube');
  assert.equal(at('https://youtu.be/abc').id, 'youtube');
  assert.equal(at('https://www.loom.com/share/0123456789abcdef').id, 'loom');
  assert.equal(at('https://x.com/jack/status/20').id, 'twitter');
  assert.equal(at('https://twitter.com/jack/status/20').id, 'twitter');
  assert.equal(at('https://www.linkedin.com/feed/').id, 'linkedin');
  assert.equal(at('https://app.example.com/clips/42').id, 'generic');
  assert.equal(at('file:///Users/a/Movies/demo.mp4').id, 'generic');
});

test('x.com and twitter.com are one post, not two', () => {
  const keys = [
    'https://x.com/jack/status/20',
    'https://twitter.com/jack/status/20',
    'https://x.com/i/status/20',
    'https://x.com/jack/status/20?s=46&t=trackingjunk',
  ].map((href) => at(href).key);

  assert.equal(new Set(keys).size, 1, `keys diverged: ${keys.join(', ')}`);
  assert.equal(keys[0], 'twitter:20');
});

test('linkedin keys off the activity urn in any URL shape', () => {
  const keys = [
    'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/',
    // The address bar percent-encodes the urn more often than not.
    'https://www.linkedin.com/feed/update/urn%3Ali%3Aactivity%3A7123456789012345678/',
    'https://www.linkedin.com/posts/priya-raman_q3-demo-activity-7123456789012345678-Ab1c',
  ].map((href) => at(href).key);

  assert.equal(new Set(keys).size, 1, `keys diverged: ${keys.join(', ')}`);
  assert.equal(keys[0], 'linkedin:7123456789012345678');
});

test('one video keeps one key across every URL shape', () => {
  const keys = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=4',
    'https://youtu.be/dQw4w9WgXcQ?si=trackingjunk',
    'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
  ].map((href) => at(href).key);

  assert.equal(new Set(keys).size, 1, `keys diverged: ${keys.join(', ')}`);
  assert.equal(keys[0], 'youtube:dQw4w9WgXcQ');
});

test('query noise does not fork generic identity', () => {
  const keys = [
    'https://app.example.com/clips/42?ref=slack',
    'https://app.example.com/clips/42?utm_source=x&t=99',
  ].map((href) => at(href).key);

  assert.equal(new Set(keys).size, 1, `keys diverged: ${keys.join(', ')}`);
});

test('every adapter puts the timestamp in its deep link', () => {
  const cases = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
    'https://www.youtube.com/shorts/abc123XYZ_-',
    'https://www.loom.com/share/0123456789abcdef0123456789abcdef',
    'https://app.example.com/clips/42?ref=slack',
    'file:///Users/a/Movies/team%20demo.mp4',
  ];
  for (const href of cases) {
    assert.match(at(href).link, /83/, `no timestamp in deep link for ${href}`);
  }
});

test('deep links use each site’s own timestamp format', () => {
  assert.equal(
    at('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1').link,
    'https://youtu.be/dQw4w9WgXcQ?t=83'
  );
  assert.equal(
    at('https://www.loom.com/embed/0123456789abcdef0123456789abcdef').link,
    'https://www.loom.com/share/0123456789abcdef0123456789abcdef?t=83'
  );
  // Generic falls back to a media fragment, which Chrome honours natively.
  assert.equal(
    at('https://app.example.com/clips/42').link,
    'https://app.example.com/clips/42#t=83'
  );
  // X and LinkedIn have no timestamp parameter at all, so the fragment is
  // inert — the link opens the post, and the note text carries the time.
  assert.equal(
    at('https://twitter.com/jack/status/20').link,
    'https://x.com/i/status/20#t=83'
  );
  assert.equal(
    at('https://www.linkedin.com/posts/priya_demo-activity-7123456789012345678-Ab1c')
      .link,
    'https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/#t=83'
  );
});

test('file paths survive percent-encoding in both key and link', () => {
  const r = at('file:///Users/a/Movies/team%20demo.mp4');
  assert.equal(r.key, 'file:/Users/a/Movies/team demo.mp4');
  assert.equal(r.link, 'file:///Users/a/Movies/team%20demo.mp4#t=83');
});

test('titles drop site suffixes', () => {
  assert.equal(at('https://youtu.be/abc', 'Q3 Demo - YouTube').title, 'Q3 Demo');
  assert.equal(
    at('https://www.loom.com/share/0123456789abcdef', 'Q3 Demo | Loom').title,
    'Q3 Demo'
  );
  assert.equal(
    at('https://www.linkedin.com/feed/', 'Q3 Demo | LinkedIn').title,
    'Q3 Demo'
  );
  // No tweetText element in this stub, so it falls back to the page title.
  assert.equal(
    at('https://x.com/jack/status/20', 'jack on X: "just setting up my twttr" / X')
      .title,
    'jack on X: "just setting up my twttr"'
  );
});
