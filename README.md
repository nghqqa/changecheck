# ChangeCheck · 改版验收官

> 面向个人开发者的 AI 功能改版验收工具 —— 改了提示词、换了模型、调整流程之后，用证据回答：哪些变好了？哪些被改坏了？这次改版值不值得采用？

- **仓库名**：`changecheck`
- **中文名**：改版验收官（备选：`evaliff`、金丝雀/canary 隐喻）
- **参赛**：2026 上海开源软件应用创新大赛 · 开源 AI 工具赛道（自主选题）
- **截止**：2026-10-11 24:00 前提交材料至 oscc@oschina.cn
- **当前阶段**：Milestone 0 ✅ 完成（真实 API 验证：植入退步 36/36 抓到、0 误报，见 docs/project-brief.md §6 与 m0/）；下一步 10/8 报名表 + 核心应用

## 文档导航

| 文档 | 内容 |
|---|---|
| [docs/project-brief.md](docs/project-brief.md) | 项目主文档：背景、全部关键决策、产品设计、排期、验证实验、提交清单 |
| [docs/product-vision.md](docs/product-vision.md) | 完整产品形态：三层形态（Web/CLI/MCP）、五层内核、演进路线、战略判断 |
| [docs/competition-facts.md](docs/competition-facts.md) | 赛事核实事实（截止时间、评审权重、奖项、材料要求，含来源） |
| [m0/README.md](m0/README.md) | Milestone 0 验证实验：怎么跑、回答什么问题、结论 |

## 给下一个会话的指引

1. 先读 `docs/project-brief.md`（含全部决策记录，不要重新讨论已定结论）。
2. 核对 `docs/competition-facts.md` 中的时间线是否仍然成立。
3. 待定事项见 project-brief §9（剩余：报名表确认 / 学生身份 / 中文名）。
4. 回退线：10/9 晚核心流程未跑通 → 放弃本工具，回退提交已有完成度的 AI 视频项目。
