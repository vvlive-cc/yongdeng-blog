# yongdeng blog

> AI Agent · Java 微服务 · 转型记录

王永登的个人博客。写 **AI Agent 应用开发**、**Java 微服务**，以及**从后端走向 AI 的转型记录**。

线上地址：`https://<username>.github.io/yongdeng-blog/`

---

## 技术栈

- [VitePress](https://vitepress.dev/) 1.6.x —— 静态站点生成，基于 Vite + Vue 3
- GitHub Pages —— 托管
- GitHub Actions —— 推送到 `main` 自动构建部署

没有数据库、没有后端、没有运行时依赖。纯静态 HTML，写完 Markdown push 即可。

## 目录结构

```
.
├── .github/workflows/deploy.yml   # 推送即部署到 GitHub Pages
├── docs/
│   ├── .vitepress/
│   │   ├── config.mts             # 站点配置（base / sitemap 自动推导）
│   │   ├── sidebar.ts             # 扫描 posts/ 目录生成侧边栏
│   │   ├── posts.data.ts          # 构建时生成文章索引（日期、摘要、标签）
│   │   └── theme/
│   │       ├── index.ts           # 继承默认主题 + 注册全局组件
│   │       ├── custom.css         # 品牌色、字体、排版微调
│   │       └── components/
│   │           ├── PostList.vue   # 列表页（标题 + 日期 + 摘要 + 标签）
│   │           └── PostCard.vue   # 首页卡片
│   ├── public/                    # 原样拷贝的静态资源
│   │   └── logo.svg
│   ├── index.md                   # 首页：hero + 栏目入口 + 最新文章
│   ├── about.md                   # 关于
│   └── posts/
│       ├── index.md               # 全部文章
│       ├── agent/                 # AI · Agent
│       │   ├── index.md
│       │   └── tool-calling-failures.md
│       ├── java/                  # Java · 微服务
│       │   ├── index.md
│       │   └── connection-pool-incident.md
│       ├── transition/            # 转型记录
│       │   ├── index.md
│       │   └── java-to-ai.md
│       └── notes/                 # 杂记
│           ├── index.md
│           └── vitepress-blog-setup.md
├── package.json
└── .gitignore
```

## 本地开发

```bash
npm install
npm run docs:dev       # http://localhost:5173/yongdeng-blog/
npm run docs:build     # 构建，产物在 docs/.vitepress/dist
npm run docs:preview   # http://localhost:4173/yongdeng-blog/ 预览生产构建
```

> 本地默认 base 是 `/yongdeng-blog/`，所以地址带后缀。想改成根路径：`BASE_PATH=/ npm run docs:dev`。

**改完文章务必用 `docs:preview` 看一眼**。`docs:dev` 不做链接检查，很多问题（尤其是 base 相关的 404）只有在生产构建里才暴露。

## 部署到 GitHub Pages

1. 建仓库，名字用 `yongdeng-blog`（或任意名字），推送代码到 `main`。
2. 仓库 **Settings → Pages → Build and deployment → Source** 选 **GitHub Actions**。
   （这一步很容易漏，不选会报 `Get Pages site failed`。）
3. 等 Actions 跑完，访问 `https://<username>.github.io/yongdeng-blog/`。

`base` 不用手改，`config.mts` 会读 Actions 注入的 `GITHUB_REPOSITORY` 自动推导：

| 仓库 | 自动得到的 base | 访问地址 |
| --- | --- | --- |
| `alice/yongdeng-blog` | `/yongdeng-blog/` | `https://alice.github.io/yongdeng-blog/` |
| `alice/alice.github.io` | `/` | `https://alice.github.io/` |
| 绑自定义域名 | 需手动传 `BASE_PATH: /` | `https://blog.example.com/` |

绑定自定义域名时，在 `.github/workflows/deploy.yml` 的构建步骤里取消注释：

```yaml
env:
  BASE_PATH: /
  SITE_URL: https://blog.example.com/
```

## 写一篇新文章

在对应栏目下新建 `.md` 文件，比如 `docs/posts/agent/my-new-post.md`：

```yaml
---
title: 文章标题
date: 2026-11-20
description: 一句话摘要，会显示在列表页和首页卡片
tags: [Agent, RAG]
---

正文从这里开始。
```

保存后会自动出现在三处，**不需要改任何配置**：

- 该栏目的列表页 `/posts/agent/`
- 「全部文章」页 `/posts/`
- 侧边栏（`sidebar.ts` 扫描目录生成）
- 首页「最新文章」（取最新 6 篇）

排序规则：按 `date` 倒序；没有 `date` 的用 `order` 字段，再没有就按文件名。

### frontmatter 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `title` | 是 | 文章标题，同时用于侧边栏和列表 |
| `date` | 建议 | `YYYY-MM-DD`，控制排序和显示 |
| `description` | 建议 | 摘要，不写则截取正文前 80 字 |
| `tags` | 否 | 字符串数组，显示为 `#标签` |
| `order` | 否 | 无 `date` 时的排序权重，小的在上 |

### 新增一个栏目

1. 在 `docs/posts/` 下建目录，比如 `docs/posts/reading/`，放一个 `index.md`。
2. 在 `docs/.vitepress/sidebar.ts` 的 `sections` 数组里加一行：

```ts
{ dir: 'reading', text: '读书笔记', desc: '技术书与非技术书的读书摘记' }
```

3. 在 `docs/.vitepress/posts.data.ts` 的 `SECTION_DIRS` 里加上 `'reading'`。
4. （可选）在 `docs/index.md` 的 `features` 里加一张入口卡片。

## 已踩过的坑

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 生产环境所有文章链接 404 | `createContentLoader` 返回的 url 不含 base | 组件里用 `withBase(post.url)` |
| 日期显示成 `Wed Nov 18` | gray-matter 把 `date` 解析成 `Date` 对象 | `posts.data.ts` 里用 `formatDate()` 格式化 |
| 构建报 `TypeError: Invalid URL` | sitemap 的 hostname 写了 `<username>` 占位符 | hostname 必须是真实 URL 且以 `/` 结尾 |
| 部署报 `Get Pages site failed` | Pages Source 没选 GitHub Actions | 仓库 Settings → Pages 改一下 |
| `lastUpdated` 全是当前时间 | Actions checkout 深度为 1 | workflow 里 `fetch-depth: 0` |
| 子路径下 sitemap 少了 base | `new URL(rel, hostname)` 吞掉子路径 | hostname 带上 base 且以 `/` 结尾 |

## License

内容版权归作者所有；代码部分 MIT。
