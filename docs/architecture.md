# ChangeCheck v1 架构

> 最后更新：2026-10-08 ｜ 上游：project-brief（决策）· product-vision（完整形态）
> 原则：**内核是接入层，Web 只是展示面**——CLI/CI、Web、（未来的 MCP）都是同一内核的不同表面。
> v1 四天能交付、评审一键可跑；数据模型按完整形态分层设计，避免返工。

## 1. 总览

```
┌─────────────────────────────────────────────────────┐
│  Web 工作台（Next.js App Router，SSR + 客户端组件）   │
│  任务列表 → 任务详情(测试集/版本) → 新建运行 → 报告页  │
├─────────────────────────────────────────────────────┤
│  API 层（Route Handlers，Node runtime）              │
│  样例 CRUD/导入 · 版本配置 · 运行触发/查询/报告导出    │
├─────────────────────────────────────────────────────┤
│  内核 kernel（自研三层，自 m0 移植，UI 无关可独立调用）│
│  executor 执行器 │ checker 检查器 │ report 回归报告   │
├─────────────────────────────────────────────────────┤
│  存储 SQLite（node:sqlite，零原生依赖）              │
│  tasks/samples/versions/runs/run_items              │
├─────────────────────────────────────────────────────┤
│  被测模型 OpenAI 兼容 API（DeepSeek 默认，可换）      │
└─────────────────────────────────────────────────────┘
```

- **栈**：Next.js（App Router，TypeScript）+ SQLite（`node:sqlite` 内建模块，无需安装原生依赖）+ 原生 fetch 调用 OpenAI 兼容 API + Docker Compose 一键运行。
- **内核与 UI 解耦**：`src/lib/kernel` 不依赖 Next/React，CLI（v2）/MCP server（v2）直接复用；m0/ 目录保留为验证实验与种子数据来源。

## 2. 目录结构

```
changecheck/
├─ cli/                     # 接入层：CLI（配置即代码 + CI 守门，退出码=仅新增失败非零）
│  ├─ changecheck.ts        #   入口：init / run
│  └─ runner.ts             #   配置校验 + 内核编排（纯函数，可测试）
├─ example/                 # 可运行示例配置（也是本仓库 CI 看门的输入）
├─ docs/                    # 项目文档（唯一事实来源 project-brief）
├─ m0/                      # Milestone 0 验证实验（保留，含种子样例集与两版提示词）
├─ src/
│  ├─ app/                  # Web 展示面：页面与路由
│  │  ├─ page.tsx           # 任务列表（含新建任务入口）
│  │  ├─ tasks/new/         # 创建自定义任务（字段 schema）
│  │  ├─ tasks/[id]/        # 任务详情（验收标准/测试集/版本/运行历史）
│  │  │  ├─ samples/[sid]/  # 样例编辑/人工确认（检查项就在这确认）
│  │  │  └─ runs/new/       # 配置两版本发起对比运行
│  │  ├─ runs/[id]/         # 运行报告页（新增失败优先 + 证据展开）
│  │  └─ api/               # Route Handlers（见 §4）
│  ├─ components/           # 客户端组件
│  ├─ lib/
│  │  ├─ kernel/            # 内核三层：executor / checker / report（UI 无关，CLI 直接复用）
│  │  ├─ db.ts              # SQLite schema + 访问函数
│  │  ├─ seed.ts            # 首次启动播种：演示任务
│  │  ├─ requirements.ts    # 要求引导引擎 v0（NL → 检查项 → 规则开关）
│  │  └─ runs.ts            # 运行编排（快照/队列/进度）
│  └─ app/globals.css       # 极简手写样式（不引 UI 框架）
├─ tests/                   # 内核 + CLI 单元测试
├─ Dockerfile / docker-compose.yml
└─ data/changecheck.db      # 运行数据（gitignore）
```

## 3. 数据模型（SQLite）

> 对应 product-vision §5 信息架构：run 与 task 分离、检查项结构化存储、样例记录来源——为测试集积累与趋势回溯预留。

| 表 | 字段 | 说明 |
|---|---|---|
| `tasks` | id, name, scene, schema_json, created_at | 任务（场景）。v1 内置 `notice-extract` 中文通知提取模板（5 字段 schema） |
| `samples` | id, task_id, category, input, reference_json, checks_json, note, origin, enabled, created_at, updated_at | 测试样例 = 输入 + 参考答案 + **结构化检查项**（mustExtract/mustBeEmpty/critical）。`origin`: seed/manual/import/**real-error**（v2 回流入口） |
| `versions` | id, task_id, name, model, system_prompt, user_template, temperature, max_tokens, created_at | 版本配置。基线/候选 = 两条 version 记录，无专门表（报告天然支持任意两版对比） |
| `runs` | id, task_id, baseline_version_id, candidate_version_id, mode(real/mock), reps, status(pending/running/done/error), stats_json, error, created_at, finished_at | 一次对比运行。`stats_json` 存聚合结论（总体/分类/差异计数） |
| `run_items` | id, run_id, sample_id, version_role(baseline/candidate), rep, raw_output, parsed_json, latency_ms, usage_json, cost_cny, check_json, error | 逐条执行与检查记录，报告页的证据全部来自这里 |

设计要点：
- **检查结果落在 run_items.check_json**（字段级 fieldResults），报告 = 对 run_items 的纯聚合——报告页、导出、未来趋势回溯共用同一份证据。
- **费用/耗时逐条记录**，聚合时汇总；缺 usage 记 null（显示"未知"）。
- settings 不建表：v1 provider 走环境变量（`DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL`/`DEEPSEEK_MODEL`），计价常量在 kernel，均可在部署层覆盖。UI 化延后（product-vision 设置页为 v1.5+）。

## 4. API 路由

| 方法/路径 | 作用 |
|---|---|
| `GET /api/tasks` | 任务列表（空库时自动播种种子任务） |
| `POST /api/tasks/[id]/samples` | 新增样例 |
| `POST /api/tasks/[id]/samples/import` | 导入（`{source:"m0-seed"}` 按输入文本去重） |
| `PATCH /api/samples/[sid]`、`DELETE /api/samples/[sid]` | 编辑/确认检查项、删除（软开关走 PATCH `enabled`） |
| `POST /api/tasks/[id]/versions`、`PATCH /api/versions/[vid]` | 版本配置 |
| `POST /api/runs` | 创建对比运行，立即异步执行（进程内队列，单机 v1） |
| `GET /api/runs/[id]` | 运行状态 + 聚合报告 JSON（前端轮询至 done） |
| `GET /api/runs/[id]/report` | 导出 Markdown 报告（`report.md` 下载） |

读路径走 Server Components 直查 DB（少一层 HTTP）；写路径走 API（客户端组件 fetch + `router.refresh()`）。

## 5. 内核（自研三层，评审可识别的"非套壳"部分）

| 层 | 文件 | 职责 | m0 实测沉淀 |
|---|---|---|---|
| 执行器 | `kernel/executor.ts` | OpenAI 兼容批量调用：并发池、重试退避、max_tokens 截断检测、用量/费用/耗时记录、reps 重复 | 思考型模型 max_tokens≥2000；temperature=0 仍有波动 → 多数决 |
| 检查器 | `kernel/checker.ts` | JSON 提取、schema 校验、字段级规则（empty 恒关键违规）、参考答案对照、近似通过判定（event 命名放宽 + 日期数字保护） | 见 m0/README 工程问题 1–3 |
| 报告 | `kernel/report.ts` | 新增失败优先、关键要求标红、分类统计、费用耗时、采用建议三态（采用/复核/拒绝） | M0 报告结构直接沿用 |

完整形态的另两层（要求引导引擎、守门集成）不进 v1 代码：引导引擎的产出物结构 = `samples.checks_json`（v1 人工填写，v1.5 由引擎生成）；守门 = CLI/MCP（v2，直接 import kernel）。

## 6. 运行与部署

- 本地开发：`npm install && npm run dev`（需 `DEEPSEEK_API_KEY`；无 key 可用 mock 模式跑通全流程）
- 生产/评审：`docker compose up` → http://localhost:3000 ，数据落在 named volume，key 经 env 注入
- 首次打开自动播种：种子任务"中文通知信息提取" + 36 条样例（m0/samples.json）+ 两版本提示词（m0/versions.json）——即 project-brief 承诺的"可复现示例数据"

## 7. 为完整形态预留的扩展口（对应 product-vision）

| 扩展口 | v1 落点 |
|---|---|
| 趋势回溯（"该样例从 v3 开始挂"） | run 与 task 分离 + run_items 保留全历史 |
| 真实错误 → 回归用例 | samples.origin 字段 + import API |
| 多场景模板（分类/文档问答） | tasks.scene + schema_json 驱动，UI 不写死字段 |
| 多 provider | executor 只依赖 baseURL/model/key 三个参数 |
| MCP server（Agent 自跑验收） | kernel 零 UI 依赖，直接进程内复用 |
| CLI/CI 守门 | report 聚合函数返回结构化结论，可映射退出码 |
