# 需求规格

重大改动必须先由人工在 claude.ai 启动 Claude（Opus 5.5），按 [模板](TEMPLATE.md) 编写 `docs/specs/<feature>.md`，写明需求、不变量和逐项映射到测试文件或用例名的验收测试。重大改动定义与批准边界沿用 [工作流](../workflow-v2.md#角色与硬约束)。

Codex 按 spec 先写失败测试，再实现；开 PR 前执行 Codex `/review` 自查。PR 打开时由 Codex GitHub App 自动评审，重大改动合并前再由人工发起 Claude 复审。完整流程见 [spec 优先规则](../workflow-v2.md#spec-优先与评审)。

`spec-requires-tests` 只做确定性检查：相对 base 的三点 diff 中，新增或修改本目录的功能 spec 时，同一 diff 必须触及 `test/*.test.ts` 或 `test/e2e/*.spec.ts`。`TEMPLATE.md`、`README.md` 和仅删除 spec 不触发要求；重命名按删除与新增处理。它不判定测试是否覆盖需求，也不代替先红后绿或人工重大改动判定。本地运行 `node scripts/check-spec-tests.ts <base-ref>`；只检查提交历史，不包含未提交改动。
