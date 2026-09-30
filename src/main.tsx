import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 英文衬线字体打包进项目（只下载用到的拉丁字符子集），不依赖 Google Fonts
import '@fontsource-variable/newsreader/wght.css'
import '@fontsource-variable/newsreader/wght-italic.css'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Service Worker：缓存页面代码和听过的语音，只在线上构建里启用
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}
