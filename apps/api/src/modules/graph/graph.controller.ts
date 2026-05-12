import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { EntityType } from '@prisma/client';

import { Audit } from '../../audit/audit.decorator.js';
import { RequiredScope } from '../../auth/scope.decorator.js';
import {
  CreateEntityDto,
  GraphOverviewQuery,
  GraphQuery,
  ListEdgesQuery,
  ListEntitiesQuery,
  MergeEntitiesDto,
  UpdateEdgeDto,
  UpdateEntityDto,
} from './dto.js';
import { GraphService } from './graph.service.js';

@ApiTags('graph')
@ApiCookieAuth('mnela_session')
@ApiBearerAuth()
@Controller('graph')
export class GraphController {
  constructor(private readonly graph: GraphService) {}

  @Get()
  @RequiredScope('read_only')
  @ApiOperation({
    summary: 'Return a Cytoscape-shaped subgraph centered on an entity (BFS to depth)',
  })
  graphForCenter(@Query() query: GraphQuery) {
    const types = query.types
      ? Array.isArray(query.types)
        ? (query.types as EntityType[])
        : [query.types as EntityType]
      : undefined;
    return this.graph.neighborhood(query.center, {
      depth: query.depth ?? 1,
      types,
      maxNodes: query.maxNodes,
      projectSlug: query.projectSlug,
      relations: query.relations,
      confidence: query.confidence,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  @Get('overview')
  @RequiredScope('read_only')
  @ApiOperation({
    summary: 'Zero-state landing view: top-N most-connected entities and the edges that link them',
  })
  graphOverview(@Query() query: GraphOverviewQuery) {
    const types = query.types
      ? Array.isArray(query.types)
        ? (query.types as EntityType[])
        : [query.types as EntityType]
      : undefined;
    return this.graph.overview({
      limit: query.limit,
      minDegree: query.minDegree,
      types,
    });
  }

  @Get('entity-types')
  @RequiredScope('read_only')
  @ApiOperation({
    summary: 'Distinct Entity.type values present in the DB, with usage counts',
  })
  entityTypeFacets() {
    return this.graph.listEntityTypeFacets();
  }

  @Get('relation-types')
  @RequiredScope('read_only')
  @ApiOperation({
    summary: 'Distinct Edge.relationType values present in the DB, with usage counts',
  })
  relationTypeFacets() {
    return this.graph.listRelationTypeFacets();
  }

  @Get('entities')
  @RequiredScope('read_only')
  @ApiOperation({ summary: 'List entities with optional fuzzy name filter' })
  listEntities(@Query() query: ListEntitiesQuery) {
    return this.graph.listEntities(
      { q: query.q, type: query.type, includeMerged: query.includeMerged },
      query.page,
      query.limit,
    );
  }

  @Get('entities/:id')
  @RequiredScope('read_only')
  findEntity(@Param('id') id: string) {
    return this.graph.findEntity(id);
  }

  @Patch('entities/:id')
  @RequiredScope('mcp')
  @Audit({ action: 'entity.update', targetType: 'Entity', targetIdParam: 'id' })
  updateEntity(@Param('id') id: string, @Body() body: UpdateEntityDto) {
    return this.graph.updateEntity(id, body);
  }

  @Post('entities')
  @RequiredScope('mcp')
  @Audit({ action: 'entity.create', targetType: 'Entity' })
  @ApiOperation({
    summary:
      'Create a new entity manually (find-or-create: returns the existing one if name+type collides)',
  })
  createEntity(@Body() body: CreateEntityDto) {
    return this.graph.createEntity({
      name: body.name,
      type: body.type,
      description: body.description ?? null,
      aliases: body.aliases ?? [],
    });
  }

  @Post('entities/merge')
  @RequiredScope('admin')
  @Audit({ action: 'entity.merge', targetType: 'Entity' })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Merge sourceId into targetId; rewrites mentions, dedupes colliding edges, removes self-loops. dryRun=true returns counts without writing.',
  })
  mergeEntities(@Body() body: MergeEntitiesDto) {
    return this.graph.mergeEntities(body.sourceId, body.targetId, { dryRun: body.dryRun });
  }

  @Get('edges')
  @RequiredScope('read_only')
  listEdges(@Query() query: ListEdgesQuery) {
    return this.graph.listEdges(
      {
        fromId: query.fromId,
        toId: query.toId,
        status: query.status,
        relationType: query.relationType,
      },
      query.page,
      query.limit,
    );
  }

  @Patch('edges/:id')
  @RequiredScope('mcp')
  @Audit({ action: 'edge.update', targetType: 'Edge', targetIdParam: 'id' })
  updateEdge(@Param('id') id: string, @Body() body: UpdateEdgeDto) {
    return this.graph.updateEdge(id, body);
  }

  @Delete('edges/:id')
  @RequiredScope('admin')
  @Audit({ action: 'edge.delete', targetType: 'Edge', targetIdParam: 'id' })
  @HttpCode(HttpStatus.OK)
  deleteEdge(@Param('id') id: string) {
    return this.graph.deleteEdge(id);
  }
}
