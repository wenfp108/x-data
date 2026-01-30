import fs from 'fs';
import path from 'path';

const ROOT = process.cwd(); 
const TWEETS_DIR = path.resolve(ROOT, 'tweets');
const BANK_ROOT = path.resolve(ROOT, '../central_bank');
const BANK_TWEETS_PATH = path.join(BANK_ROOT, 'twitter');

async function syncLogic() {
  // 获取服务器当前日期 (UTC时间)
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 Sync Date: ${today}`);

  if (!fs.existsSync(BANK_TWEETS_PATH)) {
    fs.mkdirSync(BANK_TWEETS_PATH, { recursive: true });
  }

  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    
    files.forEach(file => {
      // 过滤非 JSON 文件和 .gitkeep
      if (!file.endsWith('.json')) return;

      const src = path.join(TWEETS_DIR, file);
      const dest = path.join(BANK_TWEETS_PATH, file);
      
      try {
        if (file.includes(today)) {
          // ==============================
          // 🔥 策略 A: 今天的文件 -> 实时同步 (Copy)
          // ==============================
          // 我们只复制过去，不删除本地文件。
          // 这样 fetch-sniper 下次运行时，还能读取本地文件来计算 Growth。
          fs.copyFileSync(src, dest);
          console.log(`🔄 [Sync] Updated today's snapshot: ${file}`);
        } else {
          // ==============================
          // 📦 策略 B: 历史文件 -> 归档收割 (Move)
          // ==============================
          // 昨天的文件已经定型了，直接剪切带走，清理本地空间。
          // 如果目标已存在（比如昨天同步过），直接覆盖
          fs.copyFileSync(src, dest); 
          fs.unlinkSync(src); // 删除源文件
          console.log(`🚚 [Archive] Moved old file: ${file}`);
        }
      } catch (e) {
        console.error(`❌ Error syncing ${file}:`, e);
      }
    });
  } else {
    console.log("📭 Local tweets directory is empty, nothing to harvest.");
  }
}

syncLogic().catch(console.error);
