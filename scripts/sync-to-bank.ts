import fs from 'fs';
import path from 'path';

const ROOT = process.cwd(); 
const TWEETS_DIR = path.resolve(ROOT, 'tweets');
const BANK_ROOT = path.resolve(ROOT, '../central_bank');
const BANK_TWEETS_PATH = path.join(BANK_ROOT, 'twitter');

async function syncLogic() {
  const today = new Date().toISOString().split('T')[0];
  // 计算昨天日期的字符串 (简单处理)
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  
  console.log(`📅 Sync Date: ${today}`);

  if (!fs.existsSync(BANK_TWEETS_PATH)) {
    fs.mkdirSync(BANK_TWEETS_PATH, { recursive: true });
  }

  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    
    files.forEach(file => {
      if (!file.endsWith('.json')) return;

      const src = path.join(TWEETS_DIR, file);
      const dest = path.join(BANK_TWEETS_PATH, file);
      
      try {
        // 1. 无论什么文件，先同步到 Bank (覆盖旧的以防万一)
        fs.copyFileSync(src, dest);
        
        // 2. 清理逻辑：只删除“非今天”且“非昨天”的文件
        // 这样可以保留昨天的数据用于计算 Growth
        if (file.includes(today) || file.includes(yesterday)) {
           console.log(`🔄 [Sync Only] Kept active file: ${file}`);
        } else {
           fs.unlinkSync(src); // 删除更早的文件
           console.log(`🚚 [Archive] Moved & Deleted old file: ${file}`);
        }
      } catch (e) {
        console.error(`❌ Error syncing ${file}:`, e);
      }
    });
  } else {
    console.log("📭 Local tweets directory is empty.");
  }
}

syncLogic().catch(console.error);
