#!/usr/bin/env bash
#
# 将 main（默认 origin/master）上有、但当前分支没有的提交 cherry-pick 过来。
# 如果 main 没有新提交则静默退出。
#
# 用法：
#   scripts/pick-main.sh                     # 默认 origin/master
#   scripts/pick-main.sh origin/main         # 指定远端分支
#   scripts/pick-main.sh master              # 指定本地分支
#   BASE=upstream/main scripts/pick-main.sh  # 环境变量覆盖
#
# 遇到冲突时 cherry-pick 会停住，手动解决后执行：
#   git add <已解决文件>
#   git cherry-pick --continue
# 放弃：
#   git cherry-pick --abort

set -euo pipefail

BASE_BRANCH="${BASE:-${1:-origin/master}}"

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

CURRENT_BRANCH="$(git branch --show-current)"
if [ -z "$CURRENT_BRANCH" ]; then
  echo "当前处于 detached HEAD，无法 cherry-pick。请先切到目标分支。" >&2
  exit 1
fi

# 前置检查
if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交的改动，请先 commit 或 stash。" >&2
  git status --short
  exit 1
fi

if git rev-parse -q --verify CHERRY_PICK_HEAD >/dev/null 2>&1; then
  echo "已有未完成的 cherry-pick，请先 --continue 或 --abort。" >&2
  exit 1
fi

# fetch 远端
if [[ "$BASE_BRANCH" == */* ]]; then
  REMOTE="${BASE_BRANCH%%/*}"
  if git remote get-url "$REMOTE" >/dev/null 2>&1; then
    git fetch "$REMOTE" "${BASE_BRANCH#*/}" || echo "fetch $BASE_BRANCH 失败，继续用本地缓存。" >&2
  else
    echo "远端 $REMOTE 不存在，跳过 fetch。" >&2
  fi
fi

if ! git rev-parse --verify "$BASE_BRANCH" >/dev/null 2>&1; then
  echo "找不到 base 分支引用：$BASE_BRANCH" >&2
  exit 1
fi

# 计算 fork point 和新增 commits
FORK_POINT="$(git merge-base HEAD "$BASE_BRANCH")"
mapfile -t NEW_COMMITS < <(git rev-list --reverse "$FORK_POINT".."$BASE_BRANCH")

echo "当前分支: $CURRENT_BRANCH"
echo "Base:     $BASE_BRANCH  ($(git log -1 --format=%h "$BASE_BRANCH"))"
echo "Fork:     $FORK_POINT   ($(git log -1 --format=%h "$FORK_POINT"))"

if [ "${#NEW_COMMITS[@]}" -eq 0 ]; then
  echo ""
  echo "✓ $BASE_BRANCH 没有新提交，$CURRENT_BRANCH 已跟上。"
  exit 0
fi

echo ""
echo "发现 ${#NEW_COMMITS[@]} 个新提交，将依次 cherry-pick："
for c in "${NEW_COMMITS[@]}"; do
  echo "  $(git log -1 --format='%h %s' "$c")"
done
echo ""

# 依次 cherry-pick，遇到冲突自动停住
if git cherry-pick "${NEW_COMMITS[@]}"; then
  echo ""
  echo "✓ 全部 cherry-pick 完成。"
else
  echo ""
  echo "⚠  cherry-pick 遇到冲突或错误，已停住。" >&2
  echo "  解决后执行：git add <文件> && git cherry-pick --continue" >&2
  echo "  放弃则：    git cherry-pick --abort" >&2
  exit 2
fi
