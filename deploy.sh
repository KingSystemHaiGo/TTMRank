#!/bin/bash
# TTMRank GitHub Pages 一键部署脚本
# 用法: 在项目根目录打开 Git Bash，执行 bash deploy.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo "========================================"
echo "  TTMRank GitHub Pages 一键部署"
echo "========================================"

# 检查 git
if ! command -v git &> /dev/null; then
    echo -e "${RED}错误: 未找到 git${NC}"
    echo "请先安装 Git: https://git-scm.com/download/win"
    exit 1
fi

# 检查 gh CLI
HAS_GH=false
if command -v gh &> /dev/null; then
    if gh auth status &> /dev/null 2>&1; then
        HAS_GH=true
    fi
fi

if [ "$HAS_GH" = false ]; then
    echo -e "${YELLOW}未检测到已登录的 GitHub CLI (gh)${NC}"
    echo ""
    echo "推荐安装 gh CLI 以实现全自动部署:"
    echo "  1. 下载: https://cli.github.com/"
    echo "  2. 安装后运行: gh auth login"
    echo "  3. 重新执行本脚本"
    echo ""
    echo "或者继续手动模式..."
    echo ""
fi

# 获取 GitHub 用户名
if [ "$HAS_GH" = true ]; then
    GH_USER=$(gh api user -q '.login')
    echo -e "GitHub 用户: ${GREEN}$GH_USER${NC}"
else
    read -rp "请输入你的 GitHub 用户名: " GH_USER
    if [ -z "$GH_USER" ]; then
        echo -e "${RED}用户名不能为空${NC}"
        exit 1
    fi
fi

REPO_NAME="TTMRank"
REPO_URL="https://github.com/$GH_USER/$REPO_NAME"

echo ""
echo "仓库将创建为: $REPO_URL"
read -rp "按回车继续，或按 Ctrl+C 取消..."

# Git 初始化
echo ""
echo -e "${BLUE}[1/4] 初始化 Git 仓库...${NC}"
if [ ! -d .git ]; then
    git init
    git branch -M main
fi

# 提交代码
git add .
if git diff --cached --quiet; then
    echo "没有新变更需要提交"
else
    git commit -m "init"
fi

# 创建/连接远程仓库并 push
echo ""
echo -e "${BLUE}[2/4] 推送到 GitHub...${NC}"
if [ "$HAS_GH" = true ]; then
    # 检查远程仓库是否已存在
    if git remote get-url origin &> /dev/null; then
        git push -u origin main
    else
        # 创建仓库并推送
        if gh repo view "$GH_USER/$REPO_NAME" &> /dev/null 2>&1; then
            echo "仓库已存在，连接远程..."
            git remote add origin "$REPO_URL.git"
            git push -u origin main
        else
            echo "创建新仓库..."
            gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
        fi
    fi
else
    # 手动模式
    if ! git remote get-url origin &> /dev/null; then
        git remote add origin "$REPO_URL.git"
    fi
    echo -e "${YELLOW}请确保你已在 GitHub 手动创建了仓库 $REPO_NAME${NC}"
    git push -u origin main || {
        echo -e "${RED}推送失败。请确认仓库已创建，或运行: gh auth login${NC}"
        exit 1
    }
fi

echo -e "${GREEN}代码已推送到 $REPO_URL${NC}"

# 尝试自动配置（需要 gh CLI）
echo ""
echo -e "${BLUE}[3/4] 配置仓库...${NC}"
if [ "$HAS_GH" = true ]; then
    # 开启 Actions 读写权限
    gh api --method PUT "repos/$GH_USER/$REPO_NAME/actions/permissions/workflow" \
        -f default_workflow_permissions=write 2>/dev/null || true

    # 尝试开启 Pages（GitHub Actions source）
    # 注：GitHub Actions source 可能没有稳定 API，失败时提示手动操作
    gh api --method PUT "repos/$GH_USER/$REPO_NAME/pages" \
        -f source='github_actions' 2>/dev/null && echo -e "${GREEN}Pages 已自动配置${NC}" || {
        echo -e "${YELLOW}Pages 自动配置失败（API 限制），请手动操作${NC}"
    }
else
    echo -e "${YELLOW}跳过自动配置（需要 gh CLI）${NC}"
fi

# 输出后续步骤
echo ""
echo "========================================"
echo -e "${GREEN}  代码推送完成！${NC}"
echo "========================================"
echo ""
echo -e "${BLUE}剩余手动步骤（约 2 分钟）:${NC}"
echo ""
echo "1. 开启 GitHub Pages"
echo "   打开: ${REPO_URL}/settings/pages"
echo "   Build and deployment → Source → 选 ${YELLOW}GitHub Actions${NC}"
echo ""
echo "2. 开启 Actions 权限"
echo "   打开: ${REPO_URL}/settings/actions"
echo "   Workflow permissions → 选 ${YELLOW}Read and write permissions${NC}"
echo "   勾选 ${YELLOW}Allow GitHub Actions to create and approve pull requests${NC}"
echo "   点击 Save"
echo ""
echo "3. 等待首次部署"
echo "   打开: ${REPO_URL}/actions"
echo "   等待 ${YELLOW}Deploy to GitHub Pages${NC} 变绿"
echo ""
echo -e "${GREEN}网站地址:${NC} https://$GH_USER.github.io/$REPO_NAME/"
echo ""
echo -e "数据每小时自动刷新。如需立刻更新:"
echo "   ${REPO_URL}/actions/workflows/refresh.yml → Run workflow"
echo ""
