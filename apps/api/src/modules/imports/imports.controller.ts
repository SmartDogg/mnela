import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { ImportsService } from './imports.service.js';
import { MULTER_RAW_CEILING_BYTES, incomingUploadStorage } from './upload.config.js';

const PaginationSchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

class PaginationQuery extends createZodDto(PaginationSchema) {}

@ApiTags('imports')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List import jobs' })
  list(@Query() query: PaginationQuery) {
    return this.imports.list(query.page, query.limit);
  }

  @Get(':id')
  @RequiredScope('read_only')
  findOne(@Param('id') id: string) {
    return this.imports.findOne(id);
  }

  @Get(':id/documents')
  @RequiredScope('read_only')
  @ApiOperation({
    summary:
      'List documents produced by this import job (matched via Document.metadata.__import.jobId)',
  })
  listDocuments(@Param('id') id: string) {
    return this.imports.listDocuments(id);
  }

  @Post()
  @RequiredScope('mcp')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: incomingUploadStorage,
      limits: { fileSize: MULTER_RAW_CEILING_BYTES },
    }),
  )
  @Audit({ action: 'import.create', targetType: 'Job' })
  @ApiOperation({
    summary:
      'Upload an export ZIP/file. The body is streamed to disk; ImportsService enforces SystemConfig `imports.maxBytes`.',
  })
  upload(@UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) throw new BadRequestException('Missing file field "file"');
    return this.imports.createFromUpload({
      path: file.path,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Post(':id/start')
  @RequiredScope('mcp')
  @Audit({ action: 'import.start', targetType: 'Job', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  start(@Param('id') id: string) {
    return this.imports.start(id);
  }

  @Post(':id/pause')
  @RequiredScope('mcp')
  @Audit({ action: 'import.pause', targetType: 'Job', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  pause(@Param('id') id: string) {
    return this.imports.pause(id);
  }

  @Post(':id/cancel')
  @RequiredScope('mcp')
  @Audit({ action: 'import.cancel', targetType: 'Job', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string) {
    return this.imports.cancel(id);
  }
}
