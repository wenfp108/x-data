import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import type { TweetApiUtilsData } from "twitter-openapi-typescript";

const client = await XAuthClient();

const resp = await client.getTweetApi().getHomeLatestTimeline({
  count: 100,
});

// 过滤出原创推文
const originalTweets = resp.data.data.filter((tweet) => {
  return !tweet.referenced_tweets || tweet.referenced_tweets.length === 0;
});

const rows: TweetApiUtilsData[] = [];
// 输出所有原创推文的访问地址
originalTweets.forEach((tweet) => {
  const isQuoteStatus = get(tweet, "raw.result.legacy.isQuoteStatus");
  if (isQuoteStatus) {
    return;
  }
  const fullText = get(tweet, "raw.result.legacy.fullText", "RT @");
  if (fullText?.includes("RT @")) {
    return;
  }
  const createdAt = get(tweet, "raw.result.legacy.createdAt");
  // return if more than 1 days
  if (dayjs().diff(dayjs(createdAt), "day") > 1) {
    return;
  }
  const screenName = get(tweet, "user.legacy.screenName");
  const tweetUrl = `https://x.com/${screenName}/status/${get(
    tweet,
    "raw.result.legacy.idStr"
  )}`;
  
  // 🔥【优化】只保留核心身份数据，去除污染
  const user = {
    screenName: get(tweet, "user.legacy.screenName"),
    name: get(tweet, "user.legacy.name"),
    // profileImageUrl: ... // 🗑️ 已移除：冗余
    // description: ... // 🗑️ 已移除：冗余
    followersCount: get(tweet, "user.legacy.followersCount"), // ✅ 保留：用于计算权重
    // friendsCount: ... // 🗑️ 已移除：噪音
    // location: ... // 🗑️ 已移除：噪音
  };

  // 提取图片
  const mediaItems = get(tweet, "raw.result.legacy.extendedEntities.media", []);
  const images = mediaItems
    .filter((media: any) => media.type === "photo")
    .map((media: any) => media.mediaUrlHttps);

  // 提取视频
  const videos = mediaItems
    .filter(
      (media: any) => media.type === "video" || media.type === "animated_gif"
    )
    .map((media: any) => {
      const variants = get(media, "videoInfo.variants", []);
      const bestQuality = variants
        .filter((v: any) => v.contentType === "video/mp4")
        .sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      return bestQuality?.url;
    })
    .filter(Boolean);

  // 提取互动数据
  const favoriteCount = get(tweet, "raw.result.legacy.favorite_count", 0);
  const retweetCount = get(tweet, "raw.result.legacy.retweet_count", 0);
  const replyCount = get(tweet, "raw.result.legacy.reply_count", 0);
  const viewCount = get(tweet, "raw.result.views.count", "0");

  rows.push({
    // @ts-ignore
    user,
    images,
    videos,
    tweetUrl,
    fullText,
    createdAt,
    metrics: {
      likes: favoriteCount,
      retweets: retweetCount,
      replies: replyCount,
      views: viewCount
    }
  });
});

const outputPath = `./tweets/${dayjs().format("YYYY-MM-DD")}.json`;
let existingRows: TweetApiUtilsData[] = [];

// 如果文件存在，读取现有内容
if (fs.existsSync(outputPath)) {
  existingRows = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
}

// 合并现有数据和新数据
const allRows = [...existingRows, ...rows];

// 通过 tweetUrl 去重
const uniqueRows = Array.from(
  new Map(allRows.map(row => [row.tweetUrl, row])).values()
);

// 按照 createdAt 倒序排序
const sortedRows = uniqueRows.sort((a, b) => {
  const urlA = new URL(a.tweetUrl);
  const urlB = new URL(b.tweetUrl);
  const idA = urlA.pathname.split('/').pop() || '';
  const idB = urlB.pathname.split('/').pop() || '';
  return idB.localeCompare(idA);
});

fs.writeFileSync(
  outputPath,
  JSON.stringify(sortedRows, null, 2)
);
