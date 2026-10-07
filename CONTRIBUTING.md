# 贡献指南

感谢关注 ChangeCheck（改版验收官）！

## 项目结构

- `src/lib/kernel/` —— 内核三层（执行器/检查器/回归报告），UI 无关，改动请配测试
- `src/lib/` —— 数据层（SQLite）、种子数据、运行编排
- `src/app/` —— 页面与 API 路由（Next.js App Router）
- `m0/` —— Milestone 0 验证实验（保留作可复现实验记录，谨慎改动）
- `docs/` —— 项目文档（决策记录以 `docs/project-brief.md` 为准）
- `tests/` —— 内核单元测试

## 开发流程

1. Fork + 分支开发（`feat-xxx` / `fix-xxx`）
2. `npm test` 与 `npm run build` 必须通过
3. 提交信息用一句话说清"做了什么"（中文/英文均可）
4. PR 描述请说明动机与影响面

## 约定

- 内核（kernel）不引入 Next.js / React 依赖——它将被 CLI 与 MCP server 复用
- API key 等敏感信息只走环境变量，绝不入库、绝不上传
- 新增检查规则请同时补 `tests/kernel.test.ts` 用例（规则是产品核心，回归即质量）
- 数据库 schema 变更需兼容旧库（见 `src/lib/db.ts` 的迁移写法）

## 提 Issue

请使用 Issue 模板（Bug 报告 / 功能建议），并附上：复现步骤、期望行为、实际行为。
