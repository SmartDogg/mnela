import DOMPurify from 'isomorphic-dompurify';

/**
 * Sanitize a server-emitted FTS snippet whose only allowed markup is `<mark>`
 * (ts_headline 'StartSel=<mark>,StopSel=</mark>'). Everything else is stripped
 * so a hostile document body cannot inject script via the snippet path.
 */
export function sanitizeHighlight(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['mark'],
    ALLOWED_ATTR: [],
  });
}
