// 单包构建：把所有代码、语言包、字体打进一个 JS + 一个 CSS，便于放到只支持少量文件的托管环境
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist-single',
    assetsInlineLimit: () => true,
    cssCodeSplit: false,
    chunkSizeWarningLimit: 10000,
    rolldownOptions: { output: { codeSplitting: false } },
  },
})
