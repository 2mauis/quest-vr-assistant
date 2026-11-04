# CodeQL 代码扫描

`.github/workflows/codeql.yml` 是独立的 advanced setup 流水线，不改 `ci` 与 `quest-apk`。配置与本地脚本共用 `.github/codeql/codeql-config.yml`，查询套件为 `security-extended`。

| 语言 | 构建方式 | 覆盖 |
|---|---|---|
| `javascript-typescript` | `none` | 中继、MCP 服务、共享协议、网页显示、脚本与测试 |
| `actions` | `none` | `.github/workflows/` 下的工作流本身 |
| `java-kotlin` | `manual` | Gradle 编译原生壳 `:core`（含单测源码）与 `:app` debug，后者同时编译 `tunnel-probe/src` 的 Java 源码 |

`java-kotlin` 只编译源码：不构建探针 APK、Go 库或 cloudflared，不签名，不读取仓库 Secret，网页入口使用 `https://app.example.com/` 占位值。Kotlin 以进程内、非增量方式编译，以便提取器看到每个文件；`paths-ignore` 对这类编译型语言不起作用，只过滤 `none` 模式的语言。

`paths-ignore` 排除 `node_modules`、`dist`、`build`、Gradle / Kotlin 状态、生成的字体 JSON / PNG 与 `sc-glyphs.ts`、`test/fixtures` 金样和 Playwright 报告。仓库里的 Go（探针原生库）与 Python（构建 / 检查脚本）未纳入扫描。

触发：push 到 `main` 与本重构分支、任意 `pull_request`、每周一定时、手动 `workflow_dispatch`。定时与手动入口只对默认分支上的工作流文件生效；该文件已随 PR #5 进入 main。权限只有 `security-events: write`、`contents: read`、`actions: read`。Action 按仓库惯例固定到提交 SHA。每个语言的 SARIF 另作为构件 `codeql-sarif-<language>` 保留 14 天，告警摘要写入 run 的 Summary（见下节）。摘要步骤用 `actions/setup-node` 准备 Node 22，不增加任何权限。

## 在 GitHub 上查看结果

- **Run 页面：**每个 `Analyze (<language>)` 任务把该语言的结果数、按严重度的计数和告警列表写入 run 的 Summary，末尾附该分支（或 PR）的 code scanning 过滤链接。这一步只报告，出错不会让任务失败。完整 SARIF 在同一 run 的构件里。
- **Security 页：**仓库的 **Security and quality** 标签 → 左侧 **Code scanning**。告警列表需要仓库写权限；单条告警页的状态以默认分支为准，其他分支的状态见右侧 “Affected branches”。
- **按分支过滤：**在搜索框输入 `is:open branch:<BRANCH>`，或直接打开 `https://github.com/<OWNER>/<REPO>/security/code-scanning?query=is%3Aopen+branch%3A<URL 编码的分支名>`，例如本分支为 `branch%3Arefactor%2Fdisplay-two-track-opus-2026-11-02`。多个 `branch:` 取并集；PR 用 `pr:<NUMBER>`。
- **PR 中：**每个语言先有一项 `codeql / Analyze (<language>)` 检查，随后是汇总的 **Code scanning results** 检查；改动行上的新告警作为审查注释出现在 Conversation 与 Files changed 中。新告警有 `error`、`critical` 或 `high` 级别时该检查失败；检查里的 “View all branch alerts” 打开该 PR 分支的完整列表。

**默认视图只显示默认分支 `main` 的结果。**本分支的分析需要按上面的方式过滤才能看到；合并到 `main` 并在 `main` 上跑过一次后，才会出现在默认视图里。

## 仓库设置

公开仓库可以使用 advanced setup 上传 CodeQL SARIF，不需要 GitHub Code Security / Advanced Security 许可。若仓库开启了 CodeQL **default setup**，code scanning 会拒绝 advanced setup 上传的 CodeQL 结果，此时 Analyze 步骤失败；需要机主在 Settings 中二选一。本流水线不修改任何仓库设置。

## 本地运行

脚本不下载、不安装任何东西。先从官方发布页安装 CodeQL bundle（含查询包）：<https://github.com/github/codeql-action/releases>，说明见 <https://docs.github.com/en/code-security/codeql-cli/getting-started-with-the-codeql-cli/setting-up-the-codeql-cli>。

```sh
npm run codeql:local                                   # 三种语言
npm run codeql:local -- javascript-typescript actions  # 跳过原生壳
CODEQL=<PATH_TO_CODEQL> GRADLE=<PATH_TO_GRADLE> npm run codeql:local -- java-kotlin
```

`codeql` 不在 `PATH` 时脚本给出安装链接并以 127 退出。`java-kotlin` 另需 JDK 17+、Gradle 8.14.3 和含 platform 34 / build-tools 35.0.0 的 `ANDROID_HOME`。数据库与 SARIF 写入被 Git 忽略的 `build/codeql/`（可用 `CODEQL_OUT` 改），每种语言结束时按“规则、严重度、文件:行、说明”列出结果；也可单独运行 `node scripts/codeql-sarif-summary.ts build/codeql/*.sarif`，加 `--markdown` 输出与 run Summary 相同的表格。
