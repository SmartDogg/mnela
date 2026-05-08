import { describe, expect, it } from 'vitest';

import { parseFrame, parseSingleJson, parseStream } from '../parse-frames.js';

describe('parseFrame', () => {
  it('parses a typed frame', () => {
    const f = parseFrame('{"type":"result","session_id":"s1","result":"hi"}');
    expect(f).toEqual({ type: 'result', session_id: 's1', result: 'hi' });
  });

  it('returns null for non-JSON', () => {
    expect(parseFrame('not json')).toBeNull();
    expect(parseFrame('  ')).toBeNull();
  });

  it('returns null when type field is missing', () => {
    expect(parseFrame('{"foo":"bar"}')).toBeNull();
  });
});

describe('parseStream', () => {
  it('extracts frames across CRLF and LF, skipping garbage', () => {
    const out = [
      '{"type":"system","subtype":"init"}',
      'random log line',
      '{"type":"stream_event","event":{}}',
      '',
      '{"type":"result","session_id":"x","result":"done"}',
    ].join('\r\n');
    const frames = parseStream(out);
    expect(frames.map((f) => f.type)).toEqual(['system', 'stream_event', 'result']);
  });
});

describe('parseSingleJson', () => {
  it('wraps a plain JSON object as a single result-typed frame', () => {
    const frames = parseSingleJson('{"session_id":"s","result":"ok"}');
    expect(frames).toHaveLength(1);
    expect(frames[0]?.type).toBe('result');
  });

  it('preserves the type field if present', () => {
    const frames = parseSingleJson('{"type":"result","result":"ok"}');
    expect(frames[0]?.type).toBe('result');
  });

  it('returns empty array for malformed input', () => {
    expect(parseSingleJson('')).toEqual([]);
    expect(parseSingleJson('not json')).toEqual([]);
  });
});
