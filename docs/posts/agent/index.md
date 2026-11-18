---
title: AI · Agent
---

<script setup>
import { computed } from 'vue'
import { data as posts } from '../../.vitepress/posts.data'
const list = computed(() => posts.filter(p => p.section === 'agent'))
</script>

# AI · Agent

LLM 应用开发：把大模型真正接进生产系统时遇到的问题。

<PostList :posts="list" />
