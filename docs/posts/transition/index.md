---
title: 转型记录
---

<script setup>
import { computed } from 'vue'
import { data as posts } from '../../.vitepress/posts.data'
const list = computed(() => posts.filter(p => p.section === 'transition'))
</script>

# 转型记录

从 Java 后端到 AI 工程，一个普通人的真实路径。不贩卖焦虑，也不假装轻松。

<PostList :posts="list" />
