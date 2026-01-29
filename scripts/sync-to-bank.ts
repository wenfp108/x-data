import fs from 'fs';
import path from 'path';

// 定义路径
const TWEETS_DIR = './tweets';
const ACCOUNTS_DIR = './accounts';
const BANK_TWEETS_PATH = './central_bank/bank/x-twitter/tweets';
const BANK_ACCOUNTS_PATH = './central_bank/bank/x-twitter/accounts';

async function syncLogic() {
  // 获取服务器今天的日期，例如 "2026-01-30"
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 当前日期: ${today}`);

  // 1. 确保目标银行目录存在 (mkdir -p 逻辑)
  [BANK_TWEETS_PATH, BANK_ACCOUNTS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // 2. 处理 Tweets 文件夹：只搬运旧文件
  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    files.forEach(file => {
      // 如果文件名（如 2026-01-29.json）小于今天，则同步并删除
      if (file.endsWith('.json') && file < today) {
        const src = path.join(TWEETS_DIR, file);
        const dest = path.join(BANK_TWEETS_PATH, file);
        
        fs.copyFileSync(src, dest);
        fs.unlinkSync(src); // 只删除这个旧文件，不影响文件夹
        console.log(`✅ 已归档旧数据并从本地移除: ${file}`);
      }
    });
  }

  // 3. 处理 Accounts 文件夹：同步所有账号元数据
  if (fs.existsSync(ACCOUNTS_DIR)) {
    const accounts = fs.readdirSync(ACCOUNTS_DIR);
    accounts.forEach(file => {
      if (file.endsWith('.json')) {
        fs.copyFileSync(path.join(ACCOUNTS_DIR, file), path.join(BANK_ACCOUNTS_PATH, file));
        // 账号文件建议保留在本地供抓取脚本参考，不一定要 unlink
      }
    });
    console.log(`✅ 账号元数据已同步。`);
  }
}

syncLogic().catch(console.error);
