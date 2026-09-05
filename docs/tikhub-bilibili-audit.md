# Bilibili 接入核查（2026-09-05）

数据源：[TikHub 完整 OpenAPI](https://api.tikhub.io/openapi.json)、[官方 Bilibili 说明](https://tikhub.io/bilibili-api)。
接口市场为分页 SPA，本次没有可用浏览器，因此从完整 OpenAPI 核对所有 Bilibili 路径，而不是只检查市场第一页。
本次读取到 87 个接口：Web 31、App 11、花火 45。接口声明共用泛型 `ResponseModel`，不能把文档中的 `data: null` 示例理解成实际视频没有数据。

## 复现与原因

- 截图视频 `BV1114y1X7TA` 的 B 站公开详情响应中，`stat.view=89652`、`stat.like=853`、`stat.reply=398`、`stat.favorite=1714`、`stat.share=289`；`owner` 包含作者 ID、名称和头像。这是本次读取时的值，不是历史快照值。
- 项目此前只请求 `web/fetch_one_video_v3?url=...`。通用字段映射没有 `stat.like/reply/share/favorite`，有播放量而其他指标为空与该缺口一致。没有取得用户当次 TikHub 原始响应，因此不能断言 V3 本次具体遗漏了哪些字段。
- TikHub 有独立的播放信息和播放流接口；只请求视频详情不能保证获得完整视频。
- 对该视频的公开 MP4 做了 64 字节范围请求：未带来源头时 403，带 `Referer: https://www.bilibili.com/` 和 `User-Agent: Mozilla/5.0` 后 206，文件头含 `ftyp`。不带来源头的转存同样会失败。

## 本次修改的调用规则

1. 保留 V3 URL 解析，支持原有分享链接。
2. 互动指标或作者资料不完整时，按已识别的 BV 号请求 `web/fetch_one_video?bv_id=...`；仅合并同一视频的数据，保留未返回字段及有效的 0。
3. 没有完整 MP4 时请求 `web/fetch_video_play_info?url=...`；仍未获得时，使用详情中的 BV、所选分 P 的 CID 请求 `web/fetch_video_playurl?bv_id=...&cid=...`。明确选择其他分 P 时直接按 CID 取流，防止误用第一 P。
4. 只接受完整 MP4 或单个 `durl` 及其备用域名；DASH 的视频轨/音频轨、多段 `durl`、FLV、M3U8 不冒充完整视频。不调用需要会员 Cookie 的接口。
5. 整体调用有 55 秒上限，最多 4 次 TikHub 请求；补充失败仍返回已获取的信息和缺项说明。
6. 本站远程文件客户端下载 `bilivideo.com` 及子域名时加上公开来源头；保留 DNS、重定向、文件大小和存储权限检查。

页面仍用 `—` 表示缺失，0 表示接口明确返回的 0。历史记录继续展示当时快照；部署后需要主动获取最新数据才能获得修复后的结果。

## 接口用途与扩展边界

- Web/App 详情接口适合补作品指标；评论、回复、弹幕和字幕分别属于评论内容、时间点反馈和文本分析能力，不能用一页评论数代替视频累计评论数。
- 用户作品列表属于样本列表，不保证带全量互动字段。Web V2 支持继续翻页读取超过 5000 个作品，但返回字段更少；完整互动分析仍需按 BV 取详情。本次没有扩大账号采样量或增加逐视频请求。
- 花火的粉丝趋势、受众分布、内容相似账号、商业报价与合作表现可用于后续扩展。这些指标有各自时间范围、商业合作场景和数据覆盖范围，不能直接替换当前公开作品的累计数据。
- 搜索、榜单、直播、收藏夹、标签字典和广告主账号接口已核对，但不是修复当前五个作品指标所需的调用。
- 本次没有使用生产 TikHub Key 发起计费请求；接口组合已通过模拟上游响应测试，真实 TikHub Key 的返回结构及权限仍需部署后验证。

## 全量接口索引

下列索引来自上述完整 OpenAPI。路径统一以 `/api/v1/bilibili/` 开头；`!` 表示必填 query 参数，POST 单独标记 body 类型。

### web

| Method / Path | Query / Body |
| --- | --- |
| `GET web/fetch_one_video` | `bv_id!` |
| `GET web/fetch_one_video_v2` | `a_id!`, `c_id!` |
| `GET web/fetch_one_video_v3` | `url!` |
| `GET web/fetch_video_detail` | `aid!` |
| `GET web/fetch_video_play_info` | `url!` |
| `GET web/fetch_video_subtitle` | `a_id!`, `c_id!` |
| `GET web/fetch_hot_search` | `limit!` |
| `GET web/fetch_general_search` | `keyword!`, `order!`, `page!`, `page_size!`, `duration`, `pubtime_begin_s`, `pubtime_end_s` |
| `GET web/fetch_video_playurl` | `bv_id!`, `cid!` |
| `POST web/fetch_vip_video_playurl` | JSON body: `VIPVideoModel` |
| `GET web/fetch_user_post_videos` | `uid!`, `pn`, `ps`, `order` |
| `GET web/fetch_user_post_videos_v2` | `uid!`, `pn`, `ps`, `keyword` |
| `GET web/fetch_collect_folders` | `uid!` |
| `GET web/fetch_user_collection_videos` | `folder_id!`, `pn` |
| `GET web/fetch_user_profile` | `uid!` |
| `GET web/fetch_user_up_stat` | `uid!` |
| `GET web/fetch_user_relation_stat` | `uid!` |
| `GET web/fetch_com_popular` | `pn` |
| `GET web/fetch_video_comments` | `bv_id!`, `pn` |
| `GET web/fetch_comment_reply` | `bv_id!`, `pn`, `rpid!` |
| `GET web/fetch_user_dynamic` | `uid!`, `offset` |
| `GET web/fetch_dynamic_detail` | `dynamic_id!` |
| `GET web/fetch_dynamic_detail_v2` | `dynamic_id!` |
| `GET web/fetch_video_danmaku` | `cid!` |
| `GET web/fetch_live_room_detail` | `room_id!` |
| `GET web/fetch_live_videos` | `room_id!` |
| `GET web/fetch_live_streamers` | `area_id!`, `pn` |
| `GET web/fetch_all_live_areas` | -- |
| `GET web/bv_to_aid` | `bv_id!` |
| `GET web/fetch_video_parts` | `bv_id!` |
| `GET web/fetch_get_user_id` | `share_link!` |

### app

| Method / Path | Query / Body |
| --- | --- |
| `GET app/fetch_one_video` | `av_id`, `bv_id` |
| `GET app/fetch_video_comments` | `av_id`, `bv_id`, `mode`, `next_offset` |
| `GET app/fetch_reply_detail` | `root!`, `av_id`, `bv_id`, `next_offset`, `ps` |
| `GET app/fetch_user_videos` | `user_id!`, `post_filter`, `page`, `ps` |
| `GET app/fetch_user_info` | `user_id!` |
| `GET app/fetch_home_feed` | `idx`, `flush`, `pull` |
| `GET app/fetch_popular_feed` | `idx`, `last_param` |
| `GET app/fetch_search_all` | `keyword!`, `cursor`, `page_size`, `order` |
| `GET app/fetch_search_by_type` | `keyword!`, `search_type`, `cursor`, `page_size`, `order` |
| `GET app/fetch_cinema_tab` | -- |
| `GET app/fetch_bangumi_tab` | -- |

### huahuo

| Method / Path | Query / Body |
| --- | --- |
| `POST huahuo/search_upper` | JSON body: `UpperSearchBody` |
| `GET huahuo/search_upper_suggest` | `nickname_or_mids!`, `page`, `panel_type`, `marketing_target`, `cpm_type`, `cpm_cycle`, `play_median_traffic_type`, `play_median_cycle` |
| `POST huahuo/search_live_upper` | JSON body: `LiveSearchBody` |
| `GET huahuo/upper_detail` | `upper_mid!` |
| `GET huahuo/upper_draft_trend` | `upper_mid!`, `trend_type` |
| `GET huahuo/upper_fans_trend` | `upper_mid!`, `query_type` |
| `GET huahuo/upper_overlap_uppers` | `upper_mid!`, `fans_range`, `page` |
| `GET huahuo/upper_similar` | `upper_mid!` |
| `GET huahuo/upper_representative` | `upper_mid!`, `type` |
| `GET huahuo/upper_draft_performance` | `upper_mid!`, `day_range` |
| `GET huahuo/upper_archive_highlights` | `upper_mid!`, `day_range` |
| `GET huahuo/upper_base_info` | `mid!` |
| `GET huahuo/upper_seek_info` | `mid!` |
| `GET huahuo/upper_busy_time` | `mid!` |
| `GET huahuo/upper_by_nickname` | `nickname!` |
| `GET huahuo/live_upper_portrait` | `mcn_id!`, `upper_mid` |
| `GET huahuo/live_commerce_info` | `upper_mid!` |
| `GET huahuo/popular_up_list` | `rank_cate`, `tid_name`, `page` |
| `GET huahuo/x_huo_industry_drop` | `scene` |
| `GET huahuo/x_huo_date_options` | `rank_date_type` |
| `GET huahuo/popular_up_x_huo` | `x_huo_industry_id!`, `rank_date_type`, `rank_date`, `page` |
| `GET huahuo/popular_goods_list` | `x_huo_industry_id!`, `page`, `rank_type`, `data_cycle`, `min_goods_price`, `max_goods_price` |
| `GET huahuo/popular_goods_up_list` | `goods_id!`, `page` |
| `GET huahuo/popular_goods_industry_up_list` | `x_huo_industry_id!`, `page` |
| `GET huahuo/popular_up_tid_drop` | -- |
| `GET huahuo/popular_avid_list` | `category`, `page` |
| `GET huahuo/popular_avid_category_drop` | -- |
| `GET huahuo/square_static_info` | -- |
| `GET huahuo/upper_label_tree` | `panel_type` |
| `GET huahuo/mcn_drop` | `name` |
| `GET huahuo/region_drop` | -- |
| `GET huahuo/partition_drop` | -- |
| `GET huahuo/dmp_pkg_list` | -- |
| `GET huahuo/effect_goods_drop` | -- |
| `GET huahuo/live_guild_drop` | `name` |
| `GET huahuo/cooperate_experience_industry` | `industry_type!` |
| `GET huahuo/live_area_list` | -- |
| `GET huahuo/live_parent_tag` | -- |
| `GET huahuo/live_good_category` | -- |
| `GET huahuo/tag_character` | -- |
| `GET huahuo/tag_occupation` | -- |
| `GET huahuo/tag_commercial` | -- |
| `GET huahuo/industry_tags` | -- |
| `GET huahuo/label_char_style` | -- |
| `GET huahuo/account_session_info` | -- |
