export interface Result<T = unknown> {
  success: boolean;
  code: number;
  message: string;
  data: T;
  timestamp: number;
}

export interface PageData<T = unknown> {
  records: T[];
  total: number;
  pageNum: number;
  pageSize: number;
  pages: number;
}

export type PageResult<T = unknown> = Result<PageData<T>>;

export interface PageQuery {
  pageNum?: number;
  pageSize?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
}

export enum ResultCode {
  SUCCESS = 200,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  RATE_LIMIT = 429,
  SERVER_ERROR = 500,
  USERNAME_EXISTS = 1001,
  EMAIL_EXISTS = 1002,
  PASSWORD_INCORRECT = 1003,
  AI_QUOTA_INSUFFICIENT = 2001,
  MODEL_UNAVAILABLE = 2002,
  HANDLER_NOT_FOUND = 2003,
  FILE_TYPE_NOT_ALLOWED = 3001,
  FILE_SIZE_EXCEEDED = 3002,
  STORAGE_INSUFFICIENT = 3003,
}
