import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { AuthService } from './auth.service.js';

interface ProblemDetails {
  type: string;
  status: number;
  title: string;
  detail: string;
}

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly auth: AuthService) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const token = extractBearerToken(req.headers.authorization);
    const principal = token ? await this.auth.validateToken(token) : null;

    if (!principal) {
      const problem: ProblemDetails = {
        type: 'about:blank',
        status: 401,
        title: 'Unauthorized',
        detail: 'Missing or invalid Bearer token',
      };
      res.status(401).type('application/problem+json').json(problem);
      return;
    }

    req.principal = principal;
    next();
  }
}

function extractBearerToken(header: string | string[] | undefined): string | null {
  if (!header || Array.isArray(header)) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1];
  return token && token.length > 0 ? token : null;
}
