# 邮件服务配置与恢复

更新：2026-11-06（马来西亚时间）。本文不保存密钥、SMTP 密码或邀请链接。

## 配置关系

Supabase Auth → Resend SMTP → 收件服务器；Cloudflare 托管域名的公开 DNS，用于 Resend 发信验证及追踪域名解析。

生产项目：myWeb's Project（`lnwifbsjfwchshtxyzcu`）。只读核对确认 Custom SMTP 已开启，Host 为 `smtp.resend.com`，端口 `465`，用户名 `resend`，Sender Email 为 `no-reply@squirrelapi.org`，发件人名称为「俱乐部数据检测平台」。原密码保持不变；此次真实 Auth 邀请已通过该 SMTP 发送并获得 Resend delivered，确认现有密码有效。

邀请、密码重置等 Supabase Auth 邮件通常共用项目 SMTP；若启用 Send Email Hook，则须另查 Hook 是否接管发送。SMTP 页面正确不等于所有应用流程已验证。

## 必要 DNS

域名 `squirrelapi.org`，Resend 区域 `us-east-1`；以下名称均相对该域名，TTL 使用 Auto，全部 DNS only。

| 类型 | 名称 | 内容 | 优先级 |
| --- | --- | --- | --- |
| TXT | `resend._domainkey` | 从 Resend 当前 Domain 页面/API 原样复制完整 `p=…` 公钥 | — |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` | 10 |
| CNAME | `links` | `links1.resend-dns.com` | — |

DKIM 公钥可公开查询，但恢复时应以 Resend 当前值为准，不能自行生成或沿用其他域名的值。`send` 的 MX 用于发信反馈，不代表根域名提供收件服务；Receiving 当前关闭。`links` 不可开启 Cloudflare 代理。

## 故障恢复步骤

1. 读取 Resend 当前 Domain 的名称、区域、全部验证记录；导出或读取 Cloudflare 现有记录，逐项检查重复及 CNAME 冲突。
2. 只恢复缺失的邮件记录；保留网站 AAAA、Workers 和其他无关记录，不以整区替换方式清理 DNS。
3. 从公共解析器（如 `1.1.1.1`、`8.8.8.8`）查询 DKIM TXT、send TXT/MX、links CNAME，核对内容及 MX 优先级；DNS only 状态在 Cloudflare 配置中核对。
4. 触发 Resend Domain Verification，并等待 Domain 和各记录的最终状态；pending/partially_verified 不可写成全部 Verified。
5. 只读检查 Supabase Custom SMTP、Sender 域名、模板、跳转白名单及 Send Email Hook；密钥有效则保留。
6. 经允许的测试邮箱从 Supabase Auth 发送真实邀请，核对 Auth 错误日志、Resend 邮件事件与收件箱；Sent 只表示提交，Delivered 表示收件服务器接收，不保证进入主收件箱。
7. 密码重置邮件端到端测试保留为单独验收项目，另行确认发送、收件及正确跳转；不要为了测试擅自改密码或授予业务权限。

## 本次恢复记录

- 用户调查：2026-10-26 05:08（马来西亚时间）Cloudflare MCP OAuth 删除过 7 条 DNS，其中包括此前配置的邮件记录；此次未重新审计该历史事件。
- 恢复前 Cloudflare 仅有根域与 club 子域的两条 AAAA；此次新增上述四条邮件记录，无重复或冲突，两条原 AAAA 的 ID、内容、代理状态和修改时间均未改变。
- 四条记录均已通过 `1.1.1.1` 和 `8.8.8.8` 公开查询；Resend DKIM、SPF TXT、MX、links 及 Domain 最终全部 verified。
- 未更换 API Key、SMTP 密码，未修改 Supabase、Workers 或其他 DNS 配置。
- 2026-11-06 23:32（马来西亚时间）经用户指定的测试收件地址，Supabase 显示邀请发送成功，Resend 事件为 delivered，证明现有 SMTP 凭据可用且收件服务器已接收；用户已确认收到邀请；主收件箱/垃圾箱归类及邀请链接后续操作未验证。初次使用已注册邮箱被 Auth 拒绝，未发送；改用用户指定的未注册邮箱成功创建测试 Auth 账户，未额外授予业务角色。密码重置端到端测试未执行，Send Email Hook 状态未检查。

## 只读检查与建议（未实施）

现有 Supabase + Resend SMTP 架构保持不变，无需额外重构；DMARC、API Key 权限优化及关闭邮件追踪仅为后续待办，实施前另行确认。

- SPF 是 Resend 返回的标准 `send` 子域记录，未发现重复 SPF；DKIM 与 Resend 当前公钥一致并已验证。
- `_dmarc.squirrelapi.org` 公共查询为 NXDOMAIN：建议另行授权后设置 DMARC，先以监测策略核对合法来源与对齐，再考虑 quarantine/reject；报告地址须由所有者确认，不添加未经确认的地址。
- Resend 当前 Open Tracking 开、Click Tracking 关；Open Tracking 涉及打开行为追踪，认证链接改写风险主要来自 Click Tracking。Auth 邮件建议关闭不必要的追踪，变更前另行确认。
- API Key 列表存在 `squirrelapi-supabase-smtp`、`SquirrelAPI-CN`、`S_SMTP`；列表工具未返回权限，不能凭名称判定 Full Access 或停用旧 Key。SMTP 建议仅有 Sending access 并限制发信域；先确认各 Key 的用途和调用方，再决定是否处理闲置或过宽权限。
- DNS 再次被删除、修改或把 links 开代理仍会导致故障；建议保存无凭据的邮件 DNS 清单，对变更做差异复核，并按需限制非维护用途的 DNS 写权限、监测 Resend 域名失败状态；此次未更改权限或新增服务。

参考：[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp)、[Resend 与 Supabase](https://resend.com/blog/how-to-configure-supabase-to-send-emails-from-your-domain)、[Supabase 邮件模板](https://supabase.com/features/email-templates)。
