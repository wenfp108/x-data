import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import path from "path";

// 1. 读取目标名单
const loadTargets = () => {
  const accountPath = path.join(process.cwd(), "dev-accounts.json");
  if (!fs.existsSync(accountPath)) return [];
  const accounts = fs.readJSONSync(accountPath);
  
  const targets: { screenName: string; restId: string }[] = [];
  
  accounts.forEach((acc: any) => {
    if (!acc.twitter_url) return;
    const urlParts = acc.twitter_url.split('/');
    const screenName = urlParts[urlParts.length - 1].trim(); // Trim 一下防止空格
    
    // 尝试从缓存文件读取 rest_id
    const cachePath = path.join(process.cwd(), "accounts", `${screenName}.json`);
    if (fs.existsSync(cachePath)) {
      const cache = fs.readJSONSync(cachePath);
      
      // 🔥 核心修复：增加 cache.result.rest_id 路径兼容
      const restId = cache.rest_id || 
                     get(cache, "result.rest_id") || 
                     get(cache, "data.user.result.rest_id");

      if (restId) {
        targets.push({ screenName, restId });
      } else {
        console.warn(`⚠️ [Warning] No ID found in cache for ${screenName}. (Path check failed)`);
        // 调试用：打印一下结构看看
        // console.log("Cache structure keys:", Object.keys(cache));
      }
    } else {
      console.warn(`⚠️ [Warning] Cache missing for ${screenName}. Run 'bun run scripts/index.ts' first.`);
    }
  });
  
  return targets;
};

const targets = loadTargets();
if (targets.length === 0) {
  console.error("❌ No targets found. Please check dev-accounts.json and run scripts/index.ts");
  process.exit(1);
}

console.log(`🎯 Sniper Targets: ${targets.map(t => t.screenName).join(", ")}`);

const client = await XAuthClient();
const newRows: any[] = [];

// 2. 逐个狙击 (Active Fetch)
for (const target of targets) {
  console.log(`📡 Fetching tweets for @${target.screenName} (ID: ${target.restId})...`);
  
  try {
    const resp = await client.getTweetApi().getUserTweets({
      userId: target.restId,
      count: 40, 
      includePromotedContent: false 
    });

    const timeline = get(resp, "data.data", []);
    
    // 过滤 + 提取
    const userTweets = timeline.filter((item: any) => {
      const legacy = get(item, "content.itemContent.tweet_results.result.legacy") || 
                     get(item, "tweet.legacy"); 
      
      if (!legacy && item.content) return false; 
      
      const finalLegacy = legacy || item; 
      if (!finalLegacy.created_at && !finalLegacy.createdAt) return false;

      const fullText = finalLegacy.fullText || finalLegacy.full_text || "";
      return !fullText.startsWith("RT @");
    }).map((item: any) => {
       let tweetData = get(item, "content.itemContent.tweet_results.result") || item;
       
       if (!tweetData.legacy && item.tweet) tweetData = item.tweet;

       const legacy = tweetData.legacy;
       if (!legacy) return null;

       const userResult = get(tweetData, "core.user_results.result.legacy");
       if (!userResult) return null;

       return { legacy, userResult, restId: get(tweetData, "rest_id") };
    }).filter(Boolean);

    console.log(`   ✅ Got ${userTweets.length} tweets from @${target.screenName}`);

    // 处理每一条推文
    userTweets.forEach((data: any) => {
      const { legacy, userResult } = data; // restId 未使用可省略
      const createdAt = legacy.created_at; 
      
      // 7天限制
      if (dayjs().diff(dayjs(createdAt), "day") > 7) return;

      const idStr = legacy.id_str;
      const tweetUrl = `https://x.com/${userResult.screen_name}/status/${idStr}`;

      const user = {
        screenName: userResult.screen_name,
        name: userResult.name,
        followersCount: userResult.followers_count,
      };

      // 媒体
      const mediaArr = legacy.extended_entities?.media || legacy.entities?.media || [];
      const images = mediaArr.filter((m:any) => m.type === 'photo').map((m:any) => m.media_url_https);
      
      const metrics = {
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        quotes: legacy.quote_count || 0,
        bookmarks: legacy.bookmark_count || 0,
        views: parseInt(get(data, "views.count", "0")) || 0 // 注意这里的 views 路径可能需要根据实际数据调整，暂且这么写
      };

      newRows.push({
        // @ts-ignore
        user,
        images,
        videos: [],
        tweetUrl,
        fullText: legacy.full_text,
        createdAt,
        metrics
      });
    });

    await new Promise(r => setTimeout(r, 2000));

  } catch (e) {
    console.error(`   ❌ Failed to fetch @${target.screenName}:`, e);
  }
}

// 3. 保存逻辑
const outputPath = `./tweets/${dayjs().format("YYYY-MM-DD")}.json`;
let existingMap = new Map();

if (fs.existsSync(outputPath)) {
  try {
    const existingRows = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    existingRows.forEach((row: any) => existingMap.set(row.tweetUrl, row));
  } catch (e) {}
}

const currentTimeStr = dayjs().format("YYYY-MM-DD HH:mm");

newRows.forEach(newTweet => {
  const oldTweet = existingMap.get(newTweet.tweetUrl);
  let growth = { likes: 0, views: 0, retweets: 0, replies: 0, quotes: 0, bookmarks: 0 };
  let peakGrowth = { time: currentTimeStr, views: 0, likes: 0, bookmarks: 0, replies: 0 };

  if (oldTweet && oldTweet.peakGrowth) peakGrowth = oldTweet.peakGrowth;

  if (oldTweet && oldTweet.metrics) {
    growth = {
        likes: newTweet.metrics.likes - (oldTweet.metrics.likes || 0),
        views: newTweet.metrics.views - (oldTweet.metrics.views || 0),
        retweets: newTweet.metrics.retweets - (oldTweet.metrics.retweets || 0),
        replies: newTweet.metrics.replies - (oldTweet.metrics.replies || 0),
        quotes: newTweet.metrics.quotes - (oldTweet.metrics.quotes || 0),
        bookmarks: newTweet.metrics.bookmarks - (oldTweet.metrics.bookmarks || 0),
    };
    Object.keys(growth).forEach(k => { if ((growth as any)[k] < 0) (growth as any)[k] = 0; });
    
    if (growth.views > peakGrowth.views) {
        peakGrowth = { time: currentTimeStr, ...growth };
    }
  }

  newTweet.growth = growth;
  newTweet.peakGrowth = peakGrowth;
  existingMap.set(newTweet.tweetUrl, newTweet);
});

const sortedRows = Array.from(existingMap.values()).sort((a: any, b: any) => {
    // 兼容 created_at (下划线) 和 createdAt (驼峰)
    const timeA = a.createdAt || a.created_at;
    const timeB = b.createdAt || b.created_at;
    return dayjs(timeB).diff(dayjs(timeA));
});

fs.writeFileSync(outputPath, JSON.stringify(sortedRows, null, 2));
console.log(`💾 Saved ${sortedRows.length} tweets to ${outputPath}`);
