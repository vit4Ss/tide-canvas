/** @typedef {import('@/lib/social-analysis-api').SocialPlatform} Platform */
/** @typedef {import('@/lib/social-analysis-api').SocialMetricVO} Metrics */

/** @type {Array<{ key: keyof Metrics; label: string; interaction: boolean }>} */
const definitions = [
  { key: 'play', label: '播放', interaction: false },
  { key: 'like', label: '点赞', interaction: true },
  { key: 'favorite', label: '收藏', interaction: true },
  { key: 'coin', label: '投币', interaction: true },
  { key: 'comment', label: '评论', interaction: true },
  { key: 'danmaku', label: '弹幕', interaction: true },
  { key: 'share', label: '分享', interaction: true },
  { key: 'download', label: '下载', interaction: false },
];

/** @param {Platform | undefined} platform */
export function platformMetrics(platform) {
  return definitions.filter(({ key }) => {
    if (key === 'coin' || key === 'danmaku') return platform === 'bilibili';
    if (key === 'download') return platform === 'douyin' || platform === 'tiktok';
    if (platform === 'youtube') return ['play', 'like', 'comment'].includes(key);
    return true;
  }).map((item) => ({ ...item, label: platform === 'youtube' && item.key === 'play' ? '观看' : item.label }));
}

/** @param {Platform} platform */
export function platformVocabulary(platform) {
  if (platform === 'youtube') return { account: '频道', followers: '订阅者', works: '视频', tags: '视频主题' };
  if (platform === 'xiaohongshu') return { account: '博主', followers: '粉丝', works: '笔记', tags: '笔记话题' };
  if (platform === 'bilibili') return { account: 'UP 主', followers: '粉丝', works: '投稿', tags: '分区与标签' };
  return { account: '创作者', followers: '粉丝', works: '作品', tags: '作品话题' };
}
