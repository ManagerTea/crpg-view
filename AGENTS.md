# AGENTS.md

本仓库是 crpg-view，一个用于适配 sealchat 的独立插件。

## 工作边界

- 只修改当前仓库。
- sealchat 是宿主，不要修改 sealchatt。
- 如果需要理解 sealchat 的行为，先阅读 docs/sealchat-integration.md。
- 如果 Codex 可以访问 sealchat 仓库，可以读取它作为参考，但不要对它提交改动。
- 所有和 sealchat 对接的代码放在 src/adapter/。
- 插件自身逻辑放在 src/plugin/。
- UI 放在 src/ui/。
- 样式放在 styles/。
- 不要把 sealchat 的大量源码复制进本仓库。

## 开发要求

- 优先实现最小可运行版本。
- 每次任务完成后说明修改了哪些文件。
- 每次任务完成后说明如何验证。
- 如果 sealchat 的接口不明确，先写出假设，不要硬猜。
