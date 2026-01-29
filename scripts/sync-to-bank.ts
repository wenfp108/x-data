import fs from 'fs';
import path from 'path';

// 获取当前工作目录的绝对路径
const ROOT = process.cwd(); 

// 1. 定义源目录 (temp_src/tweets)
const TWEETS_DIR = path.resolve(ROOT, 'tweets');

// 2. 定义中央银行目录 (依据 YAML 中的 path: central_bank)
// 因为执行时在 temp_src 目录下，所以 central_bank 在上一级
const BANK_ROOT = path.resolve(ROOT, '../central_bank');
const BANK_TWEETS_PATH = path.join(BANK_ROOT, 'bank/x-twitter/tweets');

async function syncLogic() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 服务器今日日期: ${today}`);
  console.log(`🔍 检查源目录: ${TWEETS_DIR}`);
  console.log(`📂 目标银行目录: ${BANK_TWEETS_PATH}`);

  // 确保目标银行目录存在
  if (!fs.existsSync(BANK_TWEETS_PATH)) {
    fs.mkdirSync(BANK_TWEETS_PATH, { recursive: true });
  }

  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    
    files.forEach(file => {
      // 搬运所有 JSON 文件进行路径测试
      if (file.endsWith('.json')) {
        const src = path.join(TWEETS_DIR, file);
        const dest = path.join(BANK_TWEETS_PATH, file);
        
        console.log(`🚚 搬运中: ${file}`);
        fs.copyFileSync(src, dest);
        
        // 二次确认：目的地真的有文件了吗？
        if (fs.existsSync(dest)) {
          console.log(`✅ 归档成功: ${file}`);
          fs.unlinkSync(src); // 只有成功了才删除本地
        } else {
          console.error(`❌ 拷贝失败，保留原件: ${file}`);
        }
      }
    });
  }
}

syncLogic().catch(console.error);
