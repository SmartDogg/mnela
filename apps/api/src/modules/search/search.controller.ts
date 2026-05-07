import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { SearchResult } from '@mnela/search';

import { RequiredScope } from '../../auth/scope.decorator.js';
import { SearchDto } from './dto.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

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
  @RequiredScope('mcp')
  @ApiOperation({ summary: 'Ask Brain (SSE; Phase 5/8 — currently unavailable)' })
  ask(): never {
    throw new ServiceUnavailableException({
      title: 'AI Smart Mode disabled',
      message: 'Server-side Claude Code lands in Phase 5/8',
    });
  }
}
