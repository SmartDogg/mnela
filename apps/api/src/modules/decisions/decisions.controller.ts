import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import { DecisionsService } from './decisions.service.js';
import { CreateDecisionDto, ListDecisionsQuery, UpdateDecisionDto } from './dto.js';

@ApiTags('decisions')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('decisions')
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List decisions, optionally filtered by project slug' })
  list(@Query() query: ListDecisionsQuery) {
    return this.decisions.list(
      { projectSlug: query.projectSlug, status: query.status },
      query.page,
      query.limit,
    );
  }

  @Post()
  @RequiredScope('mcp')
  @Audit({ action: 'decision.create', targetType: 'Decision' })
  create(@Body() body: CreateDecisionDto) {
    return this.decisions.create(body);
  }

  @Get(':id')
  @RequiredScope('read_only')
  findOne(@Param('id') id: string) {
    return this.decisions.findById(id);
  }

  @Patch(':id')
  @RequiredScope('mcp')
  @Audit({ action: 'decision.update', targetType: 'Decision', targetIdParam: 'id' })
  update(@Param('id') id: string, @Body() body: UpdateDecisionDto) {
    return this.decisions.update(id, body);
  }
}
