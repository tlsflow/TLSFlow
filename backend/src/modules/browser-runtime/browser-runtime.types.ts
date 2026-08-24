export interface BrowserRuntimeCreateRequest {
  sessionId: string;
  loginUrl: string;
  allowedOrigins: string[];
  ttlSeconds: number;
}

export interface BrowserRuntimeSession {
  sessionId: string;
  status: 'created' | 'ready' | 'stopped' | 'expired' | 'failed';
  vncUrl: string;
  cdpConnected?: boolean;
  expiresAt: string;
}

export interface BrowserRuntimeBrowserAction {
  action: 'navigate' | 'extract' | 'verify';
  url?: string;
  extractions?: Array<{
    name: string;
    source: 'cookie' | 'header' | 'local_storage' | 'session_storage' | 'url' | 'text';
    key?: string;
    optional?: boolean;
  }>;
  verification?: {
    url?: string;
    statusCode?: number;
    textContains?: string;
    headers?: Record<string, string>;
  };
}

export interface BrowserRuntimeActionResult {
  success: boolean;
  statusCode?: number;
  headers?: Record<string, string>;
  body?: unknown;
  parameters?: Record<string, string>;
  errorCode?: string;
  errorMessage?: string;
}
