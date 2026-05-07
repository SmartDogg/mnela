import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { DailyService } from './daily.service.js';
import { ListDailyQuery, UpsertDailyDto, parseDateOnly } from './dto.js';

@ApiTags('daily')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('daily')
export class DailyController {
  constructor(private readonly daily: DailyService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List daily notes within an optional date range' })
  list(@Query() query: ListDailyQuery) {
    return this.daily.list(
      query.from ? parseDateOnly(query.from) : undefined,
      query.to ? parseDateOnly(query.to) : undefined,
    );
  }

  @Get(':date')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'Fetch the daily note for a date (YYYY-MM-DD)' })
  findOne(@Param('date') date: string) {
    return this.daily.findByDate(parseDateOnly(date));
  }

  @Put(':date')
  @RequiredScope('mcp')
  @Audit({ action: 'daily.upsert', targetType: 'DailyNote', targetIdParam: 'date' })
  @ApiOperation({ summary: 'Create or update the daily note for a date' })
  upsert(@Param('date') date: string, @Body() body: UpsertDailyDto) {
    return this.daily.upsert(parseDateOnly(date), body.contentMd, body.mood);
  }
}
