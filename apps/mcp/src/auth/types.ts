export { type TokenScope, type Principal, SCOPE_HIERARCHY, scopeAllows } from '@mnela/db';

import type { Principal } from '@mnela/db';

// The api app declares this same global augment, but TS only picks it up for
// files within that project. Re-declare it here so apps/mcp also sees
// req.principal as a typed property.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal;
    }
  }
}
