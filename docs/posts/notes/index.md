---
title: 杂记
---

<script setup>
import { computed } from 'vue'
import { data as posts } from '../../.vitepress/posts.data'
const list = computed(() => posts.filter(p => p.section === 'notes'))
</script>

# 杂记

工具、读书、方法论，以及还没想清楚就先记下来的东西。

<PostList :posts="list" />
