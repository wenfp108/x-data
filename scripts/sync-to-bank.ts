import fs from 'fs';
import path from 'path';

// 1. 配置路径
const TWEETS_DIR = './tweets';
const ACCOUNTS_DIR = './accounts';
const BANK_TWEETS_PATH = './central_bank/bank/x-twitter/tweets';
const BANK_ACCOUNTS_PATH = './central_bank/bank/x-twitter/accounts';

async function syncLogic() {
  // 获取服务器当前日期 (例如 "2026-01-30")
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 服务器今日日期: ${today}`);

  // 2. 确保中央银行的目标目录存在
  [BANK_TWEETS_PATH, BANK_ACCOUNTS_PATH].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

  // 3. 处理 Tweets：精准搬运非今日文件
  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    files.forEach(file => {
      // 只要是 JSON 且文件名不包含今天的日期，就搬走归档
      if (file.endsWith('.json') && !file.includes(today)) {
        const src = path.join(TWEETS_DIR, file);
        const dest = path.join(BANK_TWEETS_PATH, file);
        
        fs.copyFileSync(src, dest); // 拷贝到银行
        fs.unlinkSync(src);         // 从本地删除，不销毁文件夹
        console.log(`✅ 已收割旧数据至中央银行: ${file}`);
      }
    });
  }

  // 4. 处理 Accounts：全量同步账号信息
  if (fs.existsSync(ACCOUNTS_DIR)) {
    const accounts = fs.readdirSync(ACCOUNTS_DIR);
    accounts.forEach(file => {
      if (file.endsWith('.json')) {
        fs.copyFileSync(path.join(ACCOUNTS_DIR, file), path.join(BANK_ACCOUNTS_PATH, file));
      }
    });
    console.log(`✅ 账号元数据同步完毕。`);
  }
}

syncLogic().catch(console.error);
