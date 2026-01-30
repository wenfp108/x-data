import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import path from "path";

// 🛠️ 工具函数：递归查找 JSON 中的 rest_id 或 restId
const findRestId = (obj: any): string | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  if (obj.restId) return obj.restId;
  if (obj.rest_id) return obj.rest_id;
  for (const k of Object.keys(obj)) {
    if (typeof obj[k] === 'object') {
      const found = findRestId(obj[k]);
      if (found) return found;
    }
  }
  return undefined;
};

// 1. 读取目标名单
const loadTargets = () => {
  const accountPath = path.join(process.cwd(), "dev-accounts.json");
  if (!fs.existsSync(accountPath)) return [];
  const accounts = fs.readJSONSync(accountPath);
  
  const targets: { screenName: string; restId: string }[] = [];
  
  accounts.forEach((acc: any) => {
    if (!acc.twitter_url) return;
    const urlParts = acc.twitter_url.split('/');
    const screenName = urlParts[urlParts.length - 1].trim();
    
    const cachePath = path.join(process.cwd(), "accounts", `${screenName}.json`);
    if (fs.existsSync(cachePath)) {
      const cache = fs.readJSONSync(cachePath);
      const restId = findRestId(cache);

      if (restId) {
        targets.push({ screenName, restId });
      } else {
        console.error(`❌ [Error] File 'accounts/${screenName}.json' exists but no ID found.`);
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
      // 兼容两种结构
      const legacy = get(item, "content.itemContent.tweet_results.result.legacy") || 
                     get(item, "tweet.legacy"); 
      
      if (!legacy && item.content) return false; 
      
      const finalLegacy = legacy || item; 
      // 只要有一个日期字段存在即可
      if (!finalLegacy.created_at && !finalLegacy.createdAt) return false;

      const fullText = finalLegacy.fullText || finalLegacy.full_text || "";
      return !fullText.startsWith("RT @");
    }).map((item: any) => {
       // 尝试获取推文主体数据
       let tweetData = get(item, "content.itemContent.tweet_results.result") || item;
       
       // 🔥 关键兼容：如果 item.tweet 存在，说明是简化结构
       if (!tweetData.legacy && item.tweet) {
         tweetData = item.tweet;
       }

       const legacy = tweetData.legacy;
       if (!legacy) return null;

       // 🔥🔥 核心修复：用户信息的双重查找策略 🔥🔥
       // 策略 A: 尝试在推文深层结构找 (Raw GraphQL)
       let userResult = get(tweetData, "core.user_results.result.legacy");
       
       // 策略 B: 如果没找到，且 item 本身有 user 字段 (Library Simplified)
       if (!userResult && item.user && item.user.legacy) {
         userResult = item.user.legacy;
       }

       if (!userResult) return null;

       return { legacy, userResult };
    }).filter(Boolean);

    console.log(`   ✅ Got ${userTweets.length} tweets from @${target.screenName}`);

    // 处理每一条推文
    userTweets.forEach((data: any) => {
      const { legacy, userResult } = data;
      const createdAt = legacy.created_at || legacy.createdAt; 
      
      // 7天限制
      if (dayjs().diff(dayjs(createdAt), "day") > 7) return;

      const idStr = legacy.id_str || legacy.idStr;
      const tweetUrl = `https://x.com/${userResult.screenName || userResult.screen_name}/status/${idStr}`;

      const user = {
        screenName: userResult.screenName || userResult.screen_name,
        name: userResult.name,
        followersCount: userResult.followersCount || userResult.followers_count,
      };

      // 媒体
      const mediaArr = legacy.extended_entities?.media || legacy.entities?.media || legacy.extendedEntities?.media || [];
      const images = mediaArr.filter((m:any) => m.type === 'photo').map((m:any) => m.media_url_https || m.mediaUrlHttps);
      
      // 指标兼容
      const metrics = {
        likes: legacy.favorite_count || legacy.favoriteCount || 0,
        retweets: legacy.retweet_count || legacy.retweetCount || 0,
        replies: legacy.reply_count || legacy.replyCount || 0,
        quotes: legacy.quote_count || legacy.quoteCount || 0,
        bookmarks: legacy.bookmark_count || legacy.bookmarkCount || 0,
        views: parseInt(get(data, "views.count", "0")) || 0 
      };

      newRows.push({
        // @ts-ignore
        user,
        images,
        videos: [],
        tweetUrl,
        fullText: legacy.full_text || legacy.fullText,
        createdAt,
        metrics
      });
    });

    // 稍微休息一下
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
    const timeA = a.createdAt || a.created_at;
    const timeB = b.createdAt || b.created_at;
    return dayjs(timeB).diff(dayjs(timeA));
});

fs.writeFileSync(outputPath, JSON.stringify(sortedRows, null, 2));
console.log(`💾 Saved ${sortedRows.length} tweets to ${outputPath}`);
