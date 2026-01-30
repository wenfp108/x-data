import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import path from "path";

// ==========================================
// 🧠 策略配置中心 (Strategy Hub)
// ==========================================

const TAG_STRATEGIES: Record<string, number> = {
  "Noise": 1,
  "Meme": 2,
  "Crypto": 3,
  "Politics": 3,
  "Economy": 3,
  "General": 4,
  "Geopolitics": 5,
  "Finance": 5,
  "Tech": 5,
  "Science": 8
};

const getLimitByTags = (tags: string[] = []): number => {
  if (!tags || tags.length === 0) return TAG_STRATEGIES["General"];
  
  let minLimit = 99;
  let hasMatch = false;

  tags.forEach(tag => {
    const key = Object.keys(TAG_STRATEGIES).find(k => tag.includes(k));
    if (key) {
      const limit = TAG_STRATEGIES[key];
      if (limit < minLimit) minLimit = limit;
      hasMatch = true;
    }
  });

  return hasMatch ? minLimit : TAG_STRATEGIES["General"];
};

// ==========================================
// 🛠️ 基础工具函数
// ==========================================

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

const loadTargets = () => {
  const accountPath = path.join(process.cwd(), "dev-accounts.json");
  if (!fs.existsSync(accountPath)) return [];
  const accounts = fs.readJSONSync(accountPath);
  const targets: { screenName: string; restId: string; tags: string[] }[] = [];
  
  accounts.forEach((acc: any) => {
    if (!acc.twitter_url) return;
    const urlParts = acc.twitter_url.split('/');
    const screenName = urlParts[urlParts.length - 1].trim();
    const cachePath = path.join(process.cwd(), "accounts", `${screenName}.json`);
    if (fs.existsSync(cachePath)) {
      const cache = fs.readJSONSync(cachePath);
      const restId = findRestId(cache);
      if (restId) {
        targets.push({ 
            screenName, 
            restId,
            tags: acc.tags || []
        });
      }
    }
  });
  return targets;
};

// ==========================================
// 🚀 主程序
// ==========================================

const targets = loadTargets();
if (targets.length === 0) {
  console.error("❌ No targets found.");
  process.exit(1);
}

const todayPath = `./tweets/${dayjs().format("YYYY-MM-DD")}.json`;
const yesterdayPath = `./tweets/${dayjs().subtract(1, 'day').format("YYYY-MM-DD")}.json`;

// 🔥 修改点：将时间格式改为 年-月-日 时:分
const currentTimeStr = dayjs().format("YYYY-MM-DD HH:mm");

// 加载历史数据
let historyMap = new Map();
const loadIntoMap = (filePath: string) => {
  if (fs.existsSync(filePath)) {
    try {
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      rows.forEach((row: any) => historyMap.set(row.tweetUrl, row));
    } catch (e) {}
  }
};
loadIntoMap(yesterdayPath);
loadIntoMap(todayPath);

console.log(`🎯 狙击目标: ${targets.length} 人 (板块策略引擎启动)`);

const client = await XAuthClient();
const newRows: any[] = [];
const shuffledTargets = targets.sort(() => 0.5 - Math.random());
console.log(`🕒 预计耗时: ~${(shuffledTargets.length * 30 / 60).toFixed(1)} 分钟`);

for (const [index, target] of shuffledTargets.entries()) {
  const currentNum = index + 1;
  const limit = getLimitByTags(target.tags);
  
  console.log(`\n[${currentNum}/${shuffledTargets.length}] 📡 Fetching @${target.screenName} [Tags: ${target.tags.join(',') || 'General'} -> Limit: ${limit}]...`);
  
  try {
    const resp = await client.getTweetApi().getUserTweets({
      userId: target.restId,
      count: 40, 
      includePromotedContent: false 
    });

    const timeline = get(resp, "data.data", []);
    
    // 1. 提取与清洗
    let userTweets = timeline.map((item: any) => {
       let tweetData = get(item, "content.itemContent.tweet_results.result") || item;
       if (!tweetData.legacy && item.tweet) tweetData = item.tweet;
       const legacy = tweetData.legacy;
       if (!legacy) return null;
       let userResult = get(tweetData, "core.user_results.result.legacy");
       if (!userResult && item.user && item.user.legacy) userResult = item.user.legacy;
       if (!userResult) return null;
       return { legacy, userResult };
    }).filter(Boolean);

    // 2. 过滤时间窗口
    userTweets = userTweets.filter((t: any) => {
      const createdAt = t.legacy.created_at || t.legacy.createdAt;
      const tweetDate = dayjs(createdAt);
      const today = dayjs();
      return tweetDate.isSame(today, 'day') || tweetDate.isSame(today.subtract(1, 'day'), 'day');
    });

    // 3. 排序
    userTweets.sort((a: any, b: any) => {
      const viewA = parseInt(a.legacy.views?.count || "0") || 0;
      const viewB = parseInt(b.legacy.views?.count || "0") || 0;
      const likeA = a.legacy.favorite_count || 0;
      const likeB = b.legacy.favorite_count || 0;
      if (viewA > 0 || viewB > 0) return viewB - viewA;
      return likeB - likeA;
    });

    // 4. 动态截取
    const finalPicks = userTweets.slice(0, limit);
    console.log(`   ✅ Kept Top ${finalPicks.length} tweets.`);

    // 5. 处理数据
    finalPicks.forEach((data: any) => {
      const { legacy, userResult } = data;
      const createdAt = legacy.created_at || legacy.createdAt; 
      const idStr = legacy.id_str || legacy.idStr;
      const tweetUrl = `https://x.com/${userResult.screenName || userResult.screen_name}/status/${idStr}`;
      
      const metrics = {
        likes: legacy.favorite_count || legacy.favoriteCount || 0,
        retweets: legacy.retweet_count || legacy.retweetCount || 0,
        replies: legacy.reply_count || legacy.replyCount || 0,
        quotes: legacy.quote_count || legacy.quoteCount || 0,
        bookmarks: legacy.bookmark_count || legacy.bookmarkCount || 0,
        views: parseInt(legacy.views?.count || "0") || 0
      };

      // Growth & Peak Logic
      const oldTweet = historyMap.get(tweetUrl);
      let growth = { views: 0, likes: 0, retweets: 0, replies: 0 };
      let peak = { time: currentTimeStr, speed: 0 };

      if (oldTweet && oldTweet.peak) peak = oldTweet.peak;

      if (oldTweet && oldTweet.metrics) {
        const oldMetrics = oldTweet.metrics;
        growth = {
            views: (metrics.views || 0) - (oldMetrics.views || 0),
            likes: (metrics.likes || 0) - (oldMetrics.likes || 0),
            retweets: (metrics.retweets || 0) - (oldMetrics.retweets || 0),
            replies: (metrics.replies || 0) - (oldMetrics.replies || 0)
        };
        Object.keys(growth).forEach(k => { if ((growth as any)[k] < 0) (growth as any)[k] = 0; });
        if (growth.views > peak.speed) peak = { time: currentTimeStr, speed: growth.views };
      }

      newRows.push({
        tags: target.tags, 
        user: {
            screenName: userResult.screenName || userResult.screen_name,
            name: userResult.name,
            followersCount: userResult.followersCount || userResult.followers_count,
        },
        images: (legacy.extended_entities?.media || []).map((m:any) => m.media_url_https),
        tweetUrl,
        fullText: legacy.full_text || legacy.fullText,
        createdAt,
        metrics,
        growth, 
        peak    
      });
    });

  } catch (e) {
    console.error(`   ❌ Failed @${target.screenName}:`, e);
  }

  // Checkpoint Save
  if (currentNum % 5 === 0 || currentNum === shuffledTargets.length) {
    try {
        const tempSortedRows = [...newRows].sort((a: any, b: any) => {
             const viewA = a.metrics.views || 0;
             const viewB = b.metrics.views || 0;
             return viewB - viewA;
        });
        fs.outputJsonSync(todayPath, tempSortedRows, { spaces: 2 });
        console.log(`💾 [Checkpoint] Saved ${newRows.length} tweets.`);
    } catch (err) {}
  }

  // Sleep
  if (currentNum < shuffledTargets.length) {
    const delay = Math.floor(Math.random() * (40000 - 20000 + 1)) + 20000;
    console.log(`   ☕ Resting ${Math.round(delay / 1000)}s...`);
    await new Promise(r => setTimeout(r, delay));
  }
}

console.log("🚀 Sniper mission complete.");
