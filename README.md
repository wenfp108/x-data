# x-kit

一个用于抓取和分析 X (Twitter) 用户数据和推文的工具。

![x-kit](./images/action-stats.png)
## 功能特点

- 自动抓取指定用户的基本信息和推文
- 定时更新用户时间线数据
- 支持数据本地化存储
- GitHub Actions 自动化部署

## 更新日志

- 2024-12-24 添加每日发布推文功能 `post-twitter-daily.yml` `post-tweet.ts`
- 2025-01-02 添加获取用户推文功能 `fetch-user-tweets.ts`

## 安装

```bash
bun install
```

## 使用方法

### 1. 配置环境变量

在项目根目录创建 `.env` 文件,添加以下配置:

```bash
AUTH_TOKEN=你的X认证Token
GET_ID_X_TOKEN=用于获取用户ID的Token
```

### 2. 添加需要追踪的用户

在 `dev-accounts.json` 中添加用户信息:

```json
{
  "username": "用户名",
  "twitter_url": "用户主页链接", 
  "description": "用户描述",
  "tags": ["标签1", "标签2"]
}
```

### 3. 运行脚本

```bash
# 获取用户信息
bun run scripts/index.ts

# 获取最新推文
bun run scripts/fetch-tweets.ts

# 批量关注用户
bun run scripts/batch-follow.ts
```

## 自动化部署

项目使用 GitHub Actions 实现自动化:

- `get-home-latest-timeline.yml`: 每30分钟获取一次最新推文
- `daily-get-tweet-id.yml`: 每天获取一次用户信息

## 数据存储

- 用户信息保存在 `accounts/` 目录
- 推文数据保存在 `tweets/` 目录,按日期命名

## 技术栈

- Bun
- TypeScript 
- Twitter API
- GitHub Actions

## License

MIT
