import { XAuthClient } from "./utils";
import { get } from "lodash";
import dayjs from "dayjs";
import fs from "fs-extra";
import path from "path";

// ==========================================
// 🛠️ 基础工具函数
// ==========================================

// 递归查找 rest_id (兼容各种深层结构)
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

// 读取目标列表
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
      if (restId) targets.push({ screenName, restId });
    }
  });
  return targets;
};

// ==========================================
// 🧠 核心逻辑：初始化与历史加载
// ==========================================

const targets = loadTargets();
if (targets.length === 0) {
  console.error("❌ No targets found.");
  process.exit(1);
}

const todayPath = `./tweets/${dayjs().format("YYYY-MM-DD")}.json`;
const yesterdayPath = `./tweets/${dayjs().subtract(1, 'day').format("YYYY-MM-DD")}.json`;
const currentTimeStr = dayjs().format("HH:mm");

// 1. 加载历史数据作为基准 (用于计算 Growth & Peak)
// 注意：我们在内存里加载一次，后续写入硬盘时不会影响这里的基准数据
let historyMap = new Map();

const loadIntoMap = (filePath: string) => {
  if (fs.existsSync(filePath)) {
    try {
      const rows = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      rows.forEach((row: any) => historyMap.set(row.tweetUrl, row));
      console.log(`📖 Loaded history baseline from ${path.basename(filePath)}`);
    } catch (e) {}
  }
};

// 先读昨天的，再读今天的 (确保基准是最新的)
loadIntoMap(yesterdayPath);
loadIntoMap(todayPath);

console.log(`🎯 狙击目标: ${targets.length} 人 (慢速轮询 + 实时存盘模式)`);

// ==========================================
// 🚀 执行循环
// ==========================================

const client = await XAuthClient();
const newRows: any[] = [];

// 随机打乱目标，避免由于固定顺序被识别为机器人
const shuffledTargets = targets.sort(() => 0.5 - Math.random());
console.log(`🕒 预计耗时: ~${(shuffledTargets.length * 30 / 60).toFixed(1)} 分钟`);

for (const [index, target] of shuffledTargets.entries()) {
  const currentNum = index + 1;
  console.log(`\n[${currentNum}/${shuffledTargets.length}] 📡 Fetching @${target.screenName}...`);
  
  try {
    const resp = await client.getTweetApi().getUserTweets({
      userId: target.restId,
      count: 40, // 抓取基数保持 40
      includePromotedContent: false 
    });

    const timeline = get(resp, "data.data", []);
    
    // 1. 初步提取与清洗
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

    // 2. 过滤：只保留【今天 + 昨天】的推文 (48小时窗口)
    userTweets = userTweets.filter((t: any) => {
      const createdAt = t.legacy.created_at || t.legacy.createdAt;
      const tweetDate = dayjs(createdAt);
      const today = dayjs();
      return tweetDate.isSame(today, 'day') || tweetDate.isSame(today.subtract(1, 'day'), 'day');
    });

    // 3. 排序：按浏览量排序
    userTweets.sort((a: any, b: any) => {
      const viewA = parseInt(a.legacy.views?.count || "0") || 0;
      const viewB = parseInt(b.legacy.views?.count || "0") || 0;
      const likeA = a.legacy.favorite_count || 0;
      const likeB = b.legacy.favorite_count || 0;
      if (viewA > 0 || viewB > 0) return viewB - viewA;
      return likeB - likeA;
    });

    // 4. 截取 Top 3
    const top3 = userTweets.slice(0, 3);
    console.log(`   ✅ Kept Top ${top3.length} hot tweets.`);

    // 5. 处理数据并计算 Growth/Peak
    top3.forEach((data: any) => {
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

      // --- Growth & Peak 计算 ---
      const oldTweet = historyMap.get(tweetUrl);
      let growth = { views: 0, likes: 0, retweets: 0, replies: 0 };
      let peak = { time: currentTimeStr, speed: 0 };

      // 继承旧 Peak
      if (oldTweet && oldTweet.peak) {
        peak = oldTweet.peak;
      }

      // 计算增量
      if (oldTweet && oldTweet.metrics) {
        const oldMetrics = oldTweet.metrics;
        growth = {
            views: (metrics.views || 0) - (oldMetrics.views || 0),
            likes: (metrics.likes || 0) - (oldMetrics.likes || 0),
            retweets: (metrics.retweets || 0) - (oldMetrics.retweets || 0),
            replies: (metrics.replies || 0) - (oldMetrics.replies || 0)
        };
        // 修正负数
        Object.keys(growth).forEach(k => { if ((growth as any)[k] < 0) (growth as any)[k] = 0; });

        // 更新 Peak
        if (growth.views > peak.speed) {
            peak = { time: currentTimeStr, speed: growth.views };
        }
      }

      newRows.push({
        user: {
            screenName: userResult.screenName || userResult.screen_name,
            name: userResult.name,
            followersCount: userResult.followersCount || userResult.followers_count,
        },
        images: (legacy.extended_entities?.media || []).map((m:any) => m.media_url_https),
        videos: [],
        tweetUrl,
        fullText: legacy.full_text || legacy.fullText,
        createdAt,
        metrics,
        growth, // 挂载增量数据
        peak    // 挂载峰值数据
      });
    });

  } catch (e) {
    console.error(`   ❌ Failed @${target.screenName}:`, e);
  }

  // ==========================================
  // 💾 实时存盘 (Checkpoint Save)
  // ==========================================
  // 每处理 5 个人，或者处理完最后一个人，立即写入硬盘
  if (currentNum % 5 === 0 || currentNum === shuffledTargets.length) {
    try {
        // 按热度总榜排序 (让最火的排在文件最前面)
        const tempSortedRows = [...newRows].sort((a: any, b: any) => {
             const viewA = a.metrics.views || 0;
             const viewB = b.metrics.views || 0;
             return viewB - viewA;
        });
        
        fs.outputJsonSync(todayPath, tempSortedRows, { spaces: 2 });
        console.log(`💾 [Checkpoint] Saved ${newRows.length} tweets to ${todayPath}`);
    } catch (err) {
        console.error("   ⚠️ Save failed:", err);
    }
  }

  // ==========================================
  // ☕ 慢速等待 (Slow Polling)
  // ==========================================
  // 如果不是最后一个人，随机休息 20s - 40s
  if (currentNum < shuffledTargets.length) {
    const delay = Math.floor(Math.random() * (40000 - 20000 + 1)) + 20000;
    console.log(`   ☕ Resting for ${Math.round(delay / 1000)}s...`);
    await new Promise(r => setTimeout(r, delay));
  }
}

console.log("🚀 Sniper mission complete.");
