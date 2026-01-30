# 🎯 X-Sniper Elite (推特精英情报狙击系统)

> **特别鸣谢：[xiaoxiunique](https://github.com/xiaoxiunique) 对系统架构的启发。**
> **"Ignore the noise, capture the signal."**
> 一个基于大师思维模型、具备传播力加权引擎的 Twitter 宏观情报监测系统。**慢速潜行规避风控，加权评分过滤口水。**

---

## 🚀 核心架构：信噪比增强引擎

本系统并非全量采集，而是通过一套复杂的**“生杀预判算法”**，确保你的日报里只有 1% 的金子。

### 1. ⚖️ 传播力优先加权算法 (Score Engine)

系统不再盲目看点赞，而是通过五维权重计算每一条推文的“战略分数”：

* **转发 (Retweets/Quotes) 为王**：给予 **100 倍**最高权重，第一时间捕捉全网裂变传播的突发大新闻。
* **收藏 (Bookmarks) 为相**：给予 **50 倍**高权重，留住那些互动虽低但价值极高的深度干货。

### 2. 🛡️ 七大板块动态限流 (Tag-Based Strategy)

系统根据账号所属板块的“平均噪音水平”，动态决定保留条数，强制压制话痨，保护清净：

| 板块 (Category) | 策略预期 | 保留限制 | 监控核心 |
| --- | --- | --- | --- |
| **Science** | 🔬 极低频净土 | **Top 8 (近全量)** | 论文、技术突围、硬核实验 |
| **Finance/Tech** | 💰/🚀 高价值干货 | **Top 5** | 研报、架构演进、市场分析 |
| **Politics** | 🏛️ 高话痨区 | **Top 3 (严管)** | 官员变动、政策吹风 |
| **Crypto** | ₿ 噪音之王 | **Top 3 (极限)** | 价格剧震、共识爆发、项目跑路 |
| **Economy** | 📉 数据发布区 | **Top 3 (精选)** | CPI/非农数据、联储信号 |

---


## 🧠 大师思维模型打标 (Master Mindset)

每一条入选的情报都会接受大师级的逻辑审计：

* **塔勒布 (Taleb)**：捕捉 `Science` 里的极端孤例，发现**黑天鹅**。
* **索罗斯 (Soros)**：通过 `Growth` 指标发现 **24h 转发剧增**，定位反身性趋势。
* **纳瓦尔 (Naval)**：筛选 `Tech` 板块中收藏量极高的条目，寻找**高杠杆**技术点。
* **芒格 (Munger)**：锁定 `Economy` 板块中多方确认的**确定性事实**。

---

## 🕹️ 情报输出示例 (Compact JSON)

数据以极致脱水的结构存储，每一行都是精华：

```json
[
  {
    "tags": [ "Economy", "Finance", "Politics" ],
    "user": { "screenName": "NickTimiraos", "name": "Nick Timiraos", "followersCount": 458660 },
    "tweetUrl": "https://x.com/NickTimiraos/status/2017058872582676686",
    "fullText": "Trump plans to unveil his Fed chair pick on Friday...",
    "metrics": { "likes": 591, "retweets": 99, "replies": 41, "bookmarks": 75, "views": 0 },
    "growth": { "views": 0, "likes": 591, "retweets": 99, "replies": 41 }
  }
]

```

---

## 📈 运行状态

* **调度频率**：每 4 小时全域狙击一次。
* **数据存储**：按日期存储于 `/tweets/YYYY-MM-DD.json`。
* **增量追踪**：`growth` 字段实时记录自上一轮扫描以来的数据波动。

---
