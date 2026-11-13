# 迭代策略 (Iteration Plan)

用「试用 → 打分 → 留存 / 淘汰」的方式管理你的各种策略。

- **主题**：随意创建（早起、阅读、投资…），每个主题有自己的颜色、说明、留存线和淘汰线。
- **策略**：在主题下创建，用所见即所得的 Markdown 编辑器书写（标题、列表、任务清单、表格、代码块、LaTeX 公式、图片，`/` 唤出菜单，选中文字出现浮动工具栏）。
- **复盘打分**：用一段时间后回来打分，👍 +1 / 👎 −1，可附一句备注；也可以只记录观察不打分。
  - 分数 ≥ 留存线（默认 +3）→ 自动「已留存」
  - 分数 ≤ 淘汰线（默认 −3）→ 自动「已淘汰」
  - 也可手动淘汰 / 直接留存 / 恢复试用（恢复时分数归零）
- **浏览**：总览页按主题列出所有在用策略（按分数排序）和最近复盘记录，支持全文搜索；主题页可按状态筛选、排序。

数据保存在浏览器本地（IndexedDB），不上传任何服务器。侧边栏底部「备份与恢复」可下载 / 复制 JSON 备份，或从文件 / 粘贴内容导入，换浏览器或设备时用它迁移数据。

## 开发

```bash
npm install
npm run dev      # 本地开发
npm run build    # 构建到 dist/，可直接部署到任意静态托管（如 GitHub Pages）
```

技术栈：Vite + React + TypeScript，Dexie (IndexedDB)，Milkdown Crepe 编辑器。

## 部署到 GitHub Pages

仓库自带 `.github/workflows/deploy.yml`：推送到 `main` 分支（或在 Actions 页面手动运行）时自动构建并发布。

首次使用需要在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

另有 `npm run build:single`，把全部代码与字体打成一个 JS + 一个 CSS（输出到 `dist-single/`），适合只能放少量文件的托管环境。
