import { http } from "./http";

export interface UserApiKey {
  name: string;
  hint: string;
  enabled: boolean;
  revision: number;
  createTime: string;
  updateTime: string;
}

function keyPath(accountId: string, action = "") {
  return `/api/auth/api-key${action}?accountId=${encodeURIComponent(accountId)}`;
}

export const userApiKeyApi = {
  get: (accountId: string) => http.get<UserApiKey>(keyPath(accountId)),
  reveal: (accountId: string, revision: number) => http.post<{ key: string; revision: number }>(keyPath(accountId, "/reveal"), { revision }),
  rotate: (accountId: string, revision: number) => http.post<UserApiKey>(keyPath(accountId, "/rotate"), { revision }),
  setEnabled: (accountId: string, revision: number, enabled: boolean) => http.put<UserApiKey>(keyPath(accountId, "/status"), { revision, enabled }),
};
