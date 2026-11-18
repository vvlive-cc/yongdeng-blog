import fs from 'node:fs'
import path from 'node:path'

/**
 * 从 docs/posts/<section>/ 目录自动生成侧边栏，按 frontmatter 的 date 倒序。
 *
 * 为什么自己写：侧边栏是静态配置，不写插件的话每加一篇文章都要手动改 config.mts。
 * 这里在构建时读目录 + 解析 frontmatter，零依赖，比装插件更可控。
 * 标题改动、新增文章、删除文章都会自动同步。
 */

export interface SectionDef {
  /** 目录名，同时是 URL 前缀 */
  dir: string
  /** 导航/侧边栏显示名 */
  text: string
  /** 栏目一句话说明 */
  desc: string
}

export const sections: SectionDef[] = [
  { dir: 'agent', text: 'AI · Agent', desc: 'LLM 应用开发：RAG、工具调用、评测与工程化' },
  { dir: 'java', text: 'Java · 微服务', desc: 'Spring Boot、服务治理、数据库与线上问题' },
  { dir: 'transition', text: '转型记录', desc: '从 Java 后端走向 AI 工程的真实路径' },
  { dir: 'notes', text: '杂记', desc: '工具、读书、方法论与零散想法' }
]

/** 只取 frontmatter 里的几个字段，不引第三方 yaml 解析器 */
function readFrontmatter(src: string): Record<string, string> {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!m) return {}
  const out: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (!kv) continue
    out[kv[1]] = kv[2].trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

interface Item {
  text: string
  link: string
  date: string
  order: number
}

export function buildSidebar(srcDir: string) {
  const sidebar: Record<string, any[]> = {}

  for (const section of sections) {
    const absDir = path.join(srcDir, 'posts', section.dir)
    if (!fs.existsSync(absDir)) continue

    const files = fs
      .readdirSync(absDir)
      .filter((f) => f.endsWith('.md') && f !== 'index.md')

    const items: Item[] = files.map((file, i) => {
      const fm = readFrontmatter(fs.readFileSync(path.join(absDir, file), 'utf-8'))
      const slug = file.replace(/\.md$/, '')
      return {
        text: fm.title || slug,
        link: `/posts/${section.dir}/${slug}`,
        date: fm.date || '',
        order: fm.order ? Number(fm.order) : 9999 + i
      }
    })

    // 有 date 的按日期倒序（新的在上），没 date 的按 order / 文件名
    items.sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? 1 : -1
      if (a.date && !b.date) return -1
      if (!a.date && b.date) return 1
      return a.order - b.order
    })

    sidebar[`/posts/${section.dir}/`] = [
      {
        text: section.text,
        items: [
          { text: `📚 ${section.text} · 全部`, link: `/posts/${section.dir}/` },
          ...items.map(({ text, link }) => ({ text, link }))
        ]
      }
    ]
  }

  // 「全部文章」页的侧边栏：按栏目分组
  sidebar['/posts/'] = sections.map((s) => ({
    text: s.text,
    collapsed: false,
    items: sidebar[`/posts/${s.dir}/`]?.[0]?.items ?? [
      { text: '（暂无文章）', link: `/posts/${s.dir}/` }
    ]
  }))

  return sidebar
}
