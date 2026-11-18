---
layout: home
title: yongdeng blog
titleTemplate: false

hero:
  name: yongdeng blog
  text: AI Agent · Java 微服务 · 转型记录
  tagline: AI Agent 应用开发 · Java 微服务 · 从后端走向 AI 的转型记录
  image:
    src: /logo.svg
    alt: yongdeng blog
  actions:
    - theme: brand
      text: 开始阅读
      link: /posts/
    - theme: alt
      text: 关于我
      link: /about

features:
  - title: AI · Agent
    details: LLM 应用开发实战——RAG、工具调用、上下文工程、评测与工程化落地。
    link: /posts/agent/
    linkText: 进入栏目
  - title: Java · 微服务
    details: Spring Boot、服务治理、分库分表、线上问题的排查与复盘。
    link: /posts/java/
    linkText: 进入栏目
  - title: 转型记录
    details: 从写 CRUD 到写 Agent，一个 Java 后端的真实路径、踩过的坑和心态变化。
    link: /posts/transition/
    linkText: 进入栏目
---

<script setup>
import { computed } from 'vue'
import { withBase } from 'vitepress'
import { data as posts } from './.vitepress/posts.data'

const latest = computed(() => posts.slice(0, 6))
const total = computed(() => posts.length)
</script>

## 最新文章

<div class="card-grid">
  <PostCard
    v-for="post in latest"
    :key="post.url"
    :title="post.title"
    :url="post.url"
    :date="post.displayDate"
    :description="post.description"
    :section="post.section"
  />
</div>

<p v-if="!latest.length" style="color: var(--vp-c-text-3)">
  还没有文章。往 <code>docs/posts/</code> 下的栏目目录里放一个 <code>.md</code> 即可。
</p>

<p style="margin-top: 1.2rem">
  <a :href="withBase('/posts/')">查看全部 {{ total }} 篇文章 →</a>
</p>

## 这里写什么

这个博客不追热点，只记录三件事：

1. **能复用的技术方案** —— 我踩过的坑、验证过的架构，尽量给可运行的代码而不是概念图
2. **真实的转型过程** —— 从 Java 后端转向 AI 工程，哪些能力可迁移、哪些要从头学
3. **想清楚的问题** —— 技术选型背后的判断依据，而不是罗列优缺点

如果你也在做类似的转型，欢迎通过 [GitHub](https://github.com/vvlive-cc) 找我交流。
