import fs from 'fs';
import path from 'path';

const ROOT = process.cwd(); 
const TWEETS_DIR = path.resolve(ROOT, 'tweets');
const BANK_ROOT = path.resolve(ROOT, '../central_bank');
const BANK_TWEETS_PATH = path.join(BANK_ROOT, 'twitter');

async function syncLogic() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 服务器日期: ${today}`);

  // 1. 确保目标银行目录存在
  if (!fs.existsSync(BANK_TWEETS_PATH)) {
    fs.mkdirSync(BANK_TWEETS_PATH, { recursive: true });
  }

  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    
    files.forEach(file => {
      // ⭐ 核心修改：只提取 .json 文件，且排除当天的活跃文件
      if (file.endsWith('.json') && !file.includes(today)) {
        const src = path.join(TWEETS_DIR, file);
        const dest = path.join(BANK_TWEETS_PATH, file);
        
        console.log(`🚚 归档 JSON: ${file}`);
        fs.copyFileSync(src, dest);
        
        if (fs.existsSync(dest)) {
          fs.unlinkSync(src);
          console.log(`✅ 已搬运并清理: ${file}`);
        }
      } else {
        // 如果是 .gitkeep 或当天文件，脚本会跳过，保持文件夹存在
        console.log(`🛡️ 保持原地: ${file}`);
      }
    });
  }
}

syncLogic().catch(console.error);
