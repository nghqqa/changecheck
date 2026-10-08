# 市场调研：LLM/AI 提示词评测与回归测试工具格局

> 调研时间：2026-10-07 ｜ 方法：agent 逐产品核查官网/GitHub/定价页 + 检索 2025-2026 新趋势，结论均有来源（见文末链接）
> 用途：差异化定位依据（技术创新答卷的"相关工作"素材）+ 路线图校准

## 一、格局五事实

1. **整合期**：promptfoo 已被 OpenAI 收购（2026-03，仍 MIT）；Langfuse 已被 ClickHouse 收购（2026-01，随 4 亿美元 D 轮）；Braintrust 估值 8 亿美元。头部开源项目"名花有主"，中立性出现信任真空。
2. **窗口**：OpenAI 托管版 Evals 面板 2026-10-31 只读、11-30 关闭，官方迁移指引指向 promptfoo（OpenAI 系）——第三方中立工具的获客窗口。
3. **分层**：开发时框架层（promptfoo/DeepEval：一条命令、CI 守门）｜平台层（Langfuse/LangSmith/Braintrust/Phoenix/Opik：tracing+实验+数据集，重部署或 SaaS）｜安全红队层。平台层全部向团队/企业迁移（$39-$249/月），无人服务个人开发者。
4. **能力矩阵结论**：两版对比(a)、CI 守门(e)、本地一条命令(f)已被满足；**回归优先报告(b) 与 NL→检查项引导(c) 全行业只有"部分"；生产错误积累(d) 做得好的全都不轻量**。
5. **中文空白**：中文生态只有模型榜单评测（ReLE/CLiB）和云厂商服务；没有中文优先、适配国产模型（GLM/Qwen/DeepSeek/Kimi）的个人开发者提示词回归工具。LLM-as-judge 模板也以英文标准为主。

## 二、四个确认的市场空白（= 我们的定位支柱）

| # | 空白 | 现状证据 | 我们的对应 |
|---|---|---|---|
| 1 | **"新增失败优先"无一等公民**：所有产品都以平均分/通过率仪表盘为中心，而方法论文章（TestMu/alt.qa/Pickaxe）都在推 "golden dataset + block on new failures" | promptfoo 仅 `--fail-on-error`；Braintrust 主打 regression 仍以分数为中心 | 回归报告（已实现）：新增失败→已修复→仍失败→通过率，关键违规标红 |
| 2 | **NL→检查项引导只存在于安全域**：promptfoo 红队已验证"自然语言→生成用例"交互可行，但仅限攻击向；业务质量向无人做 | promptfoo redteam docs | 要求引导引擎（v1.5）：业务要求→可勾选检查项→人确认→版本化规则 |
| 3 | **轻量本地 × 错误积累互斥**：d 强者都要 SDK/后端/SaaS；f 强者没有生产采集 | Langfuse 需 ClickHouse+PG；promptfoo 无生产采集 | 零运维积累路径：粘贴一条线上坏输出→一键入回归集（origin=real-error 字段已预留） |
| 4 | **中文优先完全空白** | 见事实 5 | 中文断言库（分词容忍/数字日期归一化/简繁）、国产模型一等公民、全中文报告与文档 |

## 三、产品方向结论（写进介绍文档的定位）

**ChangeCheck = 面向个人开发者的中文优先 AI 功能回归验收层**，占位 b×c×d×f 组合空白：
- 灵魂：回归优先报告（别家是仪表盘，我们是"这次改版改坏了什么"的证据链）
- 差异化交互：要求引导引擎（把"别瞎编时间"变成可确认的检查项——把 promptfoo 红队已验证的 NL→用例模式从安全域搬到业务质量域）
- 资产闭环：测试集随产品长大（真实错误→回归用例→每次改版复跑）
- 工程承诺：一条命令本地跑（Docker/npx）、内核 UI 无关可被 CLI/MCP 复用、中立开源（MIT，无厂商背景——对比 promptfoo/OpenAI、Langfuse/ClickHouse）

演进优先级校准（对 product-vision 的影响）：v1.5 的"要求引导引擎"和"粘贴坏输出入库"优先级上调（市场空白最大）；CLI 守门退出码语义定为"**仅新增失败非零**"（允许还债式改进，别家做不到）；v2 增加 GLM/Qwen/Kimi provider 预设 + 中文 LLM-as-judge 校准。

## 四、来源（节选）

- promptfoo 并入 OpenAI: https://github.com/promptfoo/promptfoo （README 原文）
- ClickHouse 收购 Langfuse: https://github.com/langfuse/langfuse
- OpenAI Evals 关停时间线: https://datanorth.ai/blog/evals-openais-framework-for-evaluating-llms
- promptfoo 红队 NL 配置（交互可行性证据）: https://www.promptfoo.dev/docs/red-team/configuration
- promptfoo CI 非零退出语义: https://www.promptfoo.dev/docs/integrations/ci-cd/
- Langfuse datasets（重部署证据）: https://langfuse.com/docs/evaluation/experiments/dataset
- Braintrust 定价（团队向证据）: https://www.braintrust.dev/docs/plans-and-limits
- 回归方法论（空白佐证）: https://www.testmuai.com / https://alt.qa
- 完整调研简报（含 11 产品 × 6 维度对比表）见会话记录；未确认事项：LangSmith/Phoenix/Weave 的 CI 细节、Agenta 转型后现状

## 五、同赛道/邻近项目复核（2026-10-08，参赛前撞车排查）

| 项目 | 一句话 | 与我们的关系 |
|---|---|---|
| EditHere (GitHub, 354★/27天) | 截图批注→结构化JSON→喂给AI改图改UI的「意图输入工具」（C++/Qt桌面） | **互补不竞争**：它管「改之前把需求说清楚」（输入端），我们管「改完之后验没验过」（验证端）——同一条人机迭代闭环的上下游，其流程中恰恰没有验证环节 |
| ai-helper (Gitee, 4★) | 浏览器操作型 AI 助手扩展（运行时助手，填表/提取/跑命令） | 不同物种：面向终端用户效率，无版本对比/评测概念；**反例价值**：825提交+文档站+上架商店仍4星——完成度不决定传播 |
| iotTurn (Gitee, 2★) | Rust TURN/STUN 服务器（WebRTC/IoT 基础设施） | 完全无关 |

**EditHere 涨星拆解（可复制的分发打法，非方向启示）**：README 七个动图一图一功能 × vibe coding 浪潮的巨大受众 × 「终于不用跟 AI 比划」的高频情绪 × linux.do/V2EX 精准投放 + 「让 AI 帮你安装」提示词钩子。

**借鉴清单**：① 报告页动图化呈现（赛前做）② changecheck review 命令——AI 发起人工评审会话、裁决 schema 化并可提升为用例（赛后）③ AI-SETUP.md 式「让 AI 帮你接入回归测试」获客钩子（赛后）④ 用例/报告文件 schema 化（schemaVersion+兼容，赛后）⑤ Checkpoint 续跑（赛后，已有逐次落库基础）。

**区分话术**（评审问差异化时用）：「EditHere 解决把要改什么说清楚，ChangeCheck 解决改完之后验没验过。」
