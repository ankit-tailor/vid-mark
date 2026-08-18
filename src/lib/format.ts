import type { Note, VideoMeta } from './types';

export type ExportFormat = 'slack' | 'markdown';

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`;
}

export function fmtRelative(ts: number): string {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

type ExportSource = Pick<VideoMeta, 'title' | 'url'> | null;

/**
 * Slack does not render markdown link syntax on paste, but it does auto-link
 * bare URLs — so the URL goes in raw and notes collapse to one line each.
 */
function toSlack(meta: ExportSource, notes: Note[]): string {
  const lines = [`Feedback on "${meta?.title || 'video'}"`];
  if (meta?.url) lines.push(meta.url);
  lines.push('');
  for (const n of notes) {
    lines.push(`• ${fmtTime(n.t)} — ${n.text.replace(/\n+/g, ' ')} → ${n.link}`);
  }
  return lines.join('\n');
}

/** GitHub / Notion / Obsidian flavour — keeps multi-line notes intact. */
function toMarkdown(meta: ExportSource, notes: Note[]): string {
  const lines = [`# Feedback — ${meta?.title || 'video'}`, ''];
  if (meta?.url) lines.push(`Source: ${meta.url}`, '');
  for (const n of notes) {
    const body = n.text.split('\n').join('\n  ');
    lines.push(`- **[${fmtTime(n.t)}](${n.link})** — ${body}`);
  }
  return lines.join('\n');
}

export function renderExport(
  format: ExportFormat,
  meta: ExportSource,
  notes: Note[]
): string {
  return format === 'slack' ? toSlack(meta, notes) : toMarkdown(meta, notes);
}
