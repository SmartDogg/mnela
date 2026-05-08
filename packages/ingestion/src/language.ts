/**
 * Cheap language hint based on the cyrillic-to-latin character ratio.
 * Returns 'ru' if cyrillic dominates, 'en' if latin dominates, 'mixed' otherwise.
 *
 * Used as a hint for FTS bilingual upgrade (ADR-0011 follow-up).
 * Empty input returns null — caller decides whether to default.
 */
export function detectLanguage(text: string): 'ru' | 'en' | 'mixed' | null {
  if (!text) return null;
  let cyr = 0;
  let lat = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if ((code >= 0x0400 && code <= 0x04ff) || (code >= 0x0500 && code <= 0x052f)) {
      cyr += 1;
    } else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
      lat += 1;
    }
  }
  const total = cyr + lat;
  if (total === 0) return null;
  const cyrRatio = cyr / total;
  if (cyrRatio >= 0.8) return 'ru';
  if (cyrRatio <= 0.2) return 'en';
  return 'mixed';
}
