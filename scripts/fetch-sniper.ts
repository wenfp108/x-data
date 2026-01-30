import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import path from "path";

// 🛠️ 工具函数：递归查找 JSON 中的 rest_id 或 restId
// 不管它藏在第几层，也不管是驼峰还是下划线，只要有就能找到
const findRestId = (obj: any): string | undefined => {
  if (!obj || typeof obj !== 'object') return undefined;
  
  // 1. 优先检查当前层级
  if (obj.restId) return obj.restId;
  if (obj.rest_id) return obj.rest_id;
  
  // 2. 递归查找子属性
  for (const k of Object.keys(obj)) {
    // 避免死循环，只处理对象
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
    
    // 读取缓存文件
    const cachePath = path.join(process.cwd(), "accounts", `${screenName}.json`);
    if (fs.existsSync(cachePath)) {
      const cache = fs.readJSONSync(cachePath);
      
      // 🔥 核心修复：使用智能查找函数
      const restId = findRestId(cache);

      if (restId) {
        targets.push({ screenName, restId });
      } else {
        console.error(`❌ [Error] File 'accounts/${screenName}.json' exists but no ID found.`);
        // 调试用：如果找不到，打印文件内容前100个字符
        console.log("👇 File preview:", JSON.stringify(cache).substring(0, 100));
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
      
      // 兼容直接返回 tweet 对象的情况
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

       return { legacy, userResult };
    }).filter(Boolean);

    console.log(`   ✅ Got ${userTweets.length} tweets from @${target.screenName}`);

    // 处理每一条推文
    userTweets.forEach((data: any) => {
      const { legacy, userResult } = data;
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
        views: parseInt(get(data, "views.count", "0")) || 0 
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
    // 兼容可能的时间格式差异
    const timeA = a.createdAt || a.created_at;
    const timeB = b.createdAt || b.created_at;
    return dayjs(timeB).diff(dayjs(timeA));
});

fs.writeFileSync(outputPath, JSON.stringify(sortedRows, null, 2));
console.log(`💾 Saved ${sortedRows.length} tweets to ${outputPath}`);
