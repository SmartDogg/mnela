import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { SearchResult } from '@mnela/search';

import { CurrentPrincipal } from '../../auth/principal.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import type { Principal } from '../../auth/types.js';
import { AskService } from './ask.service.js';
import { AskDto, SaveSynthesisDto, SearchDto } from './dto.js';
import { SaveSynthesisService } from './save-synthesis.service.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly ask: AskService,
    private readonly synthesis: SaveSynthesisService,
  ) {}

  @Post()
  @RequiredScope('read_only')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Search documents using fts, fuzzy (trigram), or hybrid mode',
  })
  run(@Body() body: SearchDto): Promise<SearchResult> {
    return this.search.search({
      query: body.query,
      mode: body.mode,
      filters: body.filters,
      page: body.page,
      limit: body.limit,
    });
  }

  @Post('ask')
  @RequiredScope('read_only')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Ask Brain — Server-Sent Events stream (text/event-stream). Falls back to FTS-only Dumb Mode if Claude is unavailable.',
  })
  async askEndpoint(
    @Body() body: AskDto,
    @CurrentPrincipal() principal: Principal | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    res.status(HttpStatus.OK);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const ac = new AbortController();
    const onClose = (): void => ac.abort();
    req.on('close', onClose);

    const input = {
      query: body.query,
      forceMode: body.mode,
      principal,
      abort: ac.signal,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
    } as const;

    try {
      for await (const frame of this.ask.streamAsk(input)) {
        const payload = `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`;
        if (res.writableEnded) break;
        res.write(payload);
        (res as Response & { flush?: () => void }).flush?.();
      }
    } catch (err) {
      if (!res.writableEnded) {
        const message = err instanceof Error ? err.message : String(err);
        res.write(`event: error\ndata: ${JSON.stringify({ reason: 'generic', message })}\n\n`);
      }
    } finally {
      req.off('close', onClose);
      if (!res.writableEnded) res.end();
    }
  }

  @Post('ask/save')
  @RequiredScope('read_only')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Save an Ask Brain assistant message as a synthesis Document' })
  saveSynthesis(
    @Body() body: SaveSynthesisDto,
    @CurrentPrincipal() principal: Principal | undefined,
  ): Promise<{ documentId: string; conversationId: string }> {
    return this.synthesis.run({
      conversationId: body.conversationId,
      messageId: body.messageId,
      ...(body.title ? { title: body.title } : {}),
      principal,
    });
  }
}
