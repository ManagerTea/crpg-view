# SealChat Owlbear 嵌入项目功能与复现注意事项

本文面向想参考本项目、重新 vibe 一个「可作为浏览器插件使用的类 CRPG 对话框插件」的开发者。项目本体是一个基于 Vite + TypeScript + Owlbear Rodeo SDK 的静态扩展：它把 SealChat 作为浮动聊天面板嵌入 Owlbear Rodeo，并额外把 SealChat 的频道消息转译成游戏内 CRPG 风格对话框。

## 1. 项目定位

- **宿主平台**：Owlbear Rodeo 扩展，而不是通用浏览器扩展。扩展入口由 `public/manifest.json` 描述，action popover 指向 `/`。
- **核心目标**：在 Owlbear Rodeo 地图上层打开一个透明浮动 popover，用 iframe 加载 SealChat；同时可开启另一个独立的透明 popover，把 IC 频道消息显示为角色头像 + 名牌 + 打字机文本的对话框。
- **可迁移目标**：如果要改造成浏览器插件，Owlbear popover、action badge、viewport API 需要替换为浏览器扩展的 content script、extension popup/side panel、DOM overlay、storage 和 message passing。

## 2. 主要功能清单

### 2.1 SealChat 浮动聊天面板

- 用户在控制面板中配置 SealChat 地址，项目会把地址规范化后拼出 iframe 嵌入地址：`{SealChat URL}?embed=obr`。
- 面板以透明 Owlbear popover 打开，显示在地图右侧上方，可关闭、刷新、收缩。
- 收缩后变为竖向「聊天」标签；点击展开，长按后可以拖动标签位置。
- 可开启调整模式，拖动边缘或角落调整面板宽高，并通过设置项控制顶部偏移、右侧工具栏避让、收缩尺寸和 iframe 缩放。

### 2.2 登录状态与未读数同步

- SealChat iframe 通过 `window.parent.postMessage` 通知宿主登录状态与未读数。
- 只接受与当前配置 SealChat 地址同源的消息，避免其他 iframe 或页面伪造事件。
- 当收到未登录状态且尚未打开过登录窗口时，会打开配置的 SealChat 地址作为登录窗口。
- 当收到未读数时，通过 Owlbear action badge 显示未读消息数量。

### 2.3 类 CRPG 对话框

- 控制面板可开启「启用对话框」与「调整对话框配置」。
- 对话框是另一个 Owlbear popover，默认在左上区域显示，包含角色头像、角色名、文本区、状态栏、最小化与快进按钮。
- 对话框可拖动、可通过四边和角落调整大小，可最小化成小型浮动按钮。
- 文本以打字机效果逐字出现；一条消息可用 `::` 分页，页面之间按配置等待指定时间。
- 对话队列支持创建、更新、删除、自动推进以及「快进到最新消息」。
- 角色名颜色、头像、显示名可来自 SealChat 的角色快照，也可由消息直接携带。

### 2.4 SealChat 桥接协议

对话框功能依赖 SealChat 侧配合一个轻量桥接协议：

1. 嵌入 iframe 加载完成后，如果对话框已启用，宿主反复向 iframe 发送 `sealchat.bridge.handshake`。
2. SealChat 回应 `sealchat.bridge.handshake.ack`，并携带当前频道 ID。
3. SealChat 可继续发送 `sealchat.bridge.roles.snapshot`，同步角色 identity、显示名、颜色和头像。
4. SealChat 发送 `sealchat.bridge.message`，宿主只接收 `icMode === "ic"` 且 `isWhisper === false` 的公开 IC 消息。
5. 宿主把桥接消息转换为对话队列事件，并通过 `BroadcastChannel("sealchat-obr")` 转发给独立的对话框 popover。
6. iframe 卸载前发送 `sealchat.bridge.unsubscribe`，让 SealChat 侧清理订阅。

## 3. 页面与模块结构

| 文件/模块 | 职责 |
| --- | --- |
| `index.html` + `src/main.ts` | Owlbear action popover 控制面板：设置 URL、尺寸、对话框参数，并触发展开/收缩/刷新/关闭。 |
| `panel.html` + `src/panel.ts` | SealChat iframe 浮动面板：渲染 iframe、空状态、收缩标签、拖拽缩放、登录/未读 postMessage、SealChat 桥接入口。 |
| `dialogue.html` + `src/dialoguePanel.ts` | CRPG 对话框 popover：渲染角色头像和文本、处理打字机播放、队列推进、拖动/缩放/最小化。 |
| `src/settings/config.ts` | 默认设置、URL 校验、嵌入 URL 构造、数字设置归一化。 |
| `src/settings/storage.ts` | 本地设置读取、合并、保存；并支持房间默认 URL。 |
| `src/obr/popover.ts` | SealChat 面板 popover 的几何计算和打开/关闭。 |
| `src/dialogue/popover.ts` | 对话框 popover 的几何计算、拖动/缩放设置计算和打开/关闭。 |
| `src/dialogue/bridge.ts` | SealChat 桥接协议的消息创建、ack 校验、角色快照读取、聊天消息归一化。 |
| `src/dialogue/queue.ts` | 对话队列 reducer：入队、更新、删除、推进、快进。 |
| `src/dialogue/formatting.ts` | 消息文本转安全 HTML、换行/缩进恢复、`::` 分页。 |
| `src/dialogue/typewriter.ts` | 对 HTML 文本按“可见字符”计数和切片，避免打字机效果截断标签或实体。 |
| `src/dialogue/avatarCache.ts` | 头像图片加载与缓存。 |
| `src/panel/resize.ts`、`src/panel/collapsedDrag.ts` | 浮动面板和收缩态拖拽/缩放的通用计算。 |
| `src/auth/messages.ts` | SealChat 登录状态和未读数消息解析。 |

## 4. 数据流与运行流程

### 4.1 控制面板到浮动面板

1. 用户打开 Owlbear action popover。
2. `src/main.ts` 从 localStorage / Owlbear room metadata 读取设置并渲染控制表单。
3. 用户保存设置后，项目校验 URL、归一化数字配置、保存设置。
4. 点击「展开」或保存后触发 `openPanel(settings)`，Owlbear 打开 `/panel.html` popover。
5. `panel.ts` 读取设置，计算当前几何尺寸，把 iframe 指向 SealChat embed 地址。

### 4.2 iframe 与宿主通信

1. SealChat iframe 向父窗口发送 `sealchat.auth` 或 `sealchat.unread`。
2. `panel.ts` 的 message listener 先校验 `event.origin` 是否等于配置 URL 的 origin。
3. 校验通过后解析消息：认证状态用于打开登录窗口，未读数用于更新 action badge。

### 4.3 SealChat 消息到 CRPG 对话框

1. `panel.ts` 在 iframe load 后发起桥接 handshake。
2. SealChat 回 ack 和角色快照。
3. SealChat 发来的消息事件被过滤并转成 `DialogueQueueEvent`。
4. `panel.ts` 通过 BroadcastChannel 把角色快照、队列事件、设置变化发给 `dialoguePanel.ts`。
5. `dialoguePanel.ts` 更新队列，启动或重启打字机播放。
6. 播放完当前页后等待 `dialogueWaitMs`，再翻页或推进下一条消息。

## 5. 复现成浏览器插件时的重点改造

### 5.1 替换 Owlbear Rodeo 能力

本项目大量依赖 Owlbear SDK：

- `OBR.popover.open/close`：用于创建透明浮动窗口。
- `OBR.viewport.getWidth/getHeight`：用于计算 popover 边界与锚点。
- `OBR.action.setBadgeText/setHeight`：用于 action badge 和控制面板高度。
- `OBR.room.getMetadata/setMetadata`：用于房间级默认设置。

浏览器插件版建议替换为：

- **content script overlay**：在目标网页注入一个 Shadow DOM 根节点，渲染聊天面板与 CRPG 对话框。
- **CSS fixed positioning**：用 `position: fixed`、`z-index`、pointer events 实现浮动、拖动、缩放、最小化。
- **chrome.storage / browser.storage**：替代 localStorage + Owlbear room metadata。
- **runtime messaging / tabs messaging**：替代 BroadcastChannel 或作为跨页面通信补充。
- **action badge API**：用 `chrome.action.setBadgeText` 替代 Owlbear action badge。

### 5.2 iframe 嵌入与权限

如果浏览器插件继续 iframe 嵌入 SealChat，需要特别注意：

- SealChat 必须允许被 iframe 嵌入，不能被 `X-Frame-Options: DENY/SAMEORIGIN` 或严格 CSP `frame-ancestors` 拦截。
- 插件的 manifest 需要声明目标域名权限，例如 `https://chat.example.com/*`。
- 若要在 iframe 内直接注入脚本，必须匹配 iframe URL；否则只能依赖 `postMessage` 协议。
- 生产环境仍建议强制 `https://`，只在开发环境允许 localhost HTTP。

### 5.3 安全边界

复现时不要省略这些校验：

- **origin 校验**：所有来自 iframe 的 postMessage 必须校验来源 origin。
- **消息 shape 校验**：不要信任 `event.data`，需要逐字段判断类型。
- **HTML 转义**：对话文本和角色名渲染前必须转义；只恢复允许的换行、缩进和 HTML entity。
- **颜色校验**：角色颜色应使用 `CSS.supports("color", value)` 或白名单，避免注入 style 片段。
- **URL 规范化**：保存和比较 URL 前去掉尾部 `/`，比较 origin 时用 `new URL()`。

### 5.4 UI 与交互细节

- 拖动与缩放建议只在 pointer events 中更新内存状态，结束时再持久化，避免频繁写 storage。
- 收缩态拖动要区分「点击展开」和「长按拖动」，否则用户很容易误触。
- 几何计算要考虑视口边界，避免面板拖出屏幕或在窗口缩小时不可见。
- 对话框与聊天面板最好分成两个 overlay：聊天面板负责 iframe 和桥接，对话框负责沉浸式展示。
- 对话框最小化按钮、快进按钮和拖动手柄要避免和文本区域抢 pointer 事件。

### 5.5 对话播放逻辑

- 维护 `current`、`pending[]`、`latest` 三个状态足够支持自动播放与快进。
- 消息更新时，如果更新的是当前消息，应重启当前播放；如果更新的是 pending 消息，应替换队列里的旧版本。
- 删除当前消息时应立即切换到下一条 pending；删除 pending 消息则只移除队列项。
- 打字机效果不要直接按字符串下标截断 HTML，要按可见字符切片，并完整保留标签和 entity。
- 分页符 `::` 简单有效，但如果未来接 Markdown 或富文本，需要先定义清晰的格式优先级。

## 6. 最小可复现功能路线

如果你要快速 vibe 一个浏览器插件版，建议按以下顺序做：

1. **基础 overlay**：content script 注入 Shadow DOM，做一个可展开/收缩/拖动/缩放的透明面板。
2. **配置持久化**：加入插件 popup 或 options 页面，保存 SealChat URL、尺寸、位置、缩放参数。
3. **iframe 嵌入**：把 URL 转成 `{base}?embed=obr` 或你自定义的 embed 模式，加入刷新和关闭按钮。
4. **postMessage 基础通信**：先实现 auth/unread，同步到插件 badge。
5. **桥接协议**：实现 handshake、roles snapshot、message created/updated/deleted。
6. **对话框 overlay**：独立渲染 CRPG 对话框，接收消息队列并播放打字机效果。
7. **健壮化**：补充 origin 校验、消息校验、HTML 转义、头像缓存、边界限制、测试。

## 7. 建议保留的协议格式

### 7.1 登录状态

```ts
{
  type: "sealchat.auth",
  status: "authenticated" | "unauthenticated"
}
```

### 7.2 未读数

```ts
{
  type: "sealchat.unread",
  count: number
}
```

### 7.3 桥接握手

```ts
{
  type: "sealchat.bridge.handshake",
  version: 1,
  nonce: string,
  want: ["roles", "messages"],
  currentChannelOnly: true
}
```

### 7.4 桥接确认

```ts
{
  type: "sealchat.bridge.handshake.ack",
  version?: number,
  nonce?: string,
  ok?: boolean,
  worldId?: string,
  channelId: string
}
```

### 7.5 角色快照

```ts
{
  type: "sealchat.bridge.roles.snapshot",
  roles: Array<{
    identityId: string,
    displayName: string,
    color: string,
    avatarUrl: string
  }>
}
```

### 7.6 消息事件

```ts
{
  type: "sealchat.bridge.message",
  event: "message-created" | "message-updated" | "message-deleted",
  messageId: string,
  identityId?: string,
  displayName?: string,
  color?: string,
  avatarUrl?: string,
  contentText?: string,
  createdAt?: number,
  icMode: "ic",
  isWhisper: false
}
```

## 8. 测试与验收建议

- URL 校验：空 URL、非法 URL、HTTP 非 localhost、HTTPS、localhost HTTP。
- 几何计算：普通态、收缩态、窗口变小、右侧/顶部偏移过大。
- 拖动缩放：四边、角落、收缩标签长按拖动。
- postMessage：合法 origin、非法 origin、畸形 data、未登录只打开一次登录窗口。
- 桥接：handshake 重试、ack 后停止重试、roles snapshot 更新、message created/updated/deleted。
- 对话队列：当前消息更新、pending 更新、删除当前、删除 pending、快进到最新。
- 打字机：HTML entity、`<br>`、中文、emoji、`::` 分页、转义字符 `\\n` / `\\t`。
- 头像：加载成功、加载失败 fallback、重复 URL 缓存。

## 9. 复现时最容易踩坑的点

1. **把 Owlbear 扩展误认为浏览器扩展**：本项目页面是被 Owlbear 加载的静态网页，不能直接复用为 Chrome extension，需要重新设计 manifest 和注入方式。
2. **iframe 安全策略**：如果目标聊天站不允许被嵌入，前端代码无法绕过，需要改服务端 header 或改为新窗口/side panel。
3. **跨上下文通信复杂度**：浏览器插件可能同时存在 background、popup、content script、iframe、页面脚本，多层消息要明确谁是可信边界。
4. **打字机截断 HTML**：直接 `text.slice(0, n)` 会破坏 `<br>` 和 entity，本项目专门按可见字符切片。
5. **拖动坐标系**：Owlbear 使用 popover anchor；浏览器 overlay 应统一用 viewport 坐标，避免 screen/client/page 坐标混用。
6. **设置同步竞态**：拖动时频繁打开/重开浮层容易闪烁，应做节流或队列化；本项目对对话框 reopen 做了 pending/in-flight 防抖。
7. **样式污染**：浏览器插件注入页面时最好使用 Shadow DOM 或强命名前缀，避免宿主网页 CSS 影响对话框。

## 10. 可直接借鉴的设计决策

- 把“聊天 iframe 面板”和“CRPG 对话框”拆成两个独立视图，降低 UI 与播放逻辑耦合。
- 用纯函数计算几何、队列和文本切片，方便单元测试。
- 用显式协议对象做桥接，避免直接依赖 SealChat 内部 DOM。
- 所有外部消息都走白名单字段解析，而不是直接展开对象。
- 对话框只消费 IC、非私聊消息，适合作为跑团场景的沉浸式旁白/角色台词层。
