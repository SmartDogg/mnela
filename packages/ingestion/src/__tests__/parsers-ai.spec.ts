import { describe, expect, it } from 'vitest';

import { type ParseContext } from '../parser.js';
import { chatgptParser } from '../parsers/chatgpt.js';
import { claudeCodeSessionParser } from '../parsers/claude-code-session.js';

const ctx = (overrides: Partial<ParseContext>): ParseContext => ({
  mimeType: 'application/json',
  extension: '.json',
  filename: 'sample.json',
  origin: 'manual_upload',
  workdir: '/tmp',
  ...overrides,
});

describe('AI-export parsers', () => {
  describe('chatgpt — bare conversations.json', () => {
    it('renders one document per conversation with role headers', async () => {
      const conversations = [
        {
          id: 'conv-1',
          title: 'Greetings',
          create_time: 1_700_000_000,
          mapping: {
            n0: { id: 'n0', children: ['n1'] },
            n1: {
              id: 'n1',
              parent: 'n0',
              children: ['n2'],
              message: {
                id: 'm1',
                author: { role: 'user' },
                create_time: 1_700_000_010,
                content: { content_type: 'text', parts: ['Hello bot'] },
              },
            },
            n2: {
              id: 'n2',
              parent: 'n1',
              children: [],
              message: {
                id: 'm2',
                author: { role: 'assistant' },
                create_time: 1_700_000_020,
                content: { content_type: 'text', parts: ['Hello human'] },
              },
            },
          },
        },
      ];
      const buf = Buffer.from(JSON.stringify(conversations));
      const docs = await chatgptParser.parse(buf, ctx({ filename: 'conversations.json' }));
      expect(docs).toHaveLength(1);
      expect(docs[0]?.title).toBe('Greetings');
      expect(docs[0]?.source).toBe('chatgpt_export');
      expect(docs[0]?.rawText).toContain('## user');
      expect(docs[0]?.rawText).toContain('Hello bot');
      expect(docs[0]?.rawText).toContain('## assistant');
      expect(docs[0]?.rawText).toContain('Hello human');
    });

    it('skips system and tool messages', async () => {
      const conversations = [
        {
          id: 'c2',
          title: 't',
          mapping: {
            n0: { id: 'n0', children: ['n1', 'n2'] },
            n1: {
              id: 'n1',
              parent: 'n0',
              children: [],
              message: { author: { role: 'system' }, content: { parts: ['ignore me'] } },
            },
            n2: {
              id: 'n2',
              parent: 'n0',
              children: [],
              message: { author: { role: 'tool' }, content: { parts: ['skip too'] } },
            },
          },
        },
      ];
      const buf = Buffer.from(JSON.stringify(conversations));
      const docs = await chatgptParser.parse(buf, ctx({ filename: 'conversations.json' }));
      expect(docs[0]?.rawText).not.toContain('ignore me');
      expect(docs[0]?.rawText).not.toContain('skip too');
    });
  });

  describe('claude-code-session — JSONL transcript', () => {
    it('renders user+assistant lines and skips tool noise', async () => {
      const lines = [
        { type: 'system', sessionId: 'sess-abc', timestamp: '2026-05-08T10:00:00Z' },
        {
          type: 'user',
          sessionId: 'sess-abc',
          timestamp: '2026-05-08T10:00:01Z',
          message: { role: 'user', content: 'List files' },
        },
        {
          type: 'tool_use',
          sessionId: 'sess-abc',
          toolUse: { name: 'ls', input: { path: '.' } },
        },
        {
          type: 'assistant',
          sessionId: 'sess-abc',
          timestamp: '2026-05-08T10:00:05Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Here are the files.' },
              { type: 'tool_use', text: '' },
            ],
          },
        },
      ];
      const buf = Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n'));
      const docs = await claudeCodeSessionParser.parse(
        buf,
        ctx({ mimeType: 'application/x-ndjson', extension: '.jsonl', filename: 'sess-abc.jsonl' }),
      );
      expect(docs).toHaveLength(1);
      expect(docs[0]?.metadata?.['sessionId']).toBe('sess-abc');
      expect(docs[0]?.metadata?.['messageCount']).toBe(2);
      expect(docs[0]?.rawText).toContain('## user');
      expect(docs[0]?.rawText).toContain('List files');
      expect(docs[0]?.rawText).toContain('## assistant');
      expect(docs[0]?.rawText).toContain('Here are the files.');
    });

    it('returns empty when no user/assistant lines present', async () => {
      const buf = Buffer.from(JSON.stringify({ type: 'system', sessionId: 'x' }) + '\n');
      const docs = await claudeCodeSessionParser.parse(
        buf,
        ctx({ extension: '.jsonl', filename: 'x.jsonl' }),
      );
      expect(docs).toEqual([]);
    });
  });
});
