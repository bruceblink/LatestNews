# 📘 新闻数据时间流系统设计说明书（v1.0）

---

# 一、系统概述

## 1.1 项目名称

**News TimeStream Platform（新闻数据时间流平台）**

---

## 1.2 项目定位

本系统是一个多数据源驱动的**实时/准实时信息流处理与分析平台**，提供：

* 多源新闻数据采集
* 定时调度更新
* 数据分析与聚合
* 用户个性化信息流展示

---

## 1.3 核心目标

### 🎯 目标一：数据统一

将多个异构数据源统一为标准化新闻事件模型。

### 🎯 目标二：时间流建模

以"时间"为核心维度构建信息流。

### 🎯 目标三：用户产品化

提供可交互的前端信息流入口。

---

# 二、整体系统架构

## 2.1 逻辑架构

```text
                    ┌────────────────────┐
                    │     Frontend       │
                    │ (Web / Future App) │
                    └─────────┬──────────┘
                              ↓
                    ┌────────────────────┐
                    │   BFF Service      │  ⭐ 新增核心层
                    │ (Java Spring Boot) │
                    └─────────┬──────────┘
                              ↓
        ┌─────────────────────┼─────────────────────┐
        ↓                     ↓                     ↓
┌────────────────┐   ┌────────────────┐   ┌────────────────────┐
│ news-analytics │   │ LatestNews     │   │ ani-updater        │
│ (分析/聚合API) │   │ (数据源系统)   │   │ (任务调度系统)     │
└────────────────┘   └────────────────┘   └────────────────────┘
                              ↓
                    ┌────────────────────┐
                    │     Keylo          │
                    │  (统一认证中心)    │
                    └────────────────────┘
```

---

## 2.2 架构分层

| 层级  | 模块             | 职责                   |
| ----- | ---------------- | ---------------------- |
| 表现层 | Frontend         | 信息流展示              |
| 编排层 | BFF              | 数据聚合 + 用户上下文   |
| 分析层 | news-analytics   | 数据处理与统计          |
| 数据层 | LatestNews       | 多源数据采集            |
| 调度层 | ani-updater      | 定时任务控制            |
| 认证层 | Keylo            | 用户认证与 Token 管理   |

---

# 三、核心系统说明

---

## 3.1 LatestNews（数据源系统）

### 职责

* 多源新闻数据抓取
* RSS / API / 爬虫统一接入
* 原始数据结构化存储

### 输出

```json
{
  "id": "...",
  "title": "...",
  "content": "...",
  "source": "...",
  "publish_time": "...",
  "raw_data": {}
}
```

### 特点

* 强数据采集能力
* 不涉及业务展示逻辑

---

## 3.2 ani-updater（调度系统）

### 职责

* 定时任务调度
* 数据源更新触发
* 爬虫执行控制

### 能力

* cron 调度
* 任务队列控制
* 重试机制

---

## 3.3 news-analytics（分析系统）

### 职责

* 数据清洗与处理
* 热点分析
* 关键词提取
* 对外统一数据 API

### ⚠️ 设计定位（关键）

> ❗它是"数据分析服务"，不是前端服务

### 输出能力

* 热度排行
* 时间趋势
* 聚合新闻 API

### ❗边界约束

不允许：

* UI 适配逻辑
* 用户个性化逻辑
* 前端字段定制

---

## 3.4 Keylo（认证系统）

### 职责

* 用户认证（OAuth2 / Token）
* 用户身份管理
* Token 校验服务

### 系统定位

> 🔐 全系统统一认证中心（Single Auth Source）

---

## 3.5 BFF（Backend For Frontend）⭐ 核心新增层

### 职责

* 面向前端的数据编排
* 多服务数据聚合
* 用户上下文处理
* 接口裁剪与适配
* 缓存优化

### 核心接口示例

#### GET /api/feed

```json
{
  "items": [
    {
      "title": "...",
      "source": "...",
      "publish_time": "...",
      "hot_score": 98
    }
  ],
  "user_context": {
    "user_id": "...",
    "subscriptions": []
  }
}
```

### 内部调用链

```text
Frontend → BFF
         ↓
     Keylo（鉴权）
         ↓
 news-analytics（分析数据）
         ↓
 LatestNews（原始数据）
         ↓
   聚合 + 裁剪 + 返回
```

### 核心价值

* 隔离前端与后端复杂性
* 统一用户体验
* 支持多端扩展（Web / App）

---

# 四、数据流设计

## 4.1 数据流全链路

```text
数据源 → LatestNews → ani-updater 触发更新
       ↓
   news-analytics 处理
       ↓
      BFF 聚合
       ↓
    Frontend 展示
```

## 4.2 用户数据流

```text
Frontend → Keylo 登录
        ↓
     BFF 获取 user_id
        ↓
  个性化 Feed 构建
```

---

# 五、接口设计规范（BFF 层）

## 5.1 Feed 接口

### GET /api/feed

参数：

* `page`
* `size`

返回：

```json
{
  "items": [],
  "page": 1,
  "has_more": true
}
```

## 5.2 用户接口

* `GET /api/user/profile`
* `GET /api/user/subscriptions`

## 5.3 分析接口（透传 analytics）

* `GET /api/stats/hot`
* `GET /api/stats/trend`

---

# 六、关键设计原则

## 6.1 职责分离原则

| 模块         | 职责     |
| ------------ | -------- |
| LatestNews   | 数据采集 |
| analytics    | 数据分析 |
| BFF          | 数据编排 |
| Frontend     | 展示     |

## 6.2 单一认证源

所有认证统一通过 Keylo。

## 6.3 BFF 不存数据原则

* ❌ 不持久化业务数据
* ✅ 只做聚合 + 缓存

## 6.4 analytics 不做 UI 适配

严格保持：

> 👉 数据层纯净性

---

# 七、技术选型

## 后端

| 层          | 技术               |
| ----------- | ------------------ |
| BFF         | Java Spring Boot   |
| analytics   | Python / Java      |
| LatestNews  | Python             |
| scheduler   | Python             |
| Keylo       | 已有               |

## 存储

* PostgreSQL（主库）
* Redis（缓存）

## 通信

* HTTP REST（主）
* 后续可扩展 gRPC（内部）

---

# 八、演进路线

## Phase 1（当前）

* BFF 上线
* Feed 接口打通
* Keylo 接入

## Phase 2

* 用户订阅系统
* 个性化 Feed

## Phase 3

* Redis 缓存优化
* 热点分析增强

## Phase 4

* 实时推送（WebSocket）

## Phase 5（高级）

* Kafka 事件流
* 推荐系统

---

# 九、系统边界总结

## ❗必须牢记的边界

### LatestNews

👉 只负责"数据生产"

### analytics

👉 只负责"数据加工"

### BFF

👉 只负责"给前端正确的数据"

### Keylo

👉 只负责"身份认证"

---

# 十、一句话总结

> 本系统通过 BFF 层将多源数据采集（LatestNews）、任务调度（ani-updater）、数据分析（news-analytics）与统一认证系统（Keylo）进行解耦与整合，构建面向用户的信息流产品平台。
