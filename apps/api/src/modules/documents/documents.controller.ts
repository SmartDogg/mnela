import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  ServiceUnavailableException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { DocumentsService } from './documents.service.js';
import { ListDocumentsQuery, RelatedQuery, UpdateDocumentDto } from './dto.js';

@ApiTags('documents')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('documents')
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List documents with optional filters and pagination' })
  list(@Query() query: ListDocumentsQuery) {
    return this.documents.list(
      {
        status: query.status,
        source: query.source,
        type: query.type,
        projectSlug: query.projectSlug,
        q: query.q,
        archived: query.archived,
      },
      query.page,
      query.limit,
    );
  }

  @Get(':id')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Fetch a single document by id' })
  findOne(@Param('id') id: string) {
    return this.documents.findById(id);
  }

  @Post('upload')
  @RequiredScope('mcp')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 100 * 1024 * 1024 } }))
  @Audit({ action: 'document.upload', targetType: 'Job' })
  @ApiOperation({
    summary:
      'Upload any supported file. Returns a Job; the worker parses asynchronously. Subscribe to /live for progress or poll /jobs/:id.',
  })
  upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException('Missing file field "file"');
    }
    return this.documents.upload({
      buffer: file.buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Patch(':id')
  @RequiredScope('mcp')
  @Audit({ action: 'document.update', targetType: 'Document', targetIdParam: 'id' })
  @ApiOperation({ summary: 'Update document metadata, projects, or archive flag' })
  update(@Param('id') id: string, @Body() body: UpdateDocumentDto) {
    return this.documents.update(id, body);
  }

  @Delete(':id')
  @RequiredScope('admin')
  @Audit({ action: 'document.delete', targetType: 'Document', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hard-delete a document (cascades chunks and document/entity links)' })
  remove(@Param('id') id: string) {
    return this.documents.delete(id);
  }

  @Get(':id/chunks')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List the document chunks (empty until Phase 2 chunker lands)' })
  chunks(@Param('id') id: string) {
    return this.documents.getChunks(id);
  }

  @Get(':id/related')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Find documents with similar titles (trigram similarity)' })
  related(@Param('id') id: string, @Query() query: RelatedQuery) {
    return this.documents.findRelated(id, query.limit ?? 10);
  }

  @Post(':id/reenrich')
  @RequiredScope('admin')
  @ApiOperation({ summary: 'Re-run enrichment via Claude Code (Phase 5; currently unavailable)' })
  reenrich(@Param('id') _id: string): never {
    throw new ServiceUnavailableException({
      title: 'AI Smart Mode disabled',
      message: 'Claude Code orchestrator lands in Phase 5',
    });
  }

  @Post(':id/retranscribe')
  @RequiredScope('mcp')
  @Audit({ action: 'document.retranscribe', targetType: 'Document', targetIdParam: 'id' })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Re-enqueue audio transcription via whisper.cpp (requires MNELA_TRANSCRIPTION=enabled)',
  })
  retranscribe(@Param('id') id: string) {
    return this.documents.retranscribe(id);
  }

  @Get(':id/attachment')
  @RequiredScope('read_only')
  @ApiOperation({
    summary:
      'Stream the document attachment (audio/image binary) with Range support (206 Partial Content)',
  })
  async attachment(
    @Param('id') id: string,
    @Headers('range') range: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.documents.streamAttachment(id, range ? { range } : {});
    res.status(result.status);
    for (const [key, value] of Object.entries(result.headers)) {
      res.setHeader(key, value);
    }
    if (!result.stream) {
      res.end();
      return;
    }
    result.stream.on('error', (err) => {
      // Stream errors after headers were sent — just terminate. NestJS error
      // filters can't intercept a half-written response anyway.
      res.destroy(err);
    });
    result.stream.pipe(res);
  }
}
