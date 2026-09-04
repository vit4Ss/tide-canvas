import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type { SocialActivityRecordQuery, SocialActivityRecordVO } from "@/types/social-record";

export const adminSocialRecordsApi = {
  list: (query: SocialActivityRecordQuery = {}) =>
    http.get<PageData<SocialActivityRecordVO>>("/api/admin/social-records", toParams(query)),
};
