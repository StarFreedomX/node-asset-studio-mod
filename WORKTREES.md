# 使用 Git worktree 维护三个实现

三个实现属于同一个 Git 仓库，共享提交历史、分支和 origin；每个工作目录分别保存依赖、构建产物和下载文件。

| 分支 | 工作目录（相对主仓库） | 实现 |
| --- | --- | --- |
| cli | `.` | CLI 适配器 |
| pipe | `.worktrees/pipe` | .NET 管道 API |
| js | `.worktrees/js` | JavaScript / WASM |

## 日常开发

在对应目录修改、构建和提交，无需在主目录反复切换分支：

```sh
# 以下命令从主仓库目录执行
pnpm build
pnpm -C .worktrees/pipe build
pnpm -C .worktrees/js build

git worktree list
git status --short
git -C .worktrees/pipe status --short
git -C .worktrees/js status --short
```

每个目录单独运行 `pnpm install`，不要共享 `node_modules`。CLI 使用 .NET 9 x64 Runtime；pipe 源码构建需要 .NET 9 SDK，可通过 `ASSET_STUDIO_DOTNET` 指定 dotnet 可执行文件；JS 无需 .NET。

提交只更新当前目录检出的分支。共享修复可在另一个工作目录使用 `git cherry-pick <commit>`，然后运行该实现的测试。避免直接合并三个引擎分支。远端和 Git 对象是共享的，在任一目录 `git fetch origin` 即可更新共同的远端引用。

## 新建工作环境

以下只用于尚未创建 worktree 的检出目录；已经存在的目录无需重复执行。先确保本地已有 `cli`、`pipe`、`js` 分支：

```sh
git switch cli
mkdir -p .worktrees
git worktree add .worktrees/pipe pipe
git worktree add .worktrees/js js
pnpm install
pnpm -C .worktrees/pipe install
pnpm -C .worktrees/js install
```

同一个分支只能由一个工作目录检出；日常操作进入相应目录即可。`.worktrees/` 已被 Git 忽略，其中的代码由各 worktree 自身管理。

## 移动或移除

用 `git worktree move <旧路径> <新路径>` 移动，不要直接搬文件夹。移动后检查自己添加的相对软链接和本地配置，必要时重新构建。

先检查并保存改动，再使用 `git worktree remove <路径>` 移除。它保留 Git 分支，但会删除工作目录；默认拒绝删除有未跟踪文件或修改的目录，不要用 `--force` 绕过检查。依赖或资源文件需要保留时先备份。
