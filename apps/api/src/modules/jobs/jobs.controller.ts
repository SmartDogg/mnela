import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { ListJobsQuery } from './dto.js';
import { JobsService } from './jobs.service.js';

@ApiTags('jobs')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get('stats')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Aggregate job counts by status' })
  stats() {
    return this.jobs.stats();
  }

  @Get()
  @RequiredScope('read_only')
  list(@Query() query: ListJobsQuery) {
    return this.jobs.list({ status: query.status, type: query.type }, query.page, query.limit);
  }

  @Get(':id')
  @RequiredScope('read_only')
  findOne(@Param('id') id: string) {
    return this.jobs.findById(id);
  }

  @Post(':id/cancel')
  @RequiredScope('mcp')
  @Audit({ action: 'job.cancel', targetType: 'Job', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string) {
    return this.jobs.cancel(id);
  }

  @Post(':id/retry')
  @RequiredScope('mcp')
  @Audit({ action: 'job.retry', targetType: 'Job', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  retry(@Param('id') id: string) {
    return this.jobs.retry(id);
  }
}
