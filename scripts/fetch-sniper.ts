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
    const screenName = urlParts[urlParts.length - 1];
    
    // 尝试从缓存文件读取 rest_id (userId)
    // 必须先运行 bun run scripts/index.ts 生成这些文件
    const cachePath = path.join(process.cwd(), "accounts", `${screenName}.json`);
    if (fs.existsSync(cachePath)) {
      const cache = fs.readJSONSync(cachePath);
      // 兼容不同位置的 rest_id
      const restId = cache.rest_id || get(cache, "data.user.result.rest_id");
      if (restId) {
        targets.push({ screenName, restId });
      } else {
        console.warn(`⚠️ [Warning] No ID found for ${screenName}. Run 'bun run scripts/index.ts' first.`);
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
      count: 40, // 抓最近40条，足够覆盖几天了
      includePromotedContent: false 
    });

    const timeline = get(resp, "data.data", []);
    
    // 过滤 + 提取
    const userTweets = timeline.filter((item: any) => {
      const legacy = get(item, "content.itemContent.tweet_results.result.legacy") || // UserTweets 接口结构可能略有不同
                     get(item, "tweet.legacy"); 
      
      // 兼容 getUserTweets 的复杂返回结构 (它返回的是 Timeline 指令)
      if (!legacy && item.content) return false; 
      
      // 有些返回是单纯的 tweet 对象
      const finalLegacy = legacy || item; 
      if (!finalLegacy.created_at && !finalLegacy.createdAt) return false;

      const fullText = finalLegacy.fullText || finalLegacy.full_text || "";
      return !fullText.startsWith("RT @");
    }).map((item: any) => {
       // 统一提取逻辑 (UserTweets 接口返回的数据结构很深)
       let tweetData = get(item, "content.itemContent.tweet_results.result") || item;
       
       // 如果是引用推文，结构可能在 tweet 字段里
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
      const { legacy, userResult, restId } = data;
      const createdAt = legacy.created_at; // UserTweets 接口通常是下划线
      
      // 7天限制
      if (dayjs().diff(dayjs(createdAt), "day") > 7) return;

      const idStr = legacy.id_str;
      const tweetUrl = `https://x.com/${userResult.screen_name}/status/${idStr}`;

      const user = {
        screenName: userResult.screen_name,
        name: userResult.name,
        followersCount: userResult.followers_count,
      };

      // 提取引用
      let quoted = null;
      if (legacy.is_quote_status) {
        const quotedResult = tweetData.quoted_status_result; // 注意作用域，这里简化处理
        // UserTweets 里的引用提取较复杂，暂且略过或复用之前的逻辑
      }

      // 媒体 (兼容)
      const mediaArr = legacy.extended_entities?.media || legacy.entities?.media || [];
      const images = mediaArr.filter((m:any) => m.type === 'photo').map((m:any) => m.media_url_https);
      
      const metrics = {
        likes: legacy.favorite_count || 0,
        retweets: legacy.retweet_count || 0,
        replies: legacy.reply_count || 0,
        quotes: legacy.quote_count || 0,
        bookmarks: legacy.bookmark_count || 0,
        views: parseInt(get(tweetData, "views.count", "0")) || 0
      };

      newRows.push({
        // @ts-ignore
        user,
        images,
        videos: [], // 简化，暂不提取视频
        tweetUrl,
        fullText: legacy.full_text,
        createdAt,
        metrics
      });
    });

    // 稍微休息一下，对服务器友好点
    await new Promise(r => setTimeout(r, 2000));

  } catch (e) {
    console.error(`   ❌ Failed to fetch @${target.screenName}:`, e);
  }
}

// 3. 保存逻辑 (复用之前的)
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
    // 计算增量逻辑同上...
    growth = {
        likes: newTweet.metrics.likes - (oldTweet.metrics.likes || 0),
        views: newTweet.metrics.views - (oldTweet.metrics.views || 0),
        retweets: newTweet.metrics.retweets - (oldTweet.metrics.retweets || 0),
        replies: newTweet.metrics.replies - (oldTweet.metrics.replies || 0),
        quotes: newTweet.metrics.quotes - (oldTweet.metrics.quotes || 0),
        bookmarks: newTweet.metrics.bookmarks - (oldTweet.metrics.bookmarks || 0),
    };
    // 修正负数
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
    return b.createdAt.localeCompare(a.createdAt);
});

fs.writeFileSync(outputPath, JSON.stringify(sortedRows, null, 2));
console.log(`💾 Saved ${sortedRows.length} tweets to ${outputPath}`);
