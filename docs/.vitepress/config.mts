import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitepress'
import { buildSidebar, sections } from './sidebar'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC_DIR = path.resolve(HERE, '..')

/**
 * base 自动推导，避免「白屏 / 样式丢失 / 图片 404」这个最常见的坑。
 *
 * 优先级：BASE_PATH 环境变量 > GITHUB_REPOSITORY 自动推导 > 本地默认值
 * - 仓库名 <owner>.github.io -> base 为 '/'（用户主页仓库）
 * - 其他仓库                -> base 为 '/<repo>/'
 * - 绑定自定义域名           -> 传 BASE_PATH=/
 */
const repoFull = process.env.GITHUB_REPOSITORY || ''
const repoName = repoFull.split('/')[1] || ''
const owner = repoFull.split('/')[0] || 'vvlive-cc'

const BASE =
  process.env.BASE_PATH ||
  (repoName
    ? repoName.endsWith('.github.io')
      ? '/'
      : `/${repoName}/`
    : '/yongdeng-blog/')

// sitemap 的 hostname 必须带 base 且以 '/' 结尾，
// 否则 new URL(相对路径, hostname) 会把子路径吞掉（VitePress 1.6.4 实测行为）。
const SITE_URL = process.env.SITE_URL || `https://${owner}.github.io${BASE}`

const SITE_NAME = 'yongdeng blog'
const SITE_DESC = 'AI Agent 应用开发、Java 微服务、以及从后端走向 AI 的转型记录。'

/**
 * 新增/删除文章、或改标题改日期之后，侧边栏需要重算。
 * 侧边栏在 config 求值时生成，所以这里在 dev 下监听 posts 目录，
 * 一旦发现「有新文件」或「frontmatter 变了」就重启 dev server。
 */
function sidebarWatchPlugin() {
  const postsDir = path.join(SRC_DIR, 'posts')
  const fmCache = new Map<string, string>()
  const fmOf = (file: string) => {
    try {
      const src = fs.readFileSync(file, 'utf-8')
      return (src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '').replace(/date:\s*\S+/g, 'date: *')
    } catch {
      return ''
    }
  }
  return {
    name: 'yongdeng-sidebar-watch',
    apply: 'serve' as const,
    configureServer(server: any) {
      server.watcher.on('add', (file: string) => {
        if (!file.startsWith(postsDir) || !file.endsWith('.md')) return
        server.restart()
      })
      server.watcher.on('unlink', (file: string) => {
        if (!file.startsWith(postsDir) || !file.endsWith('.md')) return
        server.restart()
      })
      server.watcher.on('change', (file: string) => {
        if (!file.startsWith(postsDir) || !file.endsWith('.md')) return
        // 只关心标题/日期变化（影响侧边栏顺序与文案），正文改动交给 HMR
        const next = fmOf(file)
        if (fmCache.get(file) === next) return
        const prev = fmCache.get(file)
        fmCache.set(file, next)
        if (prev !== undefined) server.restart()
      })
    }
  }
}

export default defineConfig({
  lang: 'zh-CN',
  title: SITE_NAME,
  titleTemplate: `:title · ${SITE_NAME}`,
  description: SITE_DESC,
  base: BASE,

  cleanUrls: true,
  sitemap: { hostname: SITE_URL },
  lastUpdated: true,

  // 忽略失效链接检查中的占位符（自建期还没写的页面）
  ignoreDeadLinks: 'localhostLinks',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${BASE}logo.svg` }],
    ['meta', { name: 'theme-color', content: '#2b8a78' }],
    ['meta', { name: 'author', content: '王永登' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: SITE_NAME }],
    ['meta', { property: 'og:description', content: SITE_DESC }]
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: SITE_NAME,

    nav: [
      { text: '首页', link: '/' },
      {
        text: '文章',
        items: [
          { text: '全部文章', link: '/posts/' },
          ...sections.map((s) => ({ text: s.text, link: `/posts/${s.dir}/` }))
        ]
      },
      { text: '关于', link: '/about' }
    ],

    // 侧边栏由 sidebar.ts 在构建时扫描目录生成，新增文章自动出现
    sidebar: buildSidebar(SRC_DIR),

    socialLinks: [{ icon: 'github', link: 'https://github.com/vvlive-cc' }],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', buttonAriaLabel: '搜索文章' },
          modal: {
            noResultsText: '没有找到相关文章',
            resetButtonTitle: '清除条件',
            footer: {
              selectText: '选择',
              navigateText: '切换',
              closeText: '关闭'
            }
          }
        }
      }
    },

    footer: {
      message: '记录 AI Agent 与 Java 微服务的实践',
      copyright: 'Copyright © 2026 王永登'
    },

    docFooter: { prev: '上一篇', next: '下一篇' },
    outline: { level: [2, 3], label: '本页目录' },
    returnToTopLabel: '回到顶部',
    darkModeSwitchLabel: '主题',
    sidebarMenuLabel: '目录',
    lastUpdatedText: '最后更新',
    externalLinkIcon: true,

    editLink: {
      pattern: `https://github.com/${owner}/${repoName || 'yongdeng-blog'}/edit/main/docs/:path`,
      text: '在 GitHub 上编辑此页'
    }
  },

  vite: {
    plugins: [sidebarWatchPlugin()]
  }
})
