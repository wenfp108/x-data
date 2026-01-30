import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import type { TweetApiUtilsData } from "twitter-openapi-typescript";

const client = await XAuthClient();

console.log("📡 Fetching latest timeline...");
const resp = await client.getTweetApi().getHomeLatestTimeline({
  count: 100,
});

// 过滤出原创推文 (保留 Original 和 Quote，排除纯 Retweet)
const originalTweets = resp.data.data.filter((tweet) => {
  const fullText = get(tweet, "raw.result.legacy.fullText", "");
  return !fullText.startsWith("RT @"); 
});

const newRows: any[] = [];

// 1. 处理新抓取的数据
originalTweets.forEach((tweet) => {
  const createdAt = get(tweet, "raw.result.legacy.createdAt");
  // 只保留 24 小时内的推文
  if (dayjs().diff(dayjs(createdAt), "day") > 1) return;

  const screenName = get(tweet, "user.legacy.screenName");
  const tweetUrl = `https://x.com/${screenName}/status/${get(tweet, "raw.result.legacy.idStr")}`;

  const user = {
    screenName: get(tweet, "user.legacy.screenName"),
    name: get(tweet, "user.legacy.name"),
    followersCount: get(tweet, "user.legacy.followersCount"),
  };

  const fullText = get(tweet, "raw.result.legacy.fullText");

  // ✅ 提取被引用的推文内容 (大佬在评论什么？)
  let quoted = null;
  const isQuoteStatus = get(tweet, "raw.result.legacy.isQuoteStatus");
  if (isQuoteStatus) {
    const quotedResult = get(tweet, "raw.result.quoted_status_result");
    if (quotedResult) {
      quoted = {
        screenName: get(quotedResult, "result.core.user_results.result.legacy.screenName"),
        fullText: get(quotedResult, "result.legacy.fullText"),
      };
    }
  }

  const mediaItems = get(tweet, "raw.result.legacy.extendedEntities.media", []);
  const images = mediaItems
    .filter((media: any) => media.type === "photo")
    .map((media: any) => media.mediaUrlHttps);

  const videos = mediaItems
    .filter((media: any) => media.type === "video" || media.type === "animated_gif")
    .map((media: any) => {
      const variants = get(media, "videoInfo.variants", []);
      const bestQuality = variants
        .filter((v: any) => v.contentType === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return bestQuality?.url;
    })
    .filter(Boolean);

  // 🔥【核心修复】更强壮的数据提取逻辑
  // 即使 legacy 为空，也能保证 metrics 结构完整，不会报错
  const legacy = get(tweet, "raw.result.legacy") || {};
  
  const currentMetrics = {
    likes: legacy.favorite_count || 0,
    retweets: legacy.retweet_count || 0,
    replies: legacy.reply_count || 0,
    quotes: legacy.quote_count || 0,
    bookmarks: legacy.bookmark_count || 0,
    // views 比较特殊，通常在 views.count 且是字符串
    views: parseInt(get(tweet, "raw.result.views.count", "0")) || 0
  };

  newRows.push({
    // @ts-ignore
    user,
    images,
    videos,
    tweetUrl,
    fullText,
    quoted,   // 引用内容
    createdAt,
    metrics: currentMetrics,
    // growth 和 peakGrowth 稍后在合并时计算
  });
});

const outputPath = `./tweets/${dayjs().format("YYYY-MM-DD")}.json`;
let existingMap = new Map();

// 2. 读取硬盘上的旧数据
if (fs.existsSync(outputPath)) {
  try {
    const existingRows = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    existingRows.forEach((row: any) => existingMap.set(row.tweetUrl, row));
  } catch (e) {
    console.log("⚠️ Error reading existing file, starting fresh.");
  }
}

// 3. 智能合并 logic
const currentTimeStr = dayjs().format("YYYY-MM-DD HH:mm"); // ✅ 绝对时间戳

newRows.forEach(newTweet => {
  const oldTweet = existingMap.get(newTweet.tweetUrl);
  
  let growth = { likes: 0, views: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 };
  let peakGrowth = { time: currentTimeStr, views: 0, likes: 0, bookmarks: 0, replies: 0 };

  if (oldTweet && oldTweet.peakGrowth) {
    peakGrowth = oldTweet.peakGrowth;
  }

  // 计算当前增量
  if (oldTweet && oldTweet.metrics) {
    growth = {
      likes: newTweet.metrics.likes - (oldTweet.metrics.likes || 0),
      retweets: newTweet.metrics.retweets - (oldTweet.metrics.retweets || 0),
      replies: newTweet.metrics.replies - (oldTweet.metrics.replies || 0),
      quotes: newTweet.metrics.quotes - (oldTweet.metrics.quotes || 0),
      bookmarks: newTweet.metrics.bookmarks - (oldTweet.metrics.bookmarks || 0),
      views: newTweet.metrics.views - (parseInt(oldTweet.metrics.views) || 0)
    };
    
    // 修正负数
    Object.keys(growth).forEach(k => {
      // @ts-ignore
      if (growth[k] < 0) growth[k] = 0;
    });

    // 更新峰值记录
    if (growth.views > peakGrowth.views) {
      peakGrowth.views = growth.views;
      peakGrowth.likes = growth.likes;
      peakGrowth.bookmarks = growth.bookmarks;
      peakGrowth.replies = growth.replies;
      peakGrowth.time = currentTimeStr;
    }
  }

  // 写入新对象
  newTweet.growth = growth;
  newTweet.peakGrowth = peakGrowth;
  
  existingMap.set(newTweet.tweetUrl, newTweet);
});

// 4. 排序并保存
const sortedRows = Array.from(existingMap.values()).sort((a: any, b: any) => {
  const idA = a.tweetUrl.split('/').pop() || '';
  const idB = b.tweetUrl.split('/').pop() || '';
  return idB.localeCompare(idA);
});

fs.writeFileSync(outputPath, JSON.stringify(sortedRows, null, 2));

// ==========================================
// 🔥 极简版：监控摘要 (无污染)
// ==========================================
console.log("\n📊 [Monitor Summary]");
const oneHourAgo = dayjs().subtract(1, 'hour');
const recentTweets = sortedRows.filter((row: any) => dayjs(row.createdAt).isAfter(oneHourAgo));
const trendIcon = recentTweets.length > 20 ? "🔥 HIGH" : "hmC NORMAL";

console.log(`  ➤ Processed:        ${newRows.length} tweets from timeline`);
console.log(`  ➤ Total Saved:      ${sortedRows.length} unique tweets (24h window)`);
console.log(`  ➤ Recent Activity:  ${recentTweets.length} new tweets in last hour ${trendIcon}`);
console.log("==========================================\n");
