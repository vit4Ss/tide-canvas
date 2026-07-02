// Content types — mirror the backend content VOs
// (tide-canvas-server/internal/handler/content/vo.go). JSON is camelCase and
// every id / FK field is an idgen.ID, which serializes as a quoted string, so
// all id fields here are typed `string`.

/** One promotional banner (GET /api/banners, embedded in the home feed). */
export interface BannerVO {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string;
  position: string;
  sortOrder: number;
}

/** Slimmed community post for the home "recent works" / LIVE GALLERY rail. */
export interface PostLiteVO {
  id: string;
  userId: string;
  title: string;
  coverUrl: string;
  tags: string[];
  likeCount: number;
  commentCount: number;
  viewCount: number;
  createTime: string;
}

/** Slimmed market model for the home "hot models" rail / marquee. */
export interface ModelLiteVO {
  id: string;
  authorId: string;
  name: string;
  coverUrl: string;
  tags: string[];
  /** Decimal price serialized as a string (e.g. "0", "29.00"). */
  price: string;
  useCount: number;
  likeCount: number;
}

/** Aggregated homepage payload (GET /api/home/feed). */
export interface HomeFeedVO {
  banners: BannerVO[];
  works: PostLiteVO[];
  models: ModelLiteVO[];
}

/** One per-user notification (GET /api/notifications). */
export interface NotificationVO {
  id: string;
  userId: string;
  /** e.g. system / like / comment / follow / task. */
  type: string;
  title: string;
  content: string;
  linkUrl: string;
  refId: string;
  /** 0 = unread, 1 = read. */
  isRead: number;
  readTime: string;
  createTime: string;
}

/** Query params for GET /api/notifications. */
export interface NotificationQuery {
  pageNum?: number;
  pageSize?: number;
  type?: string;
  /** nil/undefined = all, 0 = unread, 1 = read. */
  isRead?: number;
}
