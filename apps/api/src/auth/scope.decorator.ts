import { SetMetadata } from '@nestjs/common';

import type { TokenScope } from './types.js';

export const SCOPES_KEY = Symbol('requiredScopes');
export const RequiredScope = (...scopes: TokenScope[]): MethodDecorator & ClassDecorator =>
  SetMetadata(SCOPES_KEY, scopes);
