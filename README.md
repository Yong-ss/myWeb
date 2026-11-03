# SquirrelAPI

个人长期项目：主站 [squirrelapi.org](https://squirrelapi.org) 与俱乐部管理应用 [club.squirrelapi.org](https://club.squirrelapi.org)。

## 技术栈

- **前端**：Next.js + TypeScript（静态导出）
- **运行与托管**：Cloudflare Workers（静态资源 + Worker 接口）
- **数据库与认证**：Supabase（PostgreSQL、RLS）
- **工程**：pnpm Monorepo、Playwright、GitHub Actions

## 目录结构

```
apps/
  web/     主站
  club/    Club 应用（导入、成员、历史、分析、管理）
supabase/  迁移与 SQL 测试
tests/     单元、浏览器与集成测试
scripts/   环境、测试与 CI 脚本
docs/      需求、架构、决策与测试文档
```

## 快速开始

需要 Node.js 24、pnpm 12.15.0。在仓库根目录打开 PowerShell：

```powershell
. ./scripts/env.ps1          # 每个新终端先载入
pnpm install --frozen-lockfile
pnpm dev                     # 主站 http://localhost:3000
pnpm club:preview            # Club 本地 HTTPS Worker（8788）
```

本地密钥放在被忽略的 `.dev.vars`，只使用 publishable key，切勿提交 service-role key 或密码。

## 常用命令

| 命令 | 用途 |
| :--- | :--- |
| `pnpm check` | ESLint、类型检查、构建 |
| `pnpm test:affected` | 按变更范围运行检查（日常使用） |
| `pnpm test:unit` | Node.js 单元测试 |
| `pnpm test:e2e` | Playwright 浏览器流程 |
| `pnpm test:db` | 隔离 PostgreSQL 上的 SQL 测试 |
| `pnpm test:integration` | 本地 Supabase + HTTPS Worker 真实集成测试 |
| `pnpm test:full` | 完整回归（重要发布前） |

测试绝不连接正式 Supabase。详情见 [docs/TESTING.md](docs/TESTING.md)。

## 部署

推送到 `main` 后，GitHub Actions 运行受影响的检查，全部通过才自动发布有改动的应用；纯文档、测试、脚本改动不发布。数据库迁移始终人工执行。

## 文档

- [架构](docs/ARCHITECTURE.md) · [Club 架构](docs/CLUB_ARCHITECTURE.md)
- [需求](docs/REQUIREMENTS.md) · [Club 需求](docs/CLUB_REQUIREMENTS.md)
- [决策记录](docs/DECISIONS.md) · [测试](docs/TESTING.md) · [性能](docs/PERFORMANCE.md)
- [Agent 规则](AGENTS.md)

带日期的历史验证与部署记录见 Git 历史和 `docs/`。
