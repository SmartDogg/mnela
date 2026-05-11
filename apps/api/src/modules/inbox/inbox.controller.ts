import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Audit } from '../../audit/audit.decorator.js';
import { CurrentPrincipal } from '../../auth/principal.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import type { Principal } from '../../auth/types.js';
import { BulkInboxDto, EditInboxDto, ListInboxQuery } from './dto.js';
import type { BulkInboxResult } from './inbox.service.js';
import { InboxService } from './inbox.service.js';

@ApiTags('inbox')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('inbox')
export class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List inbox items (review queue)' })
  list(@Query() query: ListInboxQuery) {
    return this.inbox.list({ type: query.type, status: query.status }, query.page, query.limit);
  }

  @Get(':id')
  @RequiredScope('read_only')
  findOne(@Param('id') id: string) {
    return this.inbox.findById(id);
  }

  // Static `bulk/*` routes MUST be declared before `:id/*` routes — NestJS/Express match
  // in registration order, and `POST /inbox/bulk/accept` would otherwise be captured by
  // `POST /inbox/:id/accept` with id='bulk' and fall through to a 404.
  @Post('bulk/accept')
  @RequiredScope('mcp')
  @ApiOperation({ summary: 'Bulk accept inbox items (per-item tx, partial-success report)' })
  async bulkAccept(
    @Body() body: BulkInboxDto,
    @CurrentPrincipal() principal: Principal | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BulkInboxResult> {
    const result = await this.inbox.acceptMany(body.ids, principal);
    this.setBulkStatus(res, result);
    return result;
  }

  @Post('bulk/reject')
  @RequiredScope('mcp')
  @ApiOperation({ summary: 'Bulk reject inbox items (per-item tx, partial-success report)' })
  async bulkReject(
    @Body() body: BulkInboxDto,
    @CurrentPrincipal() principal: Principal | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<BulkInboxResult> {
    const result = await this.inbox.rejectMany(body.ids, principal);
    this.setBulkStatus(res, result);
    return result;
  }

  @Post(':id/accept')
  @RequiredScope('mcp')
  @Audit({ action: 'inbox.accept', targetType: 'InboxItem', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept an inbox item and apply its payload' })
  accept(@Param('id') id: string, @CurrentPrincipal() principal: Principal | undefined) {
    return this.inbox.accept(id, principal);
  }

  @Post(':id/reject')
  @RequiredScope('mcp')
  @Audit({ action: 'inbox.reject', targetType: 'InboxItem', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject an inbox item without applying it' })
  reject(@Param('id') id: string, @CurrentPrincipal() principal: Principal | undefined) {
    return this.inbox.reject(id, principal);
  }

  @Post(':id/edit')
  @RequiredScope('mcp')
  @Audit({ action: 'inbox.edit_accept', targetType: 'InboxItem', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Modify the inbox payload then accept it' })
  edit(
    @Param('id') id: string,
    @Body() body: EditInboxDto,
    @CurrentPrincipal() principal: Principal | undefined,
  ) {
    return this.inbox.edit(id, body.payload, principal);
  }

  private setBulkStatus(res: Response, result: BulkInboxResult): void {
    if (result.accepted.length === 0) {
      throw new UnprocessableEntityException({
        type: 'about:blank',
        title: 'Bulk operation failed for every item',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        batchId: result.batchId,
        failed: result.failed,
      });
    }
    res.status(result.failed.length > 0 ? HttpStatus.MULTI_STATUS : HttpStatus.OK);
  }
}
