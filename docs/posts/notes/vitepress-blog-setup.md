---
title: 用 VitePress + GitHub Pages 搭一个能长期维护的博客
date: 2026-11-18
description: 从选型到上线，包含 base 自动推导、自动侧边栏、文章索引，以及那些文档里没写的坑。
tags: [VitePress, 建站, GitHub Pages]
---

# 用 VitePress + GitHub Pages 搭一个能长期维护的博客

写博客最大的阻力不是写，是**发**。如果每次发文都要折腾一遍构建流程，坚持不了一个月。

所以选型的核心标准只有一条：**写完 `git push` 就完事**。

## 为什么是 VitePress

| 方案 | 构建速度 | 交互能力 | 上手成本 | 结论 |
| --- | --- | --- | --- | --- |
| VitePress | 极快（Vite） | 可写 Vue 组件 | 低 | ✅ 选它 |
| Hexo | 中等 | 弱 | 低 | 生态多但主题老旧 |
| Hugo | 极快（Go） | 弱 | 中 | 模板语法劝退 |
| Jekyll | 慢 | 弱 | 中 | GitHub 原生但太老 |

VitePress 的定位本来是"文档站"，所以**归档、标签、分页这些博客功能要自己搭**。
但这也意味着你完全控制它——用 Vue 写几个组件就够了，比改别人的主题简单。

## 目录结构

```
docs/
├── .vitepress/
│   ├── config.mts        # 站点配置
│   ├── sidebar.ts        # 构建时扫描目录生成侧边栏
│   ├── posts.data.ts     # 文章索引数据源
│   └── theme/
│       ├── index.ts
│       ├── custom.css
│       └── components/
│           ├── PostList.vue
│           └── PostCard.vue
├── public/               # logo、图片，原样拷贝
├── index.md              # 首页
├── about.md
└── posts/
    ├── agent/            # 每个栏目一个目录
    ├── java/
    ├── transition/
    └── notes/
```

新增一个栏目 = 建一个目录 + 在 `sidebar.ts` 的 `sections` 里加一行。

## 三个关键设计

### 1. base 自动推导

手动改 `base` 是最高频的翻车点。让它自己算：

```ts
const repoName = (process.env.GITHUB_REPOSITORY || '').split('/')[1]

const BASE =
  process.env.BASE_PATH ||
  (repoName
    ? repoName.endsWith('.github.io') ? '/' : `/${repoName}/`
    : '/yongdeng-blog/')
```

`GITHUB_REPOSITORY` 是 Actions 自动注入的，所以 CI 里永远正确；本地开发用默认值兜底。

### 2. 侧边栏自动生成

VitePress 的 `sidebar` 是静态配置。写了几十篇以后手动维护会疯掉。

在 `sidebar.ts` 里直接读目录 + 解析 frontmatter：

```ts
const files = fs.readdirSync(absDir).filter(f => f.endsWith('.md') && f !== 'index.md')

const items = files.map(file => {
  const fm = readFrontmatter(fs.readFileSync(path.join(absDir, file), 'utf-8'))
  return {
    text: fm.title || file.replace(/\.md$/, ''),
    link: `/posts/${section.dir}/${file.replace(/\.md$/, '')}`,
    date: fm.date || ''
  }
})
```

按 `date` 倒序排。这样**标题改了、日期改了、新文章加了，侧边栏全自动跟着变**。

有个细节：`config.mts` 只在启动时求值一次，所以 dev 模式下新增文件不会更新侧边栏。
加了个小插件监听 `posts/` 目录，发现新增/删除文件就让 dev server 重启。

### 3. 文章索引

`posts.data.ts` 用 VitePress 的 `createContentLoader`：

```ts
export default createContentLoader(
  ['posts/agent/*.md', 'posts/java/*.md', ...],
  {
    excerpt: true,
    transform(raw) {
      return raw
        .filter(({ url }) => !url.endsWith('/'))
        .map(({ url, frontmatter, excerpt }) => ({ /* ... */ }))
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    }
  }
)
```

首页、各栏目列表页都 `import { data as posts }` 然后 `v-for`。零运行时开销——数据在构建时就序列化进产物了。

## 两个文档里没写的坑

::: warning 坑 1：content loader 的 url 不含 base
`createContentLoader` 返回的 `url` 是 `/posts/agent/foo`，**不带 base**。
直接 `:href="post.url"` 在本地 dev 看着完全正常，一部署到 `/yongdeng-blog/` 子路径就全部 404。

必须用 `withBase()` 包一层：

```vue
<script setup>
import { withBase } from 'vitepress'
</script>

<a :href="withBase(post.url)">{{ post.title }}</a>
```
:::

::: warning 坑 2：sitemap 会静默产出错链接
`sitemap.hostname` 必须**带 base 且以 `/` 结尾**：

```ts
sitemap: { hostname: 'https://alice.github.io/yongdeng-blog/' }
```

因为 VitePress 内部是 `new URL(相对路径, hostname)`。写成 `https://alice.github.io`
会把 `/yongdeng-blog/` 吞掉，sitemap 里全变成 `https://alice.github.io/agent/foo`——
**不报错**，只是错的。等搜索引擎收录了才发现，很麻烦。
:::

## 部署

`.github/workflows/deploy.yml` 用官方模板，三个权限一个都不能少：

```yaml
permissions:
  contents: read
  pages: write
  id-token: write
```

然后 **Settings → Pages → Source 选 GitHub Actions**。

> ⚠️ 这一步必须在第一次跑 workflow **之前**做，否则报
> `Get Pages site failed. Please verify that the repository has Pages enabled`。

推送后等 Actions 变绿，访问 `https://<用户名>.github.io/<仓库名>/`。

## 日常写作流程

```bash
# 1. 新建
touch docs/posts/agent/my-new-post.md

# 2. 写 frontmatter
# ---
# title: 标题
# date: 2026-11-18
# description: 一句话摘要
# tags: [标签]
# ---

# 3. 本地预览
npm run docs:dev

# 4. 上线
git add . && git commit -m "post: xxx" && git push
```

侧边栏和列表页都会自动更新。就这样，没有第五步。

## 小结

这套方案的价值不在于"快"，而在于**维护成本几乎为零**：

- 加文章不用改任何配置
- 换仓库/换域名不用改 base
- 想加功能就写 Vue 组件，不受主题限制

建站只是开始，接下来是填内容。共勉。
