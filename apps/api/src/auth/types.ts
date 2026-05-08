export { type TokenScope, type Principal, SCOPE_HIERARCHY, scopeAllows } from '@mnela/db';

import type { Principal } from '@mnela/db';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
