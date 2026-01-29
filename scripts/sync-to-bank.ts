import fs from 'fs';
import path from 'path';

// 强制锁定绝对路径
const ROOT = process.cwd(); 
const TWEETS_DIR = path.resolve(ROOT, 'tweets');

// 修改后的目标路径：直接指向中央银行仓库下的 twitter/ 目录
const BANK_ROOT = path.resolve(ROOT, '../central_bank');
const BANK_TWEETS_PATH = path.join(BANK_ROOT, 'twitter');

async function syncLogic() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 服务器日期: ${today}`);
  console.log(`📂 新的目标路径: ${BANK_TWEETS_PATH}`);

  // 1. 确保目标目录存在
  if (!fs.existsSync(BANK_TWEETS_PATH)) {
    fs.mkdirSync(BANK_TWEETS_PATH, { recursive: true });
  }

  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    
    files.forEach(file => {
      // 逻辑：文件名日期 < 今天，则搬运归档
      if (file.endsWith('.json') && !file.includes(today)) {
        const src = path.join(TWEETS_DIR, file);
        const dest = path.join(BANK_TWEETS_PATH, file);
        
        console.log(`🚚 归档至新路径: ${file}`);
        fs.copyFileSync(src, dest);
        
        // 确认搬运成功后删除本地旧文件
        if (fs.existsSync(dest)) {
          fs.unlinkSync(src);
          console.log(`✅ 搬运完成: ${file}`);
        }
      }
    });
  }
}

syncLogic().catch(console.error);
