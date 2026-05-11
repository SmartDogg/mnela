/**
 * Sanitize a server-emitted FTS snippet whose only allowed markup is `<mark>`
 * (ts_headline 'StartSel=<mark>,StopSel=</mark>'). Everything else is stripped
 * so a hostile document body cannot inject script via the snippet path.
 *
 * Hand-rolled (no isomorphic-dompurify) because that pulls in jsdom on the
 * server, and Next.js webpack mangles jsdom's default-stylesheet.css path so
 * any page that imports this module crashes during SSR with ENOENT.
 */
export function sanitizeHighlight(html: string): string {
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  out = out.replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g, (_m, slash: string, tag: string) =>
    tag.toLowerCase() === 'mark' ? `<${slash}mark>` : '',
  );
  return out;
}
