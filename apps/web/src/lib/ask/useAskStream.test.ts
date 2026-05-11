import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAskStream } from './useAskStream';

const VALID_DOC = 'c' + 'a'.repeat(24);

function buildSseStream(blocks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('useAskStream', () => {
  it('processes a meta + token + done sequence', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: buildSseStream([
        `event: meta\ndata: ${JSON.stringify({
          conversationId: 'conv1',
          userMessageId: 'u1',
          assistantMessageId: 'a1',
          dumbMode: false,
        })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ delta: 'Hello' })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ delta: ' world' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          conversationId: 'conv1',
          messageId: 'a1',
          durationMs: 12,
          citationsTotal: 0,
          totalTokensIn: null,
          totalTokensOut: null,
          dumbMode: false,
        })}\n\n`,
      ]),
    });

    const { result } = renderHook(() => useAskStream());
    await act(async () => {
      await result.current.send('hi');
    });

    expect(result.current.status).toBe('done');
    expect(result.current.conversationId).toBe('conv1');
    expect(result.current.messages).toEqual([
      expect.objectContaining({ role: 'user', contentMd: 'hi' }),
      expect.objectContaining({ id: 'a1', role: 'assistant', contentMd: 'Hello world' }),
    ]);
    expect(result.current.error).toBeNull();
  });

  it('records citations and dumb mode flag', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: buildSseStream([
        `event: meta\ndata: ${JSON.stringify({
          conversationId: 'conv2',
          userMessageId: 'u2',
          assistantMessageId: 'a2',
          dumbMode: true,
        })}\n\n`,
        `event: token\ndata: ${JSON.stringify({ delta: 'see [1]' })}\n\n`,
        `event: citation\ndata: ${JSON.stringify({ ord: 1, docId: VALID_DOC, title: 'Doc', snippet: 'snip' })}\n\n`,
        `event: done\ndata: ${JSON.stringify({
          conversationId: 'conv2',
          messageId: 'a2',
          durationMs: 5,
          citationsTotal: 1,
          totalTokensIn: null,
          totalTokensOut: null,
          dumbMode: true,
        })}\n\n`,
      ]),
    });

    const { result } = renderHook(() => useAskStream());
    await act(async () => {
      await result.current.send('q');
    });

    const assistant = result.current.messages.find((m) => m.role === 'assistant')!;
    expect(assistant.dumbMode).toBe(true);
    expect(assistant.citations).toEqual([
      { ord: 1, docId: VALID_DOC, title: 'Doc', snippet: 'snip' },
    ]);
  });

  it('captures error frames', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      body: buildSseStream([
        `event: meta\ndata: ${JSON.stringify({
          conversationId: 'conv3',
          userMessageId: 'u3',
          assistantMessageId: 'a3',
          dumbMode: false,
        })}\n\n`,
        `event: error\ndata: ${JSON.stringify({ reason: 'rate-limit', resetAt: '2026-05-11T20:00:00Z' })}\n\n`,
      ]),
    });

    const { result } = renderHook(() => useAskStream());
    await act(async () => {
      await result.current.send('q');
    });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toEqual({
      reason: 'rate-limit',
      resetAt: '2026-05-11T20:00:00Z',
    });
  });

  it('handles fetch failure with generic error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, body: null });
    const { result } = renderHook(() => useAskStream());
    await act(async () => {
      await result.current.send('q');
    });
    expect(result.current.status).toBe('error');
    expect(result.current.error?.reason).toBe('generic');
  });
});
