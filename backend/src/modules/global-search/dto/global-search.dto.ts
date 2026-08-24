export type GlobalSearchCategory = 'certificates' | 'assets' | 'settings' | 'plugins';
export type GlobalSearchResultType =
  | 'serverCertificate'
  | 'intermediateCertificate'
  | 'rootCertificate'
  | 'application'
  | 'device'
  | 'cloudService'
  | 'plugin';

export interface GlobalSearchResultDto {
  id: string;
  title: string;
  type: GlobalSearchResultType;
  category: GlobalSearchCategory;
  path: string;
  query?: Record<string, string>;
  keywords: string[];
}

export interface GlobalSearchResponseDto {
  query: string;
  items: GlobalSearchResultDto[];
}
