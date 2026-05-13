import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import type { SearchResult } from '@mnela/search';

import { CurrentPrincipal } from '../../auth/principal.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import type { Principal } from '../../auth/types.js';
import { MULTER_RAW_CEILING_BYTES, incomingUploadStorage } from '../imports/upload.config.js';
import { AskAttachmentsService } from './ask-attachments.service.js';
import { AskService } from './ask.service.js';
import { AskDto, SaveSynthesisDto, SearchDto } from './dto.js';
import { SaveSynthesisService } from './save-synthesis.service.js';
import { SearchService } from './search.service.js';

function principalOwnerKey(principal: Principal | undefined): string {
  return principal ? `${principal.kind}:${principal.id}` : 'anonymous';
}

@ApiTags('search')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly ask: AskService,
    private readonly synthesis: SaveSynthesisService,
    private readonly askAttachments: AskAttachmentsService,
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
      kind: body.kind,
      principal,
      abort: ac.signal,
      ...(body.conversationId ? { conversationId: body.conversationId } : {}),
      ...(body.attachmentIds && body.attachmentIds.length > 0
        ? { attachmentIds: body.attachmentIds }
        : {}),
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

  @Post('ask/attachments')
  @RequiredScope('mcp')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: incomingUploadStorage,
      limits: { fileSize: MULTER_RAW_CEILING_BYTES },
    }),
  )
  @ApiOperation({
    summary:
      'Stage a single file for the next /ask call. Returns an attachment id the composer threads through `attachmentIds`. Files are deleted on use (chat mode) or moved into the ingestion pipeline (ingest mode).',
  })
  async uploadAttachment(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentPrincipal() principal: Principal | undefined,
  ): Promise<{ id: string; filename: string; mimeType: string; size: number }> {
    if (!file) throw new BadRequestException('Missing multipart field "file"');
    const owner = principalOwnerKey(principal);
    const record = await this.askAttachments.stage(
      {
        path: file.path,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      },
      owner,
    );
    return {
      id: record.id,
      filename: record.filename,
      mimeType: record.mimeType,
      size: record.size,
    };
  }

  @Delete('ask/attachments/:id')
  @RequiredScope('mcp')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Drop a staged /ask attachment before submitting. No-op when the id is unknown.',
  })
  async releaseAttachment(
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal | undefined,
  ): Promise<void> {
    await this.askAttachments.release(id, principalOwnerKey(principal));
  }

  @Get('pinned-by-day')
  @RequiredScope('read_only')
  @ApiOperation({
    summary:
      'Memory sidebar in /ask: groups pinned chat Q&A + migrated daily notes by the day they landed.',
  })
  pinnedByDay() {
    return this.ask.getPinnedByDay();
  }
}
