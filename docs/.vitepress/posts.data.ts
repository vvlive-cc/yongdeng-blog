import { createContentLoader } from 'vitepress'

/**
 * 构建时扫描 docs/posts/<section>/*.md，产出文章索引。
 * 首页的「最新文章」和各栏目列表页都消费这份数据。
 */

export interface Post {
  title: string
  url: string
  date: string
  description: string
  tags: string[]
  /** 栏目 slug，取自路径第一段 */
  section: string
  /** 中文日期显示用，如 2026-11-18 */
  displayDate: string
}

declare const data: Post[]
export { data }

const SECTION_DIRS = ['agent', 'java', 'transition', 'notes']

/**
 * 把 frontmatter.date 统一成 YYYY-MM-DD。
 * 注意：gray-matter 会把 YAML 里的 `date: 2026-11-18` 解析成 Date 对象，
 * 直接 String(date).slice(0,10) 会得到 "Wed Nov 18"，所以必须走这条分支。
 */
function formatDate(value: unknown): string {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(String(value))
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  // YAML 日期被解析为 UTC 零点，用 UTC getter 避免西半球时区退一天
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export default createContentLoader(
  SECTION_DIRS.map((d) => `posts/${d}/*.md`),
  {
    excerpt: true,
    transform(raw): Post[] {
      return raw
        .filter(({ url }) => !url.endsWith('/')) // 排除各栏目 index.md
        .map(({ url, frontmatter, excerpt }) => {
          const section = url.split('/')[2] ?? ''
          const date = formatDate(frontmatter.date)
          return {
            title: frontmatter.title ?? url,
            url,
            date,
            displayDate: date,
            description:
              frontmatter.description ??
              (excerpt ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 80),
            tags: frontmatter.tags ?? [],
            section
          }
        })
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    }
  }
)
