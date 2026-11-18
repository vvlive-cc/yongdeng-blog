<script setup lang="ts">
import { withBase } from 'vitepress'

defineProps<{
  title: string
  url: string
  date?: string
  description?: string
  section?: string
}>()

const sectionNames: Record<string, string> = {
  agent: 'AI · Agent',
  java: 'Java · 微服务',
  transition: '转型记录',
  notes: '杂记'
}
</script>

<template>
  <a class="post-card" :href="withBase(url)">
    <div class="card-top">
      <span v-if="section" class="card-section">{{ sectionNames[section] ?? section }}</span>
      <time v-if="date" class="card-date">{{ date }}</time>
    </div>
    <h3 class="card-title">{{ title }}</h3>
    <p v-if="description" class="card-desc">{{ description }}</p>
  </a>
</template>

<style scoped>
.post-card {
  display: flex;
  flex-direction: column;
  padding: 1.1rem 1.15rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  transition:
    border-color 0.25s,
    transform 0.25s;
}

.post-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.card-section {
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  padding: 0.1rem 0.45rem;
  border-radius: 999px;
}

.card-date {
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}

.card-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1.45;
  color: var(--vp-c-text-1);
  border: none;
  padding: 0;
}

.card-desc {
  margin: 0.4rem 0 0;
  font-size: 0.85rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
