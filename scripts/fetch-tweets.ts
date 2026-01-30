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
console.log(`🔍 [Debug] API returned ${rawData.length} raw items.`);

// 1. 强力过滤
const originalTweets = rawData.filter((item: any) => {
  // 兼容路径
  const legacy = get(item, "raw.result.legacy") || get(item, "tweet.legacy");
  if (!legacy) return false;
  
  // 注意：这里用 idStr (驼峰)
  const fullText = legacy.fullText || "";
  return !fullText.startsWith("RT @");
});

console.log(`🔍 [Debug] After filtering RTs, remaining items: ${originalTweets.length}`);

const newRows: any[] = [];
let skippedCount = 0;

// 2. 处理数据
originalTweets.forEach((item: any) => {
  const legacy = get(item, "raw.result.legacy") || get(item, "tweet.legacy");
  const rawResult = get(item, "raw.result") || {}; 

  const createdAt = legacy.createdAt; // 驼峰
  
  // 宽松时间限制 (7天)，防止数据全被扔掉
  if (dayjs().diff(dayjs(createdAt), "day") > 7) {
    skippedCount++;
    return;
  }

  // 🔥【关键修复】使用驼峰命名 idStr 和 restId
  // 还要尝试 id (有些库直接叫 id)
  const idStr = legacy.idStr || legacy.id || rawResult.restId || legacy.id_str;

  // 这里的 user 路径也需要注意驼峰
  const userResult = get(item, "raw.result.core.user_results.result.legacy") || 
                     get(item, "tweet.core.user_results.result.legacy") || 
                     get(item, "user.legacy");

  const screenName = userResult?.screenName || legacy.screenName;

  if (!idStr || !screenName) {
    if (skippedCount === 0) console.log("⚠️ [Debug] Item missing ID/ScreenName. Keys available:", Object.keys(legacy));
    skippedCount++;
    return;
  }

  const tweetUrl = `https://x.com/${screenName}/status/${idStr}`;

  const user = {
    screenName: screenName,
    name: userResult?.name,
    followersCount: userResult?.followersCount,
  };

  const fullText = legacy.fullText;

  // 引用内容
  let quoted = null;
  if (legacy.isQuoteStatus) { // 驼峰 isQuoteStatus
    const quotedResult = get(item, "raw.result.quoted_status_result") || get(item, "tweet.quoted_status_result");
    if (quotedResult) {
      const qLegacy = get(quotedResult, "result.legacy");
      const qUser = get(quotedResult, "result.core.user_results.result.legacy");
      if (qLegacy && qUser) {
        quoted = {
          screenName: qUser.screenName,
          fullText: qLegacy.fullText,
        };
      }
    }
  }

  // 媒体
  const mediaItems = get(legacy, "extendedEntities.media", []) || get(legacy, "entities.media", []);
  const images = mediaItems
    .filter((media: any) => media.type === "photo")
    .map((media: any) => media.mediaUrlHttps || media.media_url_https);

  const videos = mediaItems
    .filter((media: any) => media.type === "video" || media.type === "animated_gif")
    .map((media: any) => {
      const variants = get(media, "videoInfo.variants", []) || get(media, "video_info.variants", []);
      const bestQuality = variants
        .filter((v: any) => v.contentType === "video/mp4" || v.content_type === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return bestQuality?.url;
    })
    .filter(Boolean);

  // 🔥【关键修复】指标也全部换成驼峰 (favoriteCount)
  const currentMetrics = {
    likes: legacy.favoriteCount || legacy.favorite_count || 0,
    retweets: legacy.retweetCount || legacy.retweet_count || 0,
    replies: legacy.replyCount || legacy.reply_count || 0,
    quotes: legacy.quoteCount || legacy.quote_count || 0,
    bookmarks: legacy.bookmarkCount || legacy.bookmark_count || 0,
    // Views 比较顽固，可能在深层结构
    views: parseInt(get(rawResult, "views.count", "0")) || parseInt(get(item, "tweet.views.count", "0")) || 0
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

console.log(`✅ [Debug] Successfully processed ${newRows.length} tweets. (Skipped: ${skippedCount})`);

const outputPath = `./tweets/${dayjs().format("YYYY-MM-DD")}.json`;
let existingMap = new Map();

if (fs.existsSync(outputPath)) {
  try {
    const existingRows = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    existingRows.forEach((row: any) => existingMap.set(row.tweetUrl, row));
  } catch (e) {
    console.log("⚠️ Error reading existing file, starting fresh.");
  }
}

const currentTimeStr = dayjs().format("YYYY-MM-DD HH:mm");

newRows.forEach(newTweet => {
  const oldTweet = existingMap.get(newTweet.tweetUrl);
  
  let growth = { likes: 0, views: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 };
  let peakGrowth = { time: currentTimeStr, views: 0, likes: 0, bookmarks: 0, replies: 0 };

  if (oldTweet && oldTweet.peakGrowth) {
    peakGrowth = oldTweet.peakGrowth;
  }

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

const sortedRows = Array.from(existingMap.values()).sort((a: any, b: any) => {
  const idA = a.tweetUrl.split('/').pop() || '';
  const idB = b.tweetUrl.split('/').pop() || '';
  return idB.localeCompare(idA);
});

fs.writeFileSync(outputPath, JSON.stringify(sortedRows, null, 2));

console.log(`💾 Saved ${sortedRows.length} tweets to ${outputPath}`);
