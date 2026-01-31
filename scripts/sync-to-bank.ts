import fs from 'fs';
import path from 'path';

// 1. 定义路径
// 脚本运行在 source_code/scripts/ 下，process.cwd() 是 source_code
const ROOT = process.cwd(); 
const TWEETS_DIR = path.resolve(ROOT, 'tweets'); 
const BANK_ROOT = path.resolve(ROOT, '../central_bank'); // 隔壁的中央银行库
const BANK_TARGET_DIR = path.join(BANK_ROOT, 'twitter'); // 🎯 目标锁定 /twitter/

async function syncLogic() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`🚀 Sync Target: Central-Bank/twitter/`);
  console.log(`📅 Date: ${today}`);

  // 2. 检查中央银行仓库是否被 Action 检出
  if (!fs.existsSync(BANK_ROOT)) {
    console.error("❌ Critical: 'central_bank' directory not found! (Check workflow paths)");
    process.exit(1);
  }

  // 3. 确保目标 /twitter/ 目录存在
  if (!fs.existsSync(BANK_TARGET_DIR)) {
    console.log(`🛠️ Creating directory: ${BANK_TARGET_DIR}`);
    fs.mkdirSync(BANK_TARGET_DIR, { recursive: true });
  }

  // 4. 开始同步
  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    let syncCount = 0;
    
    // 定义“新鲜度”：只同步最近 6 小时内修改过的文件
    // 这样能保证每次运行 Action，都会把刚生成的那个热乎文件拷过去
    const TIME_WINDOW_MS = 6 * 60 * 60 * 1000; 
    const now = Date.now();

    files.forEach(file => {
      // 只处理 json
      if (!file.endsWith('.json')) return;

      const src = path.join(TWEETS_DIR, file);
      const dest = path.join(BANK_TARGET_DIR, file);
      
      try {
        const stats = fs.statSync(src);
        const timeDiff = now - stats.mtimeMs;

        // 核心逻辑：
        // 1. 如果文件名包含今天的日期 (2024-xx-xx.json) -> 必选
        // 2. 如果文件修改时间在 6 小时内 -> 必选
        if (file.includes(today) || timeDiff < TIME_WINDOW_MS) {
             // 覆盖模式复制 (fs.constants.COPYFILE_FICLONE 是默认行为)
             // 这样中央银行里的文件就永远和 X-Kit 最新生成的一模一样
             fs.copyFileSync(src, dest);
             console.log(`✅ [Synced] ${file} -> /twitter/`);
             syncCount++;
        }
      } catch (e) {
        console.error(`❌ Error syncing ${file}:`, e);
      }
    });

    if (syncCount === 0) {
        console.log("⚠️ No fresh files found to sync.");
    } else {
        console.log(`🎉 Sync complete! Updated ${syncCount} file(s).`);
    }

  } else {
    console.log("📭 Local tweets dir is empty.");
  }
}

syncLogic().catch(console.error);
