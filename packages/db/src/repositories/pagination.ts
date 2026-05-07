export interface PageOptions {
  page?: number;
  limit?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface PaginationParams {
  skip: number;
  take: number;
  page: number;
  limit: number;
}

const MAX_PAGE_SIZE = 100;

export function paginationParams(opts: PageOptions = {}): PaginationParams {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(opts.limit ?? 20)));
  return {
    skip: (page - 1) * limit,
    take: limit,
    page,
    limit,
  };
}

export function makePage<T>(items: T[], total: number, params: PaginationParams): Page<T> {
  return {
    items,
    total,
    page: params.page,
    limit: params.limit,
  };
}
