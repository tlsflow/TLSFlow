export interface PageResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export function createPageResponse<T>(items: T[], page: number, pageSize: number, total: number): PageResponse<T> {
  return { items, page, pageSize, total };
}
