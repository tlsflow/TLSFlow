declare module 'ali-oss' {
  export interface OssClientOptions {
    accessKeyId: string;
    accessKeySecret: string;
    region: string;
    bucket?: string;
    authorizationV4?: boolean;
  }

  export interface OssRequestParams {
    content?: string;
    mime?: string;
    successStatuses?: number[];
    [key: string]: unknown;
  }

  export interface OssBucketListResult {
    buckets?: Array<Record<string, unknown>>;
  }

  export default class OSS {
    constructor(options: OssClientOptions);
    listBuckets(query?: Record<string, unknown>): Promise<OssBucketListResult>;
    request(params: OssRequestParams): Promise<Record<string, unknown>>;
    _bucketRequestParams(method: string, bucket: string, query?: Record<string, unknown>): OssRequestParams;
  }
}
