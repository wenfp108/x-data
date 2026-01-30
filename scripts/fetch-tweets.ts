import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";

const client = await XAuthClient();

console.log("📡 Fetching latest timeline...");
const resp = await client.getTweetApi().getHomeLatestTimeline({
  count: 100,
});

const rawData = resp.data.data || [];
console.log(`🔍 Debug: API returned ${rawData.length} raw items.`);

// 1. 强力过滤
const originalTweets = rawData.filter((item: any) => {
  // 🔥【关键修复】兼容两种数据结构
  // 优先找 raw.result.legacy (Timeline常用)，其次找 tweet.legacy (某些User接口常用)
  const legacy = get(item, "raw.result.legacy") || get(item, "tweet.legacy");
  
  if (!legacy) return false;
  
  const fullText = legacy.fullText || "";
  return !fullText.startsWith("RT @");
});

console.log(`🔍 Debug: After filtering RTs, remaining items: ${originalTweets.length}`);

const newRows: any[] = [];

// 2. 处理数据
originalTweets.forEach((item: any) => {
  // 🔥【关键修复】统一提取入口
  const legacy = get(item, "raw.result.legacy") || get(item, "tweet.legacy");
  const rawResult = get(item, "raw.result") || {}; 

  const createdAt = legacy.createdAt;
  // 只保留 24 小时内的推文
  if (dayjs().diff(dayjs(createdAt), "day") > 1) return;

  const screenName = get(item, "user.legacy.screenName") || 
                     get(item, "raw.result.core.user_results.result.legacy.screenName");
                     
  const idStr = legacy.id_str || rawResult.rest_id; 

  if (!idStr) return;

  const tweetUrl = `https://x.com/${screenName}/status/${idStr}`;

  const user = {
    screenName: screenName,
    name: get(item, "user.legacy.name") || get(item, "raw.result.core.user_results.result.legacy.name"),
    followersCount: get(item, "user.legacy.followersCount") || get(item, "raw.result.core.user_results.result.legacy.followersCount"),
  };

  const fullText = legacy.fullText;

  // 提取被引用的推文内容
  let quoted = null;
  if (legacy.is_quote_status) { 
    const quotedResult = get(item, "raw.result.quoted_status_result");
    if (quotedResult) {
      quoted = {
        screenName: get(quotedResult, "result.core.user_results.result.legacy.screenName"),
        fullText: get(quotedResult, "result.legacy.fullText"),
      };
    }
  }

  // 提取媒体
  const mediaItems = get(legacy, "extended_entities.media", []) || get(legacy, "entities.media", []);
  const images = mediaItems
    .filter((media: any) => media.type === "photo")
    .map((media: any) => media.media_url_https);

  const videos = mediaItems
    .filter((media: any) => media.type === "video" || media.type === "animated_gif")
    .map((media: any) => {
      const variants = get(media, "video_info.variants", []);
      const bestQuality = variants
        .filter((v: any) => v.content_type === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return bestQuality?.url;
    })
    .filter(Boolean);

  // 提取指标 (兼容 raw 和 legacy)
  const currentMetrics = {
    likes: legacy.favorite_count || 0,
    retweets: legacy.retweet_count || 0,
    replies: legacy.reply_count || 0,
    quotes: legacy.quote_count || 0,
    bookmarks: legacy.bookmark_count || 0,
    // Views 通常只藏在 raw.result.views.count 里
    views: parseInt(get(rawResult, "views.count", "0")) || 0
  };

  newRows.push({
    // @ts-ignore
    user,
    images,
    videos,
    tweetUrl,
    fullText,
    quoted,
    createdAt,
    metrics: currentMetrics,
  });
});

console.log(`✅ Debug: Successfully processed ${newRows.length} tweets.`);

const outputPath = `./tweets/${dayjs().format("YYYY-MM-DD")}.json`;
let existingMap = new Map();

// 3. 读取旧数据
if (fs.existsSync(outputPath)) {
  try {
    const existingRows = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    existingRows.forEach((row: any) => existingMap.set(row.tweetUrl, row));
  } catch (e) {
    console.log("⚠️ Error reading existing file, starting fresh.");
  }
}

// 4. 智能合并 logic
const currentTimeStr = dayjs().format("YYYY-MM-DD HH:mm");

newRows.forEach(newTweet => {
  const oldTweet = existingMap.get(newTweet.tweetUrl);
  
  let growth = { likes: 0, views: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 };
  let peakGrowth = { time: currentTimeStr, views: 0, likes: 0, bookmarks: 0, replies: 0 };

  if (oldTweet && oldTweet.peakGrowth) {
    peakGrowth = oldTweet.peakGrowth;
  }

  // 计算增量
  if (oldTweet && oldTweet.metrics) {
    growth = {
      likes: newTweet.metrics.likes - (oldTweet.metrics.likes || 0),
      retweets: newTweet.metrics.retweets - (oldTweet.metrics.retweets || 0),
      replies: newTweet.metrics.replies - (oldTweet.metrics.replies || 0),
      quotes: newTweet.metrics.quotes - (oldTweet.metrics.quotes || 0),
      bookmarks: newTweet.metrics.bookmarks - (oldTweet.metrics.bookmarks || 0),
      views: newTweet.metrics.views - (parseInt(oldTweet.metrics.views) || 0)
    };
    
    Object.keys(growth).forEach(k => {
      // @ts-ignore
      if (growth[k] < 0) growth[k] = 0;
    });

    // 更新峰值
    if (growth.views > peakGrowth.views) {
      peakGrowth.views = growth.views;
      peakGrowth.likes = growth.likes;
      peakGrowth.bookmarks = growth.bookmarks;
      peakGrowth.replies = growth.replies;
      peakGrowth.time = currentTimeStr;
    }
  }

  newTweet.growth = growth;
  newTweet.peakGrowth = peakGrowth;
  
  existingMap.set(newTweet.tweetUrl, newTweet);
});

// 5. 排序并保存
const sortedRows = Array.from(existingMap.values()).sort((a: any, b: any) => {
  const idA = a.tweetUrl.split('/').pop() || '';
  const idB = b.tweetUrl.split('/').pop() || '';
  return idB.localeCompare(idA);
});

fs.writeFileSync(outputPath, JSON.stringify(sortedRows, null, 2));

console.log(`💾 Saved ${sortedRows.length} tweets to ${outputPath}`);
