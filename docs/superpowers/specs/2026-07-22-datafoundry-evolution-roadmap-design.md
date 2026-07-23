# DataFoundry 工程与企业交付演进路线

日期：2026-07-22  
状态：待统一审阅  
适用范围：工程可维护性、原生部署、容器化、单组织企业交付、持久化与运维基础  

相关规格：

- [原生一键部署设计](./2026-07-22-native-one-click-deployment-design.md)
- [正式认证统一与 TUI 登录设计](./2026-07-23-formal-auth-and-tui-login-design.md)

## 1. 执行摘要

DataFoundry 已具备较完整的数据 Agent 产品能力：Web、TUI、REST、AG-UI、Agent Runtime、Data Gateway、DataLink、文件、知识库、Artifact、会话恢复、Trace 和认证均已进入同一仓库。当前首要问题不是继续扩张功能面，而是降低部署门槛并控制快速迭代带来的结构复杂度。

本路线按以下顺序推进：

```text
M0A 原生一键部署
→ M0A.5 正式认证统一与 TUI 登录
→ M0B Docker Compose
→ M0C 企业能力工程前置
→ M1 单组织企业交付基础
→ M2 SQLite / PostgreSQL 双持久化路径
→ M3 渐进式工程边界治理
→ M4 K8s 与生产运维增强
```

团队约束是 1–2 人并大量使用 AI 辅助开发。因此路线不采用大规模重写，也不同时开启多条高耦合主线。每个里程碑必须可独立验收，并以契约测试、回归语料、健康检查和小步迁移限制 AI 快速生成代码时的回归风险。

## 2. 当前项目证据

### 2.1 已有基础

- TypeScript monorepo 包含 Web、TUI、API、Agent Runtime、Contracts、Metadata、Data Gateway、Files、Knowledge、Skills、Artifacts 和 Providers。
- Python `services/datalink` 提供语义图构建、REST、MCP、CLI 与测试。
- API 同时暴露 `/api/v1/*` REST 资源接口和 `/api/copilotkit` AG-UI 运行接口。
- AG-UI 事件经过统一管线持久化、投影并推送客户端，可用于恢复、Trace 和审计。
- API 已有 `/healthz` 与 `/ready`，DataLink REST 已有 `/healthz`。
- CI 已覆盖 TypeScript build、Web tests/build、核心 smoke、DataLink lint/test/build/smoke 和文档构建。
- password 认证、Cookie、CSRF、密码重置和同源 Web BFF 已存在。
- 模型 Profile 可以通过 Web 创建、测试和启用，Secret 由服务端保存。

### 2.2 复杂度热点

审计时最大的源码文件包括：

| 文件 | 约行数 | 主要风险 |
| --- | ---: | --- |
| `apps/web/src/app/data-tasks/data-tasks-app.tsx` | 7,663 | 工作台编排、状态和 UI 职责集中。 |
| `packages/metadata/src/index.ts` | 4,694 | 类型、schema、repository 和 SQLite 实现集中。 |
| `apps/api/src/config-api.ts` | 4,246 | 多类资源路由、校验、DTO 和业务编排集中。 |
| `apps/web/.../TaskConsole.tsx` | 2,812 | 控制台展示与交互职责集中。 |
| `apps/web/.../data-task-state.ts` | 2,605 | Web 状态模型持续扩张。 |
| `apps/web/.../live-run-state.ts` | 2,429 | Web 独立解释 AG-UI 事件。 |
| `apps/tui/src/state/live-run-state.ts` | 1,659 | TUI 维护另一套运行状态解释。 |
| `apps/tui/src/ui/App.tsx` | 1,653 | TUI 顶层编排集中。 |
| `apps/api/src/server.ts` | 1,310 | HTTP、认证、REST、AG-UI 和 Run 编排集中。 |

文件行数不是单独的重构理由，但这些文件已同时承担多类职责，增加了局部修改的认知负担和 AI 辅助修改时的误伤范围。

### 2.3 近期变化特征

近期两次重要提交分别加入 Governed Analysis Protocol Runtime 和内置 DataLink，单次变更规模达到数千至数万行。能力建设速度很快，测试也在同步增加，但结构收敛速度落后于能力增长速度。后续需要把“新增能力时顺带收敛触及边界”变为默认工作方式。

### 2.4 企业交付缺口

- 无原生一键部署脚本、Dockerfile 或 Compose。
- Metadata 直接依赖 Node `DatabaseSync` 与 SQLite。
- workspace 当前以 personal/owner 为主，未形成单组织三角色模型。
- 生产 Secret Provider、审计导出、备份恢复和运维诊断尚未形成完整闭环。
- DataLink 的浏览器文件上传与建图未打通。
- DataLink 不能自动复用用户在 Web 创建的模型 Profile。
- K8s、多副本、对象存储和外部 Secret 尚未设计。
- TUI 在 password 认证模式下尚无正式的生产登录方式。
- 组织共享资源、用户私有资源、Session 和 Artifact 的可见性规则尚未定义。
- 缺少覆盖 Metadata、Mastra 状态、文件、DataLink 图和加密主密钥的一致性备份集合。
- 发布版本、SBOM、漏洞扫描、离线安装、资源配额和数据保留策略尚未形成企业交付标准。

## 3. 已确认决策总表

| 主题 | 已确认决策 | 对路线的影响 |
| --- | --- | --- |
| 主要方向 | 工程可维护性 + 企业可交付性。 | 暂不以具体业务 PoC 或分析效果领先为近期主线。 |
| 团队模型 | 1–2 人，大量使用 AI 辅助开发 / vibe coding。 | 必须限制并行战线，以自动化门禁替代人工记忆。 |
| 改造方式 | 渐进式收敛，保持 REST、AG-UI 与现有功能兼容。 | 不做大爆炸式清洁架构重写。 |
| 第一优先级 | 先做当前非容器形态的 Ubuntu/Debian 一键部署。 | 阶段 M0A 已有独立确认规格。 |
| M0A 后置门禁 | 在容器化前统一正式认证并补齐 TUI 登录。 | 三个可回归子阶段先迁移验证工具，再删除 dev 身份与 TUI Demo。 |
| 第二优先级 | 完成 M0A.5 后提供 Docker Compose。 | M0B 复用 M0A 的运行边界和 M0A.5 的正式认证语义。 |
| 容器路线 | Compose 首发，边界兼容未来 K8s；首期不交付 Helm。 | M4 再实现 K8s。 |
| 企业租户 | 单组织、多用户、单实例；不做跨组织 SaaS 多租户。 | 身份与数据作用域围绕一个 organization/workspace。 |
| 最小角色 | 管理员、分析师、查看者。 | 首期固定角色，不做自定义权限引擎。 |
| 持久化 | SQLite 默认，PostgreSQL 可选；先抽象 repository/transaction 再增加 adapter。 | 保留低门槛部署，同时为并发与 K8s 留路径。 |
| REST / AG-UI | 二者是同一 HTTP 服务上的并列北向协议，不是上下层关系。 | 二者复用应用服务和领域契约，但互不调用路由实现。 |
| TUI 定位 | 分析能力是一等公民；管理能力不要求与 Web 完全对等。 | TUI 保留运行、恢复、Artifact 等核心能力，复杂管理留在 Web。 |
| Web/TUI 公共层 | 当前不抽共享运行时或公共 reducer。 | 先共享协议、事件语料和一致性门禁；重复维护成本被证明后再局部抽取。 |
| DataLink 默认 | 原生无交互部署默认关闭；交互部署说明能力后由用户选择。 | 基础部署仅要求 Node.js，Python/uv 成为可选依赖。 |
| 模型配置 | 部署脚本不配置模型；部署后在 Web 创建、测试和启用模型 Profile。 | 无模型仍可启动平台，Agent Run 前再要求模型。 |
| 原生进程管理 | 当前仓库目录后台运行，不安装 systemd。 | 使用 PID、进程组、日志文件与脚本命令管理。 |
| 依赖安装 | 逐项检测并取得同意，可使用 `sudo apt` 安装 Node/Python；uv 采用明确授权的官方方式。 | 应用仍以当前用户运行，sudo 仅用于系统依赖。 |
| 端口交互 | 对每个启用服务检查端口，用户选择使用或指定其他端口，并循环验证。 | 不自动 kill，不静默随机换端口。 |

## 4. 明确延期但保留的方向

以下方向没有被否定，只是不进入当前第一实施阶段：

- Docker Compose 和镜像发布。
- 单组织成员邀请、三角色权限和管理 UI。
- PostgreSQL Metadata adapter。
- Secret Provider abstraction 与 Vault / KMS。
- API、Metadata、Web 大文件渐进拆分。
- Web/TUI 协议一致性 fixture 与 conformance harness。
- K8s、Helm、对象存储、多副本和集中监控。
- DataLink 文件资产建图桥接。
- DataLink 与 Web 模型 Profile 的安全桥接。
- 分析可信度评测、统一语义层、自主分析循环和特定行业黄金场景。

## 5. 目标架构原则

长期架构分为四个逻辑层，但不要求立刻拆成大量 package：

```text
北向适配
├─ REST Adapter
├─ AG-UI Adapter
├─ Web Client
└─ TUI Client

应用服务
├─ Identity & Access
├─ Workspace Administration
├─ Analysis Run
├─ Resource Configuration
├─ Artifact & File
└─ Deployment Operations

领域与契约
├─ Organization、Membership、Role
├─ Session、Run、Checkpoint、Event
├─ Datasource、Knowledge、Skill、Artifact
└─ Repository、Transaction、Secret Ports

基础设施适配
├─ SQLite / PostgreSQL
├─ Local Files / Object Storage
├─ Local Encryption / External Secret Provider
├─ Data Gateway
└─ DataLink、MCP、Model Providers
```

约束：

1. REST 与 AG-UI 只能调用应用服务，不能互相调用路由实现。
2. 应用服务拥有用例编排、授权、事务和审计边界。
3. 领域契约不依赖 Next.js、CopilotKit、SQLite 或具体数据库驱动。
4. 基础设施通过显式 Port 替换，不把 provider 细节泄漏到 UI。
5. 先在现有 package 中建立目录和接口边界，边界稳定后再决定是否拆包。

## 6. TUI 演进原则

TUI 继续通过 REST 管理和读取资源，通过 AG-UI 发起与观察 Run。服务端持有 Session、Run、Checkpoint、消息、Artifact 和中断状态；TUI 只持有视图、滚动、输入历史、快捷键和终端布局等本地状态。

M0A.5 先让 TUI 复用 password 登录、Session Cookie 和 CSRF，支持 Web 注册引导、本地 Session 恢复与账号切换，并彻底删除 dev token。M1 再评估 PAT 或 device-code，用于非交互自动化、作用域令牌和更强的终端授权体验；它们不再是 TUI 能否连接正式部署的前置条件。

TUI 能力优先级：

1. 发起、观察、取消和恢复分析。
2. 查看 SQL、步骤、Trace 摘要、表格和 Artifact。
3. 选择数据源、模型、Skill、文件和知识库。
4. 查看当前身份、服务状态和可用资源。
5. 成员邀请、角色管理、复杂资源表单和部署管理保留在 Web。

近期不抽 Web/TUI 公共 reducer。两端继续独立实现，但必须逐步建立共同的平台不变量：唯一 Run 终态、Tool call/result 配对、取消/失败/中断语义、恢复等价性、重复事件幂等和 Artifact 关联。

只有同时满足以下条件才重新评估共享实现：

- 同类协议 Bug 已在两端重复修复多次。
- AG-UI 事件模型稳定。
- 两端已运行相同的脱敏 fixture 和 conformance tests。
- 能明确指出一个稳定、纯粹、无 UI 依赖的小逻辑单元。

## 7. 路线总览

| 里程碑 | 目标 | 相对规模 | 前置条件 |
| --- | --- | --- | --- |
| M0A | Ubuntu/Debian 原生一键部署 | 中 | 当前代码即可开始。 |
| M0A.5 | 正式认证统一与 TUI 登录 | 中 | M0A 的 password 部署链路可验证。 |
| M0B | Docker Compose 快速部署 | 中 | M0A 运行边界和 M0A.5 正式认证语义稳定。 |
| M0C | 企业能力工程前置 | 小到中 | M0B 可重复交付；只建立 M1/M2 必需的边界和门禁。 |
| M1 | 单组织三角色企业基础 | 大 | M0C 的身份、作用域、迁移和授权边界稳定。 |
| M2 | SQLite / PostgreSQL 双路径与备份恢复 | 大 | M0C 的 Repository/transaction Port 设计确认。 |
| M3 | 渐进式工程边界治理 | 持续 | 每次只迁移一个边界，并有行为保护。 |
| M4 | K8s 与生产运维增强 | 大 | Compose、PostgreSQL、外部存储边界稳定。 |

规模表示相对复杂度，不表示固定工期。1–2 人团队一次只将一个里程碑设为主线；M3 的小型守护任务可以伴随其他里程碑，但不得演变成并行大重构。

## 8. M0A：原生一键部署

### 8.1 目标

在已克隆仓库内执行 `./deploy.sh`，完成配置生成、依赖安装、端口协商、构建、后台启动和健康验证。

### 8.2 交付物

- 根目录 `deploy.sh`。
- 配置和端口辅助模块。
- `deploy/start/stop/restart/status/logs/doctor/help` 命令。
- `--reconfigure` 与 `--non-interactive`。
- PID、进程组、运行日志、部署日志和脱敏诊断。
- 默认关闭 DataLink，交互式可开启。
- 无模型配置可启动，前端完成模型配置。
- Ubuntu CI native deployment smoke。
- 一屏主路径部署文档。

### 8.3 退出门槛

- 全新 Ubuntu/Debian 环境在满足网络和 sudo 条件时可按文档完成部署。
- 非默认端口下 REST、Web BFF 和 AG-UI SSE 正常。
- 重复部署保留 Metadata 和文件资产。
- 未知端口占用进程不会被结束。
- 日志、状态文件和 CI 输出不泄漏 Secret。
- 所有命令语义和失败输出符合独立 M0A 规格。
- 重复部署采用明确维护窗口，停止旧服务后才原地安装和构建；失败时数据完整且状态可诊断。

完整行为见 [原生一键部署设计](./2026-07-22-native-one-click-deployment-design.md)。

## 8A. M0A.5：正式认证统一与 TUI 登录

### 8A.1 目标

删除 API、Web 和 TUI 的开发认证旁路，为 TUI 增加 password 登录、Web 注册引导、本地 Session 恢复、账号切换和注销，使 Web 与 TUI 以同一正式用户访问同一服务端记录。

### 8A.2 交付物

- password-only API 身份路径；
- TUI Auth Client、Session Store 和 REST/AG-UI 统一认证传输；
- TUI 登录、Web 注册跳转、7 天 Session、`--no-auto-login` 与 `/logout`；
- loopback HTTP / 外部 HTTPS Cookie 边界和注册开关；
- 开发期人工重置旧 storage，不开发迁移或自动清理代码；
- 删除 Web 开发身份和 TUI `--demo`；
- 正式注册、验证、Cookie 和 CSRF 的跨端测试。

### 8A.3 退出门槛

- 业务 REST 和 AG-UI 请求不再接受匿名身份、dev token 或 `X-Dev-Token`；
- Web 与 TUI 登录同一用户后可以互相查看并恢复会话；
- TUI 不保存密码，Session 文件和日志符合脱敏要求；
- M0A 默认仅监听 loopback，非 loopback 访问必须使用 HTTPS；
- 新 schema 不包含开发身份，应用不包含旧存储迁移和自动删除逻辑；
- 本地验证、CI 和原生部署 smoke 均走 password 认证。

完整行为见 [正式认证统一与 TUI 登录设计](./2026-07-23-formal-auth-and-tui-login-design.md)。实施按 M0A.5a（正式认证基础）→ M0A.5b（TUI 登录）→ M0A.5c（password-only 收口）三个可独立回归的 PR 推进；身份探测复用现有 `GET /api/v1/me`。

## 9. M0B：Docker Compose

### 9.1 目标

将 M0A 验证过的运行边界转换为可重复、可迁移的容器部署，不改变 REST、AG-UI 或用户配置语义。

### 9.2 推荐拓扑

```text
browser
  ↓
web
  ↓ internal network
api
  ├─ metadata / storage volume
  ├─ datalink-rest (optional profile)
  └─ datalink-mcp  (optional profile)
       └─ datalink graph volume
```

一个容器只运行一个主要进程。Web 是默认公开入口；API 和 DataLink 默认只在 Compose 网络可达。DataLink 通过 profile 可选启用。

### 9.3 交付物

- Web、API、DataLink 多阶段镜像。
- `.dockerignore` 与固定构建上下文。
- Compose 服务、网络、持久卷、healthcheck 和启动依赖。
- `.env` / Compose secrets 使用说明。
- SQLite 与文件 storage 持久化。
- DataLink 图持久化。
- 备份、恢复、升级和诊断命令。
- AG-UI SSE 反向代理防缓冲验证。
- CI 镜像构建与 Compose smoke。
- HTTPS 反向代理、安全 Cookie、基础安全响应头和只暴露 Web 入口的部署基线。
- 镜像版本标签、SBOM、依赖与镜像漏洞扫描。
- 外部 URL 与连接配置的基础 SSRF / 出站限制说明，至少阻止明显的回环、链路本地和云 Metadata 滥用路径。
- 在线部署与离线/隔离网络部署的支持边界；若首期不支持离线，必须明确声明并列出所需外部地址。
- 基础结构化日志和 request/run correlation，便于 Compose 环境诊断。

### 9.4 退出门槛

- `docker compose up -d` 后 Web、API 和可选 DataLink 达到健康状态。
- 只替换镜像不丢失 Metadata、文件和图数据。
- 默认镜像以非 root 用户运行。
- 原生部署与 Compose 使用相同核心配置含义。
- Data Gateway 原生依赖在目标 Linux 架构上通过构建和连接 smoke。
- 镜像和依赖扫描没有未处置的高危发布阻断项。
- HTTPS 参考部署下登录、Cookie、REST 和 AG-UI SSE 均通过验收。

## 10. M0C：企业能力工程前置

### 10.1 目的

M0C 不是全面重构，而是在增加 RBAC 和 PostgreSQL 前建立最小安全落点，避免把新企业能力继续写入现有巨石后再迁移一次。

### 10.2 交付物

- 明确 Organization、Workspace、User 与 Resource 的领域术语和标识关系。
- 为 identity、membership、resource scope 建立最小应用服务边界。
- 为即将新增的组织与成员数据建立最小 Repository 和 Transaction Port；现有 SQLite 仍是唯一实现。
- 建立 schema version、向前 migration、migration dry-run 和备份前置检查。
- 建立 REST / AG-UI 身份上下文一致性测试。
- 建立授权拒绝路径的通用测试工具，确保后续权限不只依赖 UI。
- 为版本化 REST DTO、AG-UI event 和持久化事件建立兼容性规则与变更检查。
- 建立跨层 import 和新增职责门禁，但不在本阶段拆完 API、Metadata 或 Web 大文件。

### 10.3 退出门槛

- M1 可以通过应用服务增加角色判断，而不需要在每个路由复制授权逻辑。
- M1 新 schema 变化必须通过版本化 migration 执行并可在备份副本上演练。
- M2 可以在不改变应用服务调用方式的情况下替换最小 repository 实现。
- 现有 REST、AG-UI、Web 和 TUI 行为通过回归测试，没有大规模目录迁移。

## 11. M1：单组织企业交付基础

### 11.1 已确认范围

- 一个部署实例对应一个组织。
- 组织内支持多个用户。
- 固定角色：管理员、分析师、查看者。
- 不提供跨组织租户或自定义角色编辑器。

### 11.2 推荐职责

初始角色边界建议在实施设计时细化：

| 能力 | 管理员 | 分析师 | 查看者 |
| --- | --- | --- | --- |
| 成员与角色管理 | 是 | 否 | 否 |
| 模型、数据源、MCP、Skill 配置 | 是 | 受限或否 | 否 |
| 发起分析 Run | 是 | 是 | 否或受限 |
| 查看共享 Session / Artifact | 是 | 是 | 是 |
| 下载与导出 | 是 | 是 | 按策略 |
| 查看审计 | 是 | 否 | 否 |

表中“受限或否”和“按策略”是 M1 开始前必须关闭的开放决策，不能直接进入实现。

### 11.3 资源作用域模型

M1 在角色实现前必须确定每类对象的所有权、可见性和管理边界，不能只定义用户角色。至少覆盖：

| 对象 | 必须决定的规则 |
| --- | --- |
| 模型、数据源、MCP、Skill、Knowledge | 组织共享、创建者私有或两者兼容；谁能修改和轮换 Secret。 |
| Session、Run、Checkpoint | 默认私有还是组织可见；管理员是否可读取内容；协作者如何授权。 |
| Artifact、文件、查询历史 | 继承 Session 权限还是独立分享；下载、导出和删除权限。 |
| Audit、Token、PAT | 谁能查看、创建、吊销和导出；是否允许用户查看自己的记录。 |
| 用户离职后的资源 | 转移、冻结、保留或删除策略。 |

服务端查询必须同时应用 organization/workspace scope、对象所有权和角色权限。当前同时携带 `user_id` 与 `workspace_id` 的记录需要逐类迁移，不能统一删除其中一个字段后假设语义自然成立。

### 11.4 交付物

- Organization、Membership、Role 数据模型。
- 从 personal workspace 到单组织 workspace 的兼容迁移。
- 成员邀请、禁用和角色变更。
- REST 与 AG-UI 统一身份作用域。
- 应用服务边界的授权检查，避免只在 UI 隐藏按钮。
- 管理员 Web 页面。
- 关键管理与数据访问审计事件。
- 权限矩阵契约测试。
- TUI 非交互认证增强；优先评估可吊销、有作用域和过期时间的 Personal Access Token，device-code 可作为后续体验增强。
- 登录限流、密码尝试保护、Session/PAT 吊销与 Secret 轮换入口。
- 文件、Session、Artifact 和 Audit 的基础保留与删除策略。
- 面向组织的基础配额：并发 Run、文件空间、单文件大小和可配置的模型使用上限。
- 文件上传执行大小、扩展名、MIME/内容一致性、压缩包展开上限和路径隔离检查，并预留恶意文件扫描 hook。

### 11.5 退出门槛

- 三角色的允许和拒绝路径都有服务端测试。
- 用户不能通过 REST、AG-UI、下载接口或 ID 猜测绕过角色边界。
- 现有个人部署数据可迁移且有备份说明。
- 管理员可以完成成员全生命周期管理。
- 审计记录能回答谁在何时对什么资源执行了什么动作。
- Web 与 TUI 均通过正式认证方案访问同一身份作用域，dev token 不进入正式验收。
- 资源作用域、对象所有权、分享和离职转移都有服务端允许/拒绝测试。
- 基础限流、配额和数据保留策略有明确默认值与管理员可见状态。

## 12. M2：持久化、备份与 Secret

### 12.1 目标

保留 SQLite 的低门槛路径，同时提供 PostgreSQL 作为更高并发和未来 K8s 部署的 Metadata 后端。

### 12.2 实施顺序

```text
梳理 repository 与事务语义
→ 从 MetadataStore 中抽出 Port
→ 现有 SQLite 实现适配 Port
→ 建立迁移和契约测试
→ 增加 PostgreSQL adapter
→ 双后端运行相同 repository contract suite
```

不先写 PostgreSQL 版本再倒逼接口；以现有真实用例和事务边界提取最小 Port。

### 12.3 交付物

- Repository、Transaction、Migration Ports。
- 按领域拆分的 SQLite repository 文件。
- PostgreSQL adapter。
- schema version 与向前迁移工具。
- SQLite 一致性备份与恢复。
- PostgreSQL 备份恢复文档和 smoke。
- Secret Port；本地加密实现继续作为默认路径。
- 外部 Secret Provider 的接口边界，但 Vault/KMS 实现可进入 M4。
- 一致性备份清单，覆盖 Metadata、Mastra/Agent 状态、文件资产、DataLink 图、配置和加密主密钥。
- 恢复顺序、完整性校验、密钥缺失处理以及可演练的备份/恢复命令。
- 明确的 RPO、RTO 和备份保留基线；轻量部署与企业部署可以采用不同等级，但必须显式声明。
- 面向 DataLink 建图、大文件处理和 Artifact 导出的持久化 Job 状态与最小队列边界，避免多用户场景下用同步请求承载所有长任务。
- 数据生命周期执行能力：过期 Session、Artifact、文件和审计记录的安全清理与保留豁免。

### 12.4 退出门槛

- SQLite 与 PostgreSQL 运行相同的 repository contract suite。
- 关键多表写入拥有明确事务边界。
- 两种后端都能完成安装、升级、备份和恢复演练。
- 应用服务不直接依赖 `DatabaseSync`、SQL 占位符风格或具体驱动类型。
- 一次恢复演练能重建可登录、可读取历史、可访问文件且可解密 Secret 的完整实例，而不是只恢复单个数据库。
- 长任务在服务重启后具有明确的恢复、失败或取消状态，不留下永久“运行中”记录。

## 13. M3：渐进式工程边界治理

M3 不是一次性重构项目，而是若干可独立验收的迁移单元。

### 13.1 API Server

目标结构：

```text
apps/api
├─ bootstrap
├─ transport/rest
├─ transport/agui
├─ application
└─ infrastructure
```

先抽纯路由适配与 Run 应用服务，不改变公开路径、SSE 事件或认证行为。`server.ts` 最终只负责组合依赖和创建 HTTP Server。

### 13.2 Config API

按资源族拆分 route adapter：identity、workspace、datasource、model、MCP、skill、knowledge、file、artifact、DataLink。公共 HTTP 解析、错误映射和 DTO 投影保留统一实现；业务规则进入应用服务。

### 13.3 Metadata

按 repository 和 schema migration 继续拆分 `packages/metadata/src/index.ts`。M2 已完成 SQLite / PostgreSQL 双 adapter，M3 只治理剩余职责集中和依赖方向，不再次改变存储语义。避免在同一变更中同时拆文件、改 schema 和改业务语义。

### 13.4 Web

把 `data-tasks-app.tsx` 收敛为 workspace shell 和 feature composition，逐步抽出 session controller、run controller、resource configuration 和 feature panels。组件拆分必须围绕职责和测试边界，不以行数达标为目的。

### 13.5 Web/TUI 一致性

首期只共享：

- 版本化 REST DTO 与 AG-UI event 类型。
- 脱敏事件 fixture。
- 平台级状态不变量。
- conformance test harness。

Web 和 TUI 保留独立 reducer 与 UI 状态。新增协议事件必须同时增加两端契约测试；有意差异记录在能力矩阵中。

### 13.6 架构门禁

- 跨层 import 规则。
- 公共 DTO / event schema 变更检测。
- REST 恢复快照与实时 AG-UI 终态等价测试。
- 大文件新增职责审查，而不是机械禁止文件增长。
- 每次迁移保留 feature flag、adapter 或可回退入口，稳定后删除旧路径。
- REST、AG-UI、持久化事件和 TUI 客户端采用明确的版本与弃用窗口；breaking change 必须有迁移说明和兼容测试，不能只依靠同时升级 monorepo。

## 14. M4：K8s 与生产运维增强

进入条件是 Compose、PostgreSQL、持久化 Port 和 Secret Port 已稳定。

候选交付物：

- Helm chart、Ingress、readiness/liveness 和资源限制。
- 外部 PostgreSQL、对象存储和 Vault/KMS。
- 结构化日志、metrics、trace correlation 和告警。
- 审计导出、保留策略和合规存档。
- 异步 job worker 与长任务隔离。
- 多副本下的 Run ownership、取消、恢复和事件一致性。
- 正式备份恢复演练和升级回滚手册。
- 网络策略、精细出站控制、Secret 自动轮换和审计日志外部归档。
- 按组织或工作负载的高级配额、成本预算、容量规划和 SLO 告警。

M4 不默认扩展到跨组织 SaaS 多租户。若未来需要多租户，应作为新的产品和安全设计周期处理。

## 15. 跨阶段工程工作方式

### 15.1 适合 AI 辅助开发的约束

1. 一个变更只处理一个用例或一个边界。
2. 修改前先补行为测试或事件 fixture。
3. 不在同一提交中混合功能、重命名、目录迁移和 schema 变化。
4. 生成代码必须通过类型检查、目标测试和相关 smoke。
5. 公共协议变化必须列出 Web、TUI、REST、AG-UI 和恢复路径的影响。
6. AI 不自动选择破坏性数据迁移、Secret 操作或端口进程终止策略。
7. 每个里程碑保留一份决策日志和退出门槛，不用聊天记忆代替工程事实。

### 15.2 验证层次

```text
纯函数与 schema 单元测试
→ repository / adapter contract tests
→ REST / AG-UI 协议测试
→ Web / TUI conformance tests
→ 原生部署 / Compose smoke
→ 真实环境验收
```

## 16. 开放决策登记

这些问题尚未确认，必须在对应里程碑开始前决策：

| 里程碑 | 开放决策 | 决策时机 |
| --- | --- | --- |
| M0A | test 邮件验证链接是否需要部署脚本提供更直接的查看入口。 | 实施计划拆解时。 |
| M0A | 支持的 Ubuntu / Debian 最低版本和 CPU 架构。 | CI 镜像选择前。 |
| M0A | 日志轮转阈值、保留文件数和健康检查总超时。 | 实施计划拆解时。 |
| M0A | Node/Python/uv 安装源、版本锁定和下载校验策略。 | 依赖安装任务实现前。 |
| M0B | 镜像发布到哪个 Registry，是否发布 arm64。 | 镜像 CI 设计前。 |
| M0B | Data Gateway 大型原生驱动是进入主镜像还是拆成可选镜像。 | Dockerfile 设计前。 |
| M0B | Compose secrets 与 `.env` 的默认优先级。 | Compose 配置设计前。 |
| M0B | 首期是否支持离线安装包；若不支持，明确允许访问的依赖和镜像地址。 | 镜像发布设计前。 |
| M0B | 官方 HTTPS 参考拓扑采用内置反向代理还是复用客户现有网关。 | Compose 设计前。 |
| M0C | Organization 与现有 personal workspace 的稳定 ID 和迁移映射。 | Identity Port 定稿前。 |
| M0C | REST、AG-UI 和持久化事件的兼容窗口与弃用策略。 | 兼容性门禁实现前。 |
| M1 | 分析师是否可以创建和修改数据源、模型、MCP 和 Skill。 | 权限矩阵设计时。 |
| M1 | 查看者是否可以发起只读 Run 或下载 Artifact。 | 权限矩阵设计时。 |
| M1 | 初始管理员如何引导创建，现有用户如何迁移。 | 数据迁移设计前。 |
| M1 | 邀请采用邮件链接、管理员临时链接还是两者兼容。 | 身份流程设计时。 |
| M1 | 各资源是组织共享、创建者私有还是允许显式分享；管理员是否可读取用户会话内容。 | 资源作用域设计时。 |
| M1 | TUI 非交互认证采用 PAT 还是 device-code；Token 的作用域、过期和吊销规则。 | TUI 自动化认证实现前。 |
| M1 | Session、Artifact、文件和 Audit 的默认保留期与删除豁免。 | 数据生命周期实现前。 |
| M1 | 并发 Run、文件空间和模型成本的默认配额。 | 配额实现前。 |
| M2 | PostgreSQL driver、query builder 和 migration 工具选择。 | Storage Port 确认后。 |
| M2 | SQLite 与 PostgreSQL 是否承诺双向数据迁移。 | 备份恢复设计前。 |
| M2 | Secret Provider 首期只定义接口还是同时实现 Vault。 | 企业客户约束明确后。 |
| M2 | 完整备份集的 RPO、RTO、保留周期和恢复演练频率。 | 备份设计前。 |
| M2 | 长任务使用内置持久化队列还是外部队列。 | Job 状态模型确认后。 |
| M3 | 哪个大文件作为第一个渐进拆分样板。 | M3 启动时，以当时变更频率选择。 |
| M3 | conformance fixture 的版本和兼容窗口。 | 事件语料建立时。 |
| M4 | K8s 单副本还是多副本作为首个验收目标。 | Helm 设计前。 |
| 跨阶段 | DataLink 如何安全复用 Web 模型 Profile。 | DataLink 需要默认启用前。 |
| 跨阶段 | 文件上传后如何通过 `fileAssetId` / `datasourceId` 触发 DataLink 建图。 | DataLink 文件导入设计时。 |
| 跨阶段 | 可配置外部 URL 的 SSRF、DNS rebinding 和出站网络策略。 | M0B 基线设计并在 M4 强化。 |

## 17. 风险与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| 同时推进部署、RBAC、PostgreSQL 和大重构 | 失去可验收增量。 | 一次一个主里程碑，其他仅做必要守护。 |
| 为追求公共层统一 Web/TUI | 集中回归和 UI 语义混淆。 | 先共享契约和测试，不共享实现。 |
| 容器化掩盖本地配置问题 | Docker 内运行但不可诊断。 | 先完成 M0A，稳定 config/health/storage。 |
| SQLite Port 抽象过度设计 | 大量接口但无法映射现有事务。 | 从现有 repository 用例提取最小 Port。 |
| RBAC 只做前端按钮隐藏 | 可通过 API 绕过。 | 授权进入应用服务并覆盖拒绝测试。 |
| AI 快速修改大文件 | 局部需求造成跨功能回归。 | 小批次、行为测试、diff scope 和架构门禁。 |
| DataLink 默认启用增加依赖和模型成本 | 快速部署失败面扩大。 | 原生和 Compose 均默认可选关闭。 |
| Secret 出现在日志或诊断 | 安全事故。 | 统一脱敏、测试 Secret scan、权限受限日志。 |
| test 邮件或开放注册暴露到网络 | 未授权用户自助注册和占用资源。 | test 邮件仅允许 loopback；M0B 创建所有者后默认关闭注册。 |
| production Cookie 与 HTTP 地址不一致 | 登录循环或在网络中暴露 Session。 | loopback HTTP 例外；所有非 loopback 入口强制 HTTPS 和 Secure Cookie。 |
| RBAC 没有对象作用域模型 | 管理员、创建者和查看者看到错误资源。 | 先定义资源所有权、分享、继承和离职转移，再实现角色。 |
| 在运行目录执行原地依赖更新 | 旧服务加载到一半新一半旧的依赖。 | M0A 更新采用明确维护窗口，停止后再 `npm ci/build`。 |
| 可配置外部地址导致 SSRF / 出站滥用 | 访问内网或云 Metadata。 | M0B 建立基础拒绝策略，M4 使用网络策略和精细 allowlist。 |
| 只备份 Metadata DB | 文件、Agent 状态、图或密钥无法恢复。 | 定义完整备份集、恢复顺序、RPO/RTO 并定期演练。 |
| 未建立发布供应链门禁 | 镜像或依赖携带已知漏洞。 | 版本锁定、SBOM、漏洞扫描和发布阻断策略。 |

## 18. 全局完成标准

本路线完成后应达到：

- 新用户可以选择原生脚本或 Docker Compose 快速部署。
- 一个组织内的管理员、分析师和查看者拥有服务端强制的明确权限。
- SQLite 继续支持轻量部署，PostgreSQL 支持更高并发和 K8s 路径。
- REST 与 AG-UI 作为并列 adapter 复用应用服务，协议兼容性有自动化保护。
- Web/TUI 保持各自体验，同时共享平台契约与行为门禁。
- Metadata、API 和 Web 的高复杂度文件逐步按职责收敛，没有大爆炸迁移。
- 备份、恢复、Secret、日志、健康、审计和升级形成可演练的企业交付闭环。
- 组织共享资源与用户私有资源拥有明确、可测试的作用域和生命周期。
- Web 与 TUI 均使用正式、可吊销的认证方式，不依赖 dev token。
- 镜像和原生安装依赖具备版本锁定、来源说明、SBOM/漏洞检查或等价供应链证据。
- 完整实例的 RPO/RTO、容量限制和基础 SLO 可配置、可观察并经过演练。

## 19. 当前下一步

M0A 原生部署实现完成后，当前进入 M0A.5。先为 [正式认证统一与 TUI 登录设计](./2026-07-23-formal-auth-and-tui-login-design.md) 生成逐文件、逐测试的实施计划；M0A.5 验收后再进入 M0B Docker Compose。后续里程碑在开始前继续进行小范围设计确认，不把本路线文档当成不可修改的长期承诺。
