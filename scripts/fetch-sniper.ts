import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import path from "path";

// ==========================================
// 🧠 策略配置中心 (Strategy Hub)
// ==========================================

// 定义不同板块的“保留条数” (Limit)
// 逻辑：数字越小，代表该板块“噪音”越大，或者需要更严格的精选
const TAG_STRATEGIES: Record<string, number> = {
  // --- 🔴 高噪区 (严格限制 Top 3) ---
  "Politics": 3,    // 🏛️ 政治：口水战多，只看前 3 条核心
  "Economy": 3,     // 📉 经济：数据发布时太密集，只看前 3 条核心数据
  "Crypto": 3,      // ₿ 虚拟币：噪音之王，严格限制 Top 3 (防表情包刷屏)
  
  // --- 🟡 中信噪比 (保留 Top 5) ---
  "Geopolitics": 5, // 🌍 地缘：突发性强，一旦打仗需要多看几条
  "Finance": 5,     // 💰 金融：图表和分析较多，值得多留几条
  "Tech": 5,        // 🚀 科技：干货多，发布会/论文需要覆盖

  // --- 🟢 净土区 (全量/高保留) ---
  "Science": 8,     // 🔬 科学：极低频，全是干货。设为 8 约等于全量保留。

  // --- 🛡️ 特殊策略 ---
  "Meme": 2,        // 🤡 搞笑/梗图：只留 2 条看个乐
  "Noise": 1,       // 🔇 纯噪点：只留 1 条
  "General": 4      // 👤 默认：留 4 条
};

// 核心算法：根据用户的 tags 计算 limit
// 规则：取所有 tag 中【限制最严】(数值最小) 的那个
// 举例：如果一个人既是 "Tech"(5) 又是 "Crypto"(3)，最终取 3。因为币圈属性会带来高噪音。
const getLimitByTags = (tags: string[] = []): number => {
  if (!tags || tags.length === 0) return TAG_STRATEGIES["General"];
  
  let minLimit = 99;
  let hasMatch = false;

  tags.forEach(tag => {
    // 模糊匹配 (例如 tags 写 "US_Politics" 也能命中 "Politics")
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

// 读取目标 (支持 tags)
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
            tags: acc.tags || [] // 读取 tags
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
const currentTimeStr = dayjs().format("HH:mm");

// 加载历史数据作为基准
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
// 随机打乱，模拟真人操作
const shuffledTargets = targets.sort(() => 0.5 - Math.random());
console.log(`🕒 预计耗时: ~${(shuffledTargets.length * 30 / 60).toFixed(1)} 分钟`);

for (const [index, target] of shuffledTargets.entries()) {
  const currentNum = index + 1;
  // 🔥 计算当前用户的动态限制
  const limit = getLimitByTags(target.tags);
  
  console.log(`\n[${currentNum}/${shuffledTargets.length}] 📡 Fetching @${target.screenName} [Tags: ${target.tags.join(',') || 'General'} -> Limit: ${limit}]...`);
  
  try {
    const resp = await client.getTweetApi().getUserTweets({
      userId: target.restId,
      count: 40, // 抓取基数保持 40，确保不漏
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

    // 2. 过滤时间窗口 (48h)
    userTweets = userTweets.filter((t: any) => {
      const createdAt = t.legacy.created_at || t.legacy.createdAt;
      const tweetDate = dayjs(createdAt);
      const today = dayjs();
      return tweetDate.isSame(today, 'day') || tweetDate.isSame(today.subtract(1, 'day'), 'day');
    });

    // 3. 排序 (按热度: Views > Likes)
    userTweets.sort((a: any, b: any) => {
      const viewA = parseInt(a.legacy.views?.count || "0") || 0;
      const viewB = parseInt(b.legacy.views?.count || "0") || 0;
      const likeA = a.legacy.favorite_count || 0;
      const likeB = b.legacy.favorite_count || 0;
      if (viewA > 0 || viewB > 0) return viewB - viewA;
      return likeB - likeA;
    });

    // 4. 🔥 动态截取 (应用策略)
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
        tags: target.tags, // ✅ 写入标签，前端可用于分类
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

  // Checkpoint Save & Sleep
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

  if (currentNum < shuffledTargets.length) {
    const delay = Math.floor(Math.random() * (40000 - 20000 + 1)) + 20000;
    console.log(`   ☕ Resting ${Math.round(delay / 1000)}s...`);
    await new Promise(r => setTimeout(r, delay));
  }
}

console.log("🚀 Sniper mission complete.");
