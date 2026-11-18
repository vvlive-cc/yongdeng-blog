import DefaultTheme from 'vitepress/theme'
import PostList from './components/PostList.vue'
import PostCard from './components/PostCard.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // 全局注册，这样各个 index.md 里不用重复 import
    app.component('PostList', PostList)
    app.component('PostCard', PostCard)
  }
}
