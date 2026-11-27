# 思考等级怎么接到 workbuddy-cli

1.3.0 已按本文接上：`--effort`、请求体里的 `reasoning_effort` / `reasoning.effort`，以及 ACP 的 `thought_level` 和 `_meta.reasoningEfforts`。

结论：T3 Code 只有看到 ACP 的 `thought_level` 下拉，以及每个模型的 `_meta.reasoningEfforts`，才会显示思考等级。桌面端 CodeBuddy 会在请求里带等级。

## 请求体

发往产品网关 `.../chat/completions` 的 JSON 上，官方客户端认两个位置（`codebuddy-lite-wb.mjs` 打日志时写成 `eu.reasoning_effort` 或 `eu.reasoning.effort`）：

- 选了等级：`reasoning_effort` 字符串，或 `reasoning.effort`。模型设置里对应的是 `modelSettings.reasoning = { effort, summary: "auto" }`（`configureThinkingSettings`）。
- 明确关掉：只把 body 设成 `reasoning_effort: "none"`（`product-gateway` 且 `thinkingEnabled === false` 的那段）。
- 另一条 chat completions 组装在 `reasoning.enabled && reasoning.level` 时写 `Y.reasoning_effort = i.reasoning.level`。

合法等级是 `minimal`、`low`、`medium`、`high`、`xhigh`、`max`（`VALID_REASONING_EFFORTS`）。命令行 `--effort` 还多一个 `ultracode`，那是桌面端工作流，不要放进 CLI。

关掉思考时用 `none`，不要用空字段。`onlyReasoning: true` 的模型不能关（`canDisableThinking`：`onlyReasoning` 为真就返回 false）。

还没抓到一条真实的 `www.workbuddy.cn/v2/chat/completions` 报文。网关对「打开」更认 `reasoning_effort` 还是 `reasoning.effort`，源码里两条都出现过。最小实现两个都写同一个等级；关闭时只写 `reasoning_effort: "none"`，并去掉 `reasoning`。

## 每个模型有哪些等级

目录在 `app.asar.unpacked/cli/product.internal.json` 的 `models`。

- `deepseek-v3-2-volc`：`supportsReasoning: true`，`onlyReasoning: true`，`reasoning: { effort: "medium", summary: "auto" }`。没有 `supportedEfforts`。
- `deepseek-v4-pro`、`glm-5.3`：同样只有默认 `effort`（分别是 `high`、`medium`），不能关。
- `glm-5.3-flash`、`kimi-k2.8-preview`：`supportedEfforts: ["low","high","max"]`，`defaultEffort: "high"`，`canDisableThinking: true`。但 `onlyReasoning: true` 时，`canDisableThinking()` 仍然不允许关。
- `hy4-preview`：`supportedEfforts: ["high"]`，`canDisableThinking: false`。
- `default`、`auto`、一批旧的 `deepseek-v3-1*` / `hunyuan-*`：没有 `supportsReasoning`，也不该广告等级。

没有 `supportedEfforts`、也没有 `thinkingLevelMap` 时，`resolveSupportedEfforts` 返回空。选择器默认用 `["low","medium","high","xhigh"]`（`filterEffortLevelsForPicker` 的 `E`，从 `["low","medium","high","xhigh","max"]` 里滤掉 `max`）。默认选中值用 `reasoning.defaultEffort`，没有再用 `reasoning.effort`（`configureThinkingSettings`）。

`minimal` 在总表里，但不在这个默认选择器里。

## T3 Code 怎么决定显示

本机 T3 运行时 `t3_acp_runtime.js`：

- `isAcpThoughtLevelOption`：`category === "thought_level"`，或 `category === "thinking"` 且 `type === "select"`。
- `advertisedReasoningEffort`：还要该模型 `_meta.reasoningEfforts` 是 `{ value, label? }[]`。`supportsReasoningEffort === false` 时，这个模型明确没有等级。`_meta` 什么都不说，则不当成「支持」。
- 官方 CodeBuddy 的 ACP 模型用的是 `_meta.effortOptions: [{ value, name }]`（`toAcpModelInfo`），另外再给会话一个 `id: "thought_level"`、`category: "thought_level"` 的下拉（选项含 `disabled` / 各等级 / `enabled`）。T3 这段代码不读 `effortOptions`。只模仿官方的 `effortOptions`，T3 里非当前模型仍会显示不支持。

当前模型会拿到全部 config option；其他模型要靠 `_meta.reasoningEfforts` 才有自己的等级（`modelsFromDiscovery`）。

## 最小改法

1. `chatPayload` 增加等级。支持推理且用户选了等级时，body 同时写 `reasoning_effort` 和 `reasoning: { effort, summary: "auto" }`。用户关掉时写 `reasoning_effort: "none"`。不支持推理的模型两个都不写。
2. 命令行加 `--effort <level>`。等级用上面的六个，再加 `off`（发出 `none`）。非法值直接退出。会话文件记住 `effort`，`-c` 沿用，除非这次又指定。
3. ACP：`sessionPayload` 增加 `thought_level` 下拉，`session/set_config_option` 在 `configId === "thought_level"` 时写入会话并返回新的 `configOptions`。每个 `availableModels[]` 带 `_meta`：
   - 支持：`supportsReasoningEffort: true`，`reasoningEfforts: [{ value, label }]`，`reasoningEffort` 为当前值。
   - 不支持：`supportsReasoningEffort: false`，不要填 `reasoningEfforts`。
4. 等级表先内置一份，来源是 `product.internal.json` 里 CLI 已经广告的那些模型。没写 `supportedEfforts` 的推理模型用 `low|medium|high|xhigh`，默认用目录里的 `effort`。`onlyReasoning` 的不提供 `off`。
5. 不要用 GLM 的 `thinking` / `enable_thinking`。那是 `ThinkingFormatTranslatorRule` 给别的供应商用的，不是 WorkBuddy 网关。

改完后：`workbuddy --effort high "..."` 的请求里能看到等级；T3 里换模型后，思考等级跟着该模型的列表变。不支持的模型仍然没有这个控件。
