<script setup lang="ts">
import { computed } from 'vue'
import { withBase } from 'vitepress'

interface Post {
  title: string
  url: string
  displayDate: string
  description: string
  tags?: string[]
  section?: string
}

const props = withDefaults(
  defineProps<{
    posts: Post[]
    /** 只显示前 N 篇 */
    limit?: number
    /** 是否显示栏目标签 */
    showSection?: boolean
  }>(),
  { limit: 0, showSection: false }
)

const sectionNames: Record<string, string> = {
  agent: 'AI · Agent',
  java: 'Java · 微服务',
  transition: '转型记录',
  notes: '杂记'
}

const list = computed(() =>
  props.limit > 0 ? props.posts.slice(0, props.limit) : props.posts
)
</script>

<template>
  <ul v-if="list.length" class="post-list">
    <li v-for="post in list" :key="post.url" class="post-item">
      <div class="post-head">
        <a class="post-title" :href="withBase(post.url)">{{ post.title }}</a>
        <time v-if="post.displayDate" class="post-date">{{ post.displayDate }}</time>
      </div>
      <p v-if="post.description" class="post-desc">{{ post.description }}</p>
      <div v-if="post.tags?.length || (showSection && post.section)" class="post-meta">
        <span v-if="showSection && post.section" class="post-section">
          {{ sectionNames[post.section] ?? post.section }}
        </span>
        <span v-for="tag in post.tags" :key="tag" class="post-tag">#{{ tag }}</span>
      </div>
    </li>
  </ul>
  <p v-else class="post-empty">这个栏目还空着，先写一篇吧。</p>
</template>

<style scoped>
.post-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.post-item {
  padding: 1.15rem 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.post-item:last-child {
  border-bottom: none;
}

.post-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.post-title {
  font-size: 1.08rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: color 0.2s;
}

.post-title:hover {
  color: var(--vp-c-brand-1);
}

.post-date {
  flex-shrink: 0;
  font-size: 0.82rem;
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}

.post-desc {
  margin: 0.45rem 0 0;
  font-size: 0.9rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.post-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.55rem;
}

.post-section,
.post-tag {
  font-size: 0.75rem;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  line-height: 1.6;
}

.post-section {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

.post-tag {
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-2);
}

.post-empty {
  color: var(--vp-c-text-3);
  font-size: 0.9rem;
  padding: 1rem 0;
}
</style>
