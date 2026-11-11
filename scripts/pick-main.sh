#!/usr/bin/env bash
#
# 将 main（默认 origin/master）上有、但当前分支没有的提交合入。
# 如果 main 没有新提交则静默退出。
#
# 策略：先看 fork 之后 master 的新提交特征——如果全是普通线性提交，
# 用 cherry-pick 保持提交粒度；如果含大量 merge commit 或 commit 总数
# 较多（merge 更干净），就改用 git merge。merge 能正确处理 master 上
# 的 Merge pull request 提交，cherry-pick 遇到 merge commit 会丢失
# 某些 hunk 的修改。
#
# 用法：
#   scripts/pick-main.sh                     # 默认 origin/master
#   scripts/pick-main.sh origin/main         # 指定远端分支
#   scripts/pick-main.sh master              # 指定本地分支
#   BASE=upstream/main scripts/pick-main.sh  # 环境变量覆盖
#
# cherry-pick 停住时：
#   git add <已解决文件> && git cherry-pick --continue
#   git cherry-pick --abort
# merge 停住时：
#   git add <已解决文件> && git commit
#   git merge --abort

set -euo pipefail

BASE_BRANCH="${BASE:-${1:-origin/master}}"
CHERRY_PICK_MAX_COMMITS="${CHERRY_PICK_MAX_COMMITS:-30}"   # 超过这个数改用 merge
MERGE_RATIO_THRESHOLD="${MERGE_RATIO_THRESHOLD:-0.1}"     # merge commit 占比超过这个值改用 merge

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

CURRENT_BRANCH="$(git branch --show-current)"
if [ -z "$CURRENT_BRANCH" ]; then
  echo "当前处于 detached HEAD，无法合入。请先切到目标分支。" >&2
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

if [ -f .git/MERGE_HEAD ]; then
  echo "已有未完成的 merge，请先 commit 或 --abort。" >&2
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

# 计算 fork point
FORK_POINT="$(git merge-base HEAD "$BASE_BRANCH")"
TOTAL_NEW_COMMITS="$(git rev-list --count "$FORK_POINT".."$BASE_BRANCH")"
MERGE_COMMITS="$(git rev-list --merges --count "$FORK_POINT".."$BASE_BRANCH")"

echo "当前分支: $CURRENT_BRANCH"
echo "Base:     $BASE_BRANCH  ($(git log -1 --format=%h "$BASE_BRANCH"))"
echo "Fork:     $FORK_POINT   ($(git log -1 --format=%h "$FORK_POINT"))"

if [ "$TOTAL_NEW_COMMITS" -eq 0 ]; then
  echo ""
  echo "✓ $BASE_BRANCH 没有新提交，$CURRENT_BRANCH 已跟上。"
  exit 0
fi

MERGE_RATIO="$(awk "BEGIN { printf \"%.2f\", $MERGE_COMMITS / $TOTAL_NEW_COMMITS }")"

echo ""
echo "master 新提交: $TOTAL_NEW_COMMITS（其中 merge $MERGE_COMMITS，占比 $MERGE_RATIO）"

# 决定策略
USE_MERGE=false
if [ "$TOTAL_NEW_COMMITS" -gt "$CHERRY_PICK_MAX_COMMITS" ]; then
  echo "→ 超过 ${CHERRY_PICK_MAX_COMMITS} 个，改用 merge（大规模更新 cherry-pick 不可靠）"
  USE_MERGE=true
elif awk "BEGIN { exit !($MERGE_RATIO > $MERGE_RATIO_THRESHOLD) }"; then
  echo "→ merge commit 占比 $MERGE_RATIO > ${MERGE_RATIO_THRESHOLD}，改用 merge（cherry-pick merge commit 会丢 hunk）"
  USE_MERGE=true
fi

if $USE_MERGE; then
  echo ""
  echo "执行: git merge --no-ff $BASE_BRANCH"
  echo ""
  if git merge --no-ff "$BASE_BRANCH"; then
    echo ""
    echo "✓ merge 完成。"
  else
    echo ""
    echo "⚠  merge 遇到冲突，已停住。" >&2
    echo "  查看冲突: git diff --name-only --diff-filter=U" >&2
    echo "  解决后:   git add <文件...> && git commit" >&2
    echo "  放弃:     git merge --abort" >&2
    exit 2
  fi
else
  # 线性 cherry-pick
  mapfile -t NEW_COMMITS < <(git rev-list --reverse "$FORK_POINT".."$BASE_BRANCH")
  echo ""
  echo "执行: cherry-pick ${#NEW_COMMITS[@]} 个线性提交"
  for c in "${NEW_COMMITS[@]}"; do
    echo "  $(git log -1 --format='%h %s' "$c")"
  done
  echo ""
  if git cherry-pick "${NEW_COMMITS[@]}"; then
    echo ""
    echo "✓ 全部 cherry-pick 完成。"
  else
    echo ""
    echo "⚠  cherry-pick 遇到冲突或错误，已停住。" >&2
    echo "  解决后: git add <文件> && git cherry-pick --continue" >&2
    echo "  放弃:   git cherry-pick --abort" >&2
    exit 2
  fi
fi
