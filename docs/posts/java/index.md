---
title: Java · 微服务
---

<script setup>
import { computed } from 'vue'
import { data as posts } from '../../.vitepress/posts.data'
const list = computed(() => posts.filter(p => p.section === 'java'))
</script>

# Java · 微服务

Spring Boot、服务治理、分库分表，以及线上问题的排查过程。

<PostList :posts="list" />
