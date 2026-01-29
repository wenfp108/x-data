import fs from 'fs';
import path from 'path';

// 强制使用绝对路径防止丢失
const TWEETS_DIR = path.resolve(process.cwd(), 'tweets');
// 注意：这里必须对应 YAML 里的 path: central_bank
const BANK_ROOT = path.resolve(process.cwd(), '../central_bank'); 
const BANK_TWEETS_PATH = path.join(BANK_ROOT, 'bank/x-twitter/tweets');

async function syncLogic() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`📅 服务器今日日期: ${today}`);
  console.log(`🔍 正在检查源目录: ${TWEETS_DIR}`);
  console.log(`📂 目标中央银行目录: ${BANK_TWEETS_PATH}`);

  // 1. 确保目标目录存在
  if (!fs.existsSync(BANK_TWEETS_PATH)) {
    fs.mkdirSync(BANK_TWEETS_PATH, { recursive: true });
  }

  if (fs.existsSync(TWEETS_DIR)) {
    const files = fs.readdirSync(TWEETS_DIR);
    if (files.length === 0) console.log("📭 本地 tweets 文件夹是空的");

    files.forEach(file => {
      // 这里的逻辑改为：搬运所有 JSON 文件（测试阶段建议全量搬运一次，成功后再改回日期逻辑）
      if (file.endsWith('.json')) {
        const src = path.join(TWEETS_DIR, file);
        const dest = path.join(BANK_TWEETS_PATH, file);
        
        console.log(`🚚 正在物理搬运: ${src} -> ${dest}`);
        fs.copyFileSync(src, dest);
        
        // 验证文件是否真的到了目的地
        if (fs.existsSync(dest)) {
          console.log(`✅ 确认归档成功: ${file}`);
          fs.unlinkSync(src); // 只有确认目的地有文件才删除本地
        } else {
          console.error(`❌ 拷贝失败，跳过删除: ${file}`);
        }
      }
    });
  }
}

syncLogic().catch(console.error);
