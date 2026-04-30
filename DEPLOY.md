# TTMRank 上线部署指南（GitHub Pages + GitHub Actions）

完全免费方案，无需服务器，无需信用卡。

## 部署前准备

1. 注册 [GitHub](https://github.com) 账号

## 步骤 1：创建 GitHub 仓库

1. 登录 GitHub，点击右上角 **+** → **New repository**
2. 仓库名填 `TTMRank`，选 **Public**
3. 不要勾选 README，直接点 **Create repository**

## 步骤 2：上传代码

在项目根目录（有 app/ 文件夹的目录）打开 Git Bash：

```bash
git init
git add .
git commit -m "init"
git branch -M main
git remote add origin https://github.com/你的用户名/TTMRank.git
git push -u origin main
```

## 步骤 3：开启 GitHub Pages

1. 打开仓库页面，点击 **Settings**
2. 左侧菜单选择 **Pages**
3. **Build and deployment** → **Source** 选择 **GitHub Actions**
4. 保存

## 步骤 4：配置 Actions 权限

1. 仓库 Settings → **Actions** → **General**
2. 找到 **Workflow permissions**
3. 选择 **Read and write permissions**
4. 勾选 **Allow GitHub Actions to create and approve pull requests**
5. 点击 **Save**

> 这步是给数据自动刷新用的，让 Actions 能提交更新后的数据文件。

## 步骤 5：首次部署

Push 代码后会自动触发 **Deploy to GitHub Pages** workflow。

1. 进入仓库的 **Actions** 标签页
2. 等待 Deploy workflow 变绿（约 1-2 分钟）
3. 回到 **Settings → Pages**，上方会显示你的网址，如：
   `https://你的用户名.github.io/TTMRank/`

## 步骤 6：数据自动刷新

仓库已包含 `.github/workflows/refresh.yml`，**每小时自动运行一次** `fetcher.py` 爬取最新数据。

- 数据更新后自动 push 到仓库
- push 触发 Pages 重新部署
- 无需任何额外配置

如果需要立刻更新，可以：
1. 进入仓库 **Actions** 标签页
2. 选择 **Refresh Data**
3. 点击 **Run workflow** 手动触发

## 步骤 7：LLM 配置

网站是纯静态部署，AI 总结功能**直接从前端调用 LLM API**。

用户在网页上点击设置按钮，自行填写：
- **API URL**：如 `https://api.deepseek.com/chat/completions`
- **API Key**：自己的 Key
- **模型**：如 `deepseek-chat`

配置保存在用户浏览器本地（localStorage），**不会上传到你的服务器**。

> 这意味着每个使用网站的人需要自备 LLM API Key。如果你希望免配置使用，需要额外搭建一个带代理的服务器（如 Render / Vercel / Cloudflare Workers）。

## 费用

- GitHub Pages：免费
- GitHub Actions：免费（公共仓库无限制）
- 总成本：**0元**

## 注意事项

1. GitHub Pages 有流量限制（每月 100GB 带宽），小群分享完全够用
2. 首次部署后等待 2-3 分钟再访问，GitHub Pages 需要一点时间来分发
3. 如果图片加载慢，是 TapTap CDN 的问题，与部署无关
