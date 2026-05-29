# SealChat 第一版真实集成文档

> 面向子项目开发者的后端集成入口说明。本文只整理当前仓库已经落地的 README、`api`、`service`、`model`、`protocol`、`pm` 能力，不虚构尚未存在的 SDK 或 OpenAPI 描述。

## 1. 项目定位与技术边界

SealChat 是自托管的轻量即时通讯与角色协作平台。核心业务围绕 **世界（World）→ 频道（Channel）→ 成员/身份（Member/Identity）→ 消息（Message）** 展开，并提供附件、图库、音频工作台、角色卡、骰子宏、iForm、Webhook、导入导出、统计与管理功能。

当前后端形态：

| 层级 | 目录 | 真实职责 | 子项目接入建议 |
| --- | --- | --- | --- |
| HTTP/API | `api/` | Fiber 路由、鉴权中间件、REST 接口、WebSocket 网关、Webhook/OneBot 入口 | 子项目优先通过 `/api/v1` 与 `/ws/seal` 接入，不建议直接依赖内部 handler |
| Service | `service/` | 跨 model/pm 的业务编排、存储、导入导出、音频、世界/频道业务、指标采集 | Go 子项目若嵌入同进程，可复用 service 方法，但需先初始化 DB、配置、权限 |
| Model | `model/` | GORM 模型、数据库初始化、迁移、查询与数据转换 | 只把 model 当持久化层，不在子项目中绕过 service/api 改核心数据 |
| Protocol | `protocol/` | WebSocket 事件体、Satori 风格消息元素、频道/用户/消息 DTO | 前端、Bot、桥接项目应以这里的 JSON 字段为准 |
| Permission | `pm/` | gorbac 权限树、系统/频道权限、角色权限应用 | 所有写接口与管理接口都应走 pm/handler 校验，不应在子项目硬编码“管理员” |
| UI | `ui/` | Vue 3 + Vite 前端，构建后由 Go 可执行文件内嵌 | 子项目可独立消费 API，也可参考 UI 的调用方式 |

## 2. 运行时初始化顺序

子项目如果只调用 HTTP/WebSocket，不需要关心初始化顺序；如果要把 SealChat 后端作为 Go 包或同进程模块复用，建议按以下顺序理解：

1. 读取 `config.yaml` / 环境配置，拿到 `DSN`、`WebUrl`、附件/音频/S3/邮件等配置。
2. `model.DBInit(cfg)` 连接数据库并执行 `AutoMigrate`，支持 SQLite、PostgreSQL、MySQL 三类 DSN；SQLite 会额外应用 pragma、连接池、auto vacuum 与 FTS 初始化。
3. 初始化权限：`pm.Init()` 从数据库加载系统角色、频道角色及角色权限；如果系统角色为空，会建立 `sys-admin`、`sys-user`、`sys-visitor` 的默认权限集合。
4. 初始化 service 层需要的存储、worker、导入导出、指标等能力。
5. `api` 绑定 Fiber：公共 `/api/v1`、受保护 `/api/v1`、管理员 `/api/v1/admin/*`、WebSocket `/ws/seal`、静态前端、OneBot/Webhook 路由。

> 重要约束：`service/_service.go` 明确 service 层用于放“共同依赖 model 和 pm 的东西”，也就是说 service 是业务编排层，而不是纯 DAO 或纯协议层。

## 3. 鉴权模型

### 3.1 HTTP 鉴权

HTTP 接口统一挂载在 `/{WebUrl}/api/v1` 下，`WebUrl` 为空时就是 `/api/v1`。

- `Authorization: Bearer <token>` 与 `Authorization: <token>` 均可。
- 如果 header 没有 token，会回退读取 Cookie `Authorization`。
- 普通用户 token 走 `model.UserVerifyAccessToken`。
- 长度为 32 的 token 被视作 Bot token，走 `model.BotVerifyAccessToken`。
- 鉴权成功后用户对象写入 `fiber.Ctx.Locals("user")`，并更新 timeline。
- 被禁用账号会返回 401。
- 管理员接口额外经过 `UserRoleAdminMiddleware`，要求系统角色拥有 `pm.PermModAdmin`。

### 3.2 WebSocket 鉴权

WebSocket 地址：

```text
ws(s)://<host>/<WebUrl>/ws/seal
```

连接建立后必须先发送 identify 网关消息：

```json
{
  "op": 3,
  "body": {
    "token": "<user access token 或 32位 bot token>"
  }
}
```

服务端返回 ready：

```json
{
  "op": 4,
  "body": {
    "user": {
      "id": "...",
      "username": "...",
      "nickname": "..."
    }
  }
}
```

匿名/观战连接允许空 token，但只开放只读 API：`channel.list`、`channel.favorite.list`、`channel.enter`、`channel.members_count`、`channel.member.list.online`、`message.list`、`message.get`、`message.context`。

### 3.3 心跳与延迟探测

WebSocket 使用 `protocol.GatewayPayloadStructure`：

| op | 名称 | 方向 | 用途 |
| --- | --- | --- | --- |
| `0` | `OpEvent` | 服务端 → 客户端 | 广播事件，如消息创建、频道更新、在线态更新 |
| `1` | `OpPing` | 客户端 → 服务端 | 业务心跳，可携带 `focused` 与 `latency` |
| `2` | `OpPong` | 服务端 → 客户端 | 心跳响应 |
| `3` | `OpIdentify` | 客户端 → 服务端 | 连接鉴权 |
| `4` | `OpReady` | 服务端 → 客户端 | 鉴权结果或错误 |
| `5` | `OpLatencyProbe` | 客户端 → 服务端 | 延迟探测，请求体包含 `id`、`clientSentAt` |
| `6` | `OpLatencyResult` | 服务端 → 客户端 | 回显延迟探测并补充 `serverSentAt` |

## 4. HTTP API 集成总览

### 4.1 公共接口（无需登录或可选登录）

| 能力 | 路由 |
| --- | --- |
| 用户注册登录 | `POST /api/v1/user-signup`、`POST /api/v1/user-signin` |
| Captcha | `GET /api/v1/captcha/new`、`GET /api/v1/captcha/:id.png`、`GET /api/v1/captcha/:id/reload`、`POST /api/v1/captcha/cap/:scene/challenge`、`POST /api/v1/captcha/cap/:scene/redeem` |
| 邮箱注册/重置 | `POST /api/v1/email-auth/signup-code`、`POST /api/v1/email-auth/signup`、`POST /api/v1/password-reset/*` |
| 公共配置与观战 | `GET /api/v1/config`、`GET /api/v1/public/worlds/:worldId`、`GET /api/v1/public/ob/:slug` |
| 公开搜索/关键词 | `GET /api/v1/public/ob/channels/:channelId/messages/search`、`GET /api/v1/public/worlds/:worldId/keywords*` |
| 附件读取 | `GET /api/v1/attachment/:id`、`GET /api/v1/attachment/:id/thumb` |
| 音频流 | `GET /api/v1/audio/stream/:id`（可选登录，支持 play token 场景） |
| 外部 Webhook | `GET /api/v1/webhook/channels/:channelId/changes`、`GET /api/v1/webhook/channels/:channelId/digests*`、`POST /api/v1/webhook/channels/:channelId/messages` |

### 4.2 登录后接口（业务域分组）

| 业务域 | 代表路由 |
| --- | --- |
| 当前用户 | `GET /user-info`、`POST /user-info-update`、`POST /user-password-change`、`GET /user/preferences`、`POST /user/preferences` |
| 用户统计 | `GET /user/input-stats/overview`、`/by-world`、`/by-channel`、`/timeline`、`/sessions` |
| 附件/图库 | `POST /upload`、`POST /attachment-upload`、`GET /attachments-list`、`GET /gallery/collections`、`POST /gallery/items/upload`、`GET /gallery/search` |
| 身份与角色卡 | `GET/POST/PUT/DELETE /channel-identities`、`/channel-identity-variants`、`/character-cards`、`/character-card-templates` |
| 频道 | `GET /channel-role-list`、`GET /channel-member-list`、`POST /channel-info-edit`、`GET /channel-info`、`POST /channels/:channelId/copy`、`DELETE /channels/:channelId` |
| 消息检索/反应/图片布局 | `GET /channels/:channelId/messages/search`、`POST/DELETE /messages/:messageId/reactions`、`GET /channels/:channelId/images` |
| 骰子宏 | `GET/POST/PUT/DELETE /channels/:channelId/dice-macros`、`POST /import` |
| Webhook 集成 | `GET/POST /channels/:channelId/webhook-integrations`、`POST /:id/rotate`、`POST /:id/revoke` |
| 未读提醒 | `GET/POST/DELETE /channels/:channelId/digest-push`、`GET/POST/DELETE /worlds/:worldId/digest-push`、`POST /test` |
| 音频工作台 | `GET /audio/assets`、`POST /audio/assets/:id/play-token`、`GET /audio/folders`、`GET /audio/scenes`、`GET/POST /audio/state` |
| 世界 | `GET/POST /worlds`、`GET/PATCH/DELETE /worlds/:worldId`、`POST /join`、`POST /leave`、`GET /sections`、`POST /invites` |
| 世界公告/成员/关键词 | `/worlds/:worldId/announcements*`、`/members*`、`/keywords*`、`/external-glossaries*` |
| 归档/导出/导入 | `POST /channels/archive`、`POST /chat/export`、`GET /chat/export/:taskId`、`GET/POST /channels/:channelId/import/*` |
| iForm | `GET/POST/PATCH/DELETE /channels/:channelId/iforms`、`POST /push`、`POST /migrate`、`POST /world-share` |
| 好友/Bot | `GET /friend-list`、`GET /bot-list`、`POST /user-role-link`、`POST /user-role-unlink` |
| 状态/字体 | `GET /status`、`GET /status/history`、`GET /platform-fonts*` |

### 4.3 管理员接口

管理员接口同样在 `/api/v1` 下，但路径以 `/admin/*` 为主，并受 `UserRoleAdminMiddleware` 保护：

- Bot token：`/admin/bot-token-list`、`/add`、`/update`、`/delete`、`/batch-delete`。
- 用户管理：`/admin/user-list`、`/user-disable`、`/user-enable`、`/user-password-reset`、`/user-create`、`/user-batch-create`。
- 系统维护：`/admin/update-*`、`/admin/certificates/*`、`/admin/backup/*`、`/admin/sqlite/vacuum*`、`/admin/message-visible-char-count/*`。
- 全局外部词库：`/admin/external-glossaries*`。
- 音频与字体管理：`/admin/audio-assets*`、`/admin/audio-quotas*`、`/admin/platform-fonts*`。
- 迁移工具：`/admin/image-migration/*`、`/admin/s3-migration/*`、`/admin/audio-folder-migration/*`。
- 配置写入：`PUT /api/v1/config`。

## 5. WebSocket API 集成

业务 API 消息格式：

```json
{
  "api": "message.create",
  "echo": "client-generated-id",
  "data": {
    "channel_id": "...",
    "content": "hello"
  }
}
```

成功响应：

```json
{
  "echo": "client-generated-id",
  "data": {}
}
```

失败响应：

```json
{
  "echo": "client-generated-id",
  "err": "错误信息",
  "data": {}
}
```

### 5.1 当前 WebSocket API 名称

| 领域 | API 名称 |
| --- | --- |
| Sticky Note | `sticky-note.update`、`sticky-note.delete`、`sticky-note.push` |
| 频道 | `channel.create`、`channel.private.create`、`channel.list`、`channel.favorite.list`、`channel.members_count`、`channel.member.list.online`、`channel.member.list`、`channel.private.list`、`channel.enter`、`channel.dice.default.set`、`channel.feature.update`、`channel.bot_whisper.forward.update` |
| 好友 | `friend.request.list`、`friend.request.sender.list`、`friend.request.create`、`friend.delete`、`friend.approve` |
| 消息 | `message.create`、`message.update`、`widget.interact`、`message.delete`、`message.remove`、`message.reorder`、`message.reorder.batch`、`message.list`、`message.get`、`message.revoked.draft`、`message.context`、`message.archive`、`message.unarchive`、`message.pin`、`message.unpin`、`message.pin.list`、`message.edit.history`、`message.typing` |
| 导出/资产 | `chat.export.test`、`asset.upload` |
| 未读/成员 | `unread.count`、`guild.member.list` |
| Bot | `bot.info.set_name`、`bot.command.register`、`bot.command.dispatch`、`bot.channel_member.set_name` |
| 角色能力 | `character.get`、`character.set`、`character.list`、`character.capability.test`、`character.new`、`character.save`、`character.tag`、`character.untagAll`、`character.load`、`character.delete` |
| 角色徽章/备注 | `character.badge.broadcast`、`character.badge.snapshot`、`character.remark.broadcast`、`character.remark.snapshot` |

### 5.2 事件订阅

服务端通过 `op: 0` 推送 `protocol.Event`。常见 `type`：

- 消息：`message-created`、`message-deleted`、`message-updated`、`message-archived`、`message-unarchived`、`message-pinned`、`message-unpinned`、`message-reordered`、`message-removed`、`message.reaction`。
- 频道/在线态：`channel-updated`、`channel-presence-updated`、`channel-entered`、`channel-member-updated`。
- 音频/iForm/图片布局：`audio-state-updated`、`channel-iform-updated`、`channel-iform-pushed`、`channel-image-layout-updated`。
- 世界与词库：`world-updated`、`world-keywords-updated`、`external-glossaries-updated`、`world-external-glossaries-updated`。
- 便签/角色卡：`sticky-note-*`、`character-card-*`、`character-card-badge-*`、`character-remark-*`。

## 6. 核心协议对象

### 6.1 Channel

`protocol.Channel` 是前端和 WebSocket 使用的频道 DTO，主要字段：

- `id`、`worldId`、`type`、`name`、`parent_id`。
- `permType`：`public`、`non-public`、`private`。
- 骰子/Bot：`defaultDiceExpr`、`botCommandPrefixes`、`builtInDiceEnabled`、`botFeatureEnabled`、`primaryBotId`、`eventBotIds`。
- 角色 API 与悄悄话转发：`characterApiEnabled`、`characterAPIReason`、`botWhisperForwardConfig`。
- 背景图：`backgroundAttachmentId`、`backgroundSettings`。

`type` 取值是数字枚举：`0` 文本、`1` 语音、`2` 分类、`3` 私聊。

### 6.2 User / Member / Identity

- `protocol.User`：`id`、`name`、`nick`、`avatar`、`discriminator`、`is_bot`。
- `protocol.GuildMember`：成员维度显示名、头像、角色列表、入群时间，以及可选 `identity`。
- `protocol.ChannelIdentity` / `MessageIdentity`：角色扮演身份，包含 `displayName`、`color`、头像附件、头像装饰、是否默认/临时、变体 ID 等。

### 6.3 Message

`protocol.Message` 包含：

- 基本信息：`id`、`channel`、`guild`、`user`、`member`、`content`、`elements`、`timestamp`。
- 排序与编辑：`displayOrder`、`createdAt`、`updatedAt`、`isEdited`、`editCount`、编辑者信息。
- IC/OOC 与悄悄话：`icMode`、`isWhisper`、`whisperTo`、`whisperToIds`、`whisperMeta`。
- 管理态：`isArchived`、`archivedAt`、`archiveReason`、`isPinned`、`pinnedAt`、`isDeleted`、`deletedAt`。
- 客户端幂等：`clientId`。

### 6.4 消息元素（Satori 风格）

`protocol.Element` 使用树结构：

```json
{
  "type": "root",
  "attrs": {},
  "children": [
    { "type": "text", "attrs": { "content": "hello" }, "children": null }
  ]
}
```

服务端内置 Satori 标签白名单：`at`、`sharp`、`a`、`img`、`audio`、`video`、`file`、`b`、`strong`、`i`、`em`、`u`、`ins`、`s`、`del`、`spl`、`code`、`sup`、`sub`、`br`、`p`、`message`、`quote`、`author`、`button`。

子项目如果发送纯文本，应使用普通字符串；如果发送混合消息，应保证标签合法并转义普通文本。

## 7. Model 层真实数据边界

### 7.1 基础模型约定

所有主要表使用 `StringPKBaseModel`：

- `id` 为字符串主键，创建前自动使用 `utils.NewID()` 补齐。
- `createdAt`、`updatedAt` 为 `time.Time`。
- `deletedAt` 为软删除字段。

### 7.2 重要模型

| 模型 | 表 | 说明 |
| --- | --- | --- |
| `UserModel` | `users` | 用户、Bot、邮箱、禁用态；`ToProtocolType()` 转为 `protocol.User` |
| `AccessTokenModel` | `access_tokens` | 普通用户登录态与过期时间 |
| `ChannelModel` | `channels` | 世界归属、父子频道、私聊、公私权限、Bot/骰子/背景配置、归档/删除状态 |
| `MemberModel` | `members` | 用户在频道中的成员身份、昵称、角色等 |
| `MessageModel` | `messages` | 消息正文、引用、IC/OOC、悄悄话、编辑、归档、置顶、删除、身份快照、导入标记 |
| `AttachmentModel` | `attachments` | 附件、图片、音频等资源元数据 |
| `WorldModel` | `worlds` | 世界、成员、邀请、收藏、关键词与公告的聚合根 |
| `RolePermissionModel` / `UserRoleMappingModel` | 权限相关表 | 权限字符串与用户/角色映射 |

### 7.3 数据库兼容性

- SQLite DSN：以 `.db` 结尾、`file:` 或 `:memory:` 开头。
- PostgreSQL DSN：以 `postgres://` 或 `postgresql://` 开头。
- MySQL DSN：以 `mysql://` 开头或包含 `@tcp(`。
- 启动时 `DBInit` 会自动迁移大量业务表，并异步初始化 SQLite/Postgres 全文索引。

## 8. Service 层集成注意事项

Service 层适合 **同进程 Go 子项目** 复用，但不适合远程项目直接调用。当前 service 目录的业务模块包括：

- `world*`：世界、世界成员、关键词、外部词库绑定。
- `channel*`：频道、成员候选、身份、身份变体、身份文件夹、iForm。
- `character_card*`：角色卡、模板、头像绑定。
- `attachment*` / `storage*` / `s3_migration`：附件上传、远程导入、本地/S3 存储与迁移。
- `audio*`：音频素材、文件夹、场景、播放状态、配额、迁移。
- `export*` / `chat_import*`：聊天导出与聊天记录导入。
- `dice*`：骰子宏与渲染。
- `metrics`：运行指标采集。
- `observer_print`、`onebot*`、`webhook*`：观战打印、OneBot、外部 Webhook/未读提醒。

复用建议：

1. 优先使用 service 公开函数完成业务，不要跨过 service 直接写 model，避免漏掉权限、事件、回填与缓存逻辑。
2. 写接口必须先确认 pm 权限；HTTP handler 已经做了大量检查，同进程调用 service 时需要自行补齐。
3. 修改会影响前端实时状态的数据后，需要广播 `protocol.Event`；可参考 `ChatContext.BroadcastEventInChannel` 的使用方式。
4. 文件与音频不要假设一定在本地磁盘，必须通过 storage manager 或附件 API 取 URL/流。

## 9. 权限模型（pm）

### 9.1 权限值

权限结果常量：

- `0`：`PermUnset` 未设定。
- `1`：`PermAllowed` 许可。
- `2`：`PermDenied` 禁止。

系统权限代表项：

- `mod_admin`：查看/进入管理界面，也是管理员中间件的核心判断。
- `func_admin_serve_config`：修改服务配置。
- `func_admin_bot_token_*`：Bot token 查看、创建、编辑、删除。
- `func_admin_user_*`：用户启用禁用、重置密码、编辑角色。
- `func_channel_create_public` / `func_channel_create_non_public`：创建公开/非公开频道。

频道权限代表项：

- 消息：`func_channel_read`、`func_channel_text_send`、`func_channel_text_send_ooc`、`func_channel_file_send`、`func_channel_audio_send`。
- 频道管理：`func_channel_invite`、`func_channel_sub_channel_create`、`func_channel_manage_info`、`func_channel_manage_role`、`func_channel_manage_gallery`。
- 成员管理：`func_channel_role_link`、`func_channel_role_unlink`、Root 管理员变体。
- 消息管理：`func_channel_message_pin`、`func_channel_message_archive`、`func_channel_message_delete`、`func_channel_message_read_whisper_all`。
- iForm：`func_channel_iform_manage`、`func_channel_iform_broadcast`。
- 子频道特殊权限：`func_channel_read_all`、`func_channel_text_send_all`。

### 9.2 判断入口

- `pm.Can(uid, channelId, permissions...)`：通用判断。
- `pm.CanWithSystemRole(uid, permissions...)`：只看系统角色。
- `pm.CanWithChannelRole(uid, channelId, permissions...)`：频道角色判断；如果是子频道，会让根频道的 `read_all` / `text_send_all` 对子频道生效。
- `pm.RolePermApply(roleId, permLstNext)`：写入角色权限，并过滤非法权限字符串，同时更新内存 RBAC。

## 10. 子项目推荐集成路径

### 10.1 Web 前端/移动端子项目

1. `POST /api/v1/user-signin` 登录，保存返回 token。
2. REST 拉基础数据：`GET /api/v1/config`、`GET /api/v1/user-info`、`GET /api/v1/worlds`。
3. 建立 `/ws/seal`，发送 `op: 3` identify。
4. 用 WebSocket API 进入频道：`channel.enter`。
5. 拉历史消息：`message.list`。
6. 发送消息：`message.create`；本地用 `echo` 做请求响应匹配，用 `clientId` 做消息幂等。
7. 监听 `op: 0` 的事件更新本地状态。
8. 文件/图片先走上传接口拿附件 ID，再在消息 content/elements 中引用。

### 10.2 Bot 子项目

1. 管理员创建 Bot token。
2. Bot 用 32 位 token 连接 `/ws/seal` 或调用 REST。
3. 连接后注册命令提示：`bot.command.register`。
4. 接收 `interaction/command`、`message-created` 等事件后，用 `message.create` 回复。
5. 如果要扮演角色，先探测/启用角色能力相关 API：`character.capability.test`、`character.get/set/list`。
6. 注意 Bot 同一用户新连接会清理旧连接，避免多实例抢占。

### 10.3 数据同步/桥接子项目

1. 首选外部 Webhook API：
   - 拉变更：`GET /api/v1/webhook/channels/:channelId/changes`。
   - 写消息：`POST /api/v1/webhook/channels/:channelId/messages`。
   - 拉未读摘要：`GET /api/v1/webhook/channels/:channelId/digests/latest`。
2. 如果需要实时全量事件，再使用 WebSocket。
3. 外部系统 ID 应落到 `MessageExternalRefModel` / Webhook 相关流程，不建议写入消息正文。

### 10.4 同仓库 Go 扩展

1. 在 handler 层新增 REST 路由时，放在 `api/api_bind.go` 对应的公开、登录、管理员分组中。
2. 新增表结构在 `model/` 建模型，并加入 `model.DBInit` 的 `AutoMigrate`。
3. 跨模型业务放入 `service/`，避免 handler 过重。
4. 需要前端实时感知时，在业务完成后广播 `protocol.Event`。
5. 需要权限时，先在 `pm/perm_channel.go` 或 `pm/perm_system.go` 增加权限，再运行生成器更新 `pm/gen/*` 与前端权限类型。

## 11. 最小交互示例

### 11.1 登录并调用 REST

```bash
curl -X POST 'http://localhost:3211/api/v1/user-signin' \
  -H 'Content-Type: application/json' \
  -d '{"username":"alice","password":"password"}'

curl 'http://localhost:3211/api/v1/user-info' \
  -H 'Authorization: Bearer <token>'
```

### 11.2 WebSocket identify + ping

```json
{ "op": 3, "body": { "token": "<token>" } }
```

```json
{ "op": 1, "body": { "focused": true, "latency": 23 } }
```

### 11.3 发送频道消息

```json
{
  "api": "message.create",
  "echo": "msg-001",
  "data": {
    "channel_id": "<channelId>",
    "content": "Hello SealChat",
    "clientId": "client-msg-001",
    "icMode": "ic"
  }
}
```

## 12. 当前第一版集成风险清单

- 仓库尚未提供机器可读 OpenAPI schema；REST 参数需要继续以 handler 与 UI 调用为准。
- WebSocket API 的请求 `data` 字段在各 handler 中定义，当前本文只总结 API 名称与接入范式。
- 协议字段同时存在历史兼容命名（如 `parent_id`、`is_bot`、部分 snake_case），子项目不要强行统一改名。
- 同进程复用 service/model 时必须确保初始化顺序，否则会遇到 nil DB、权限树未初始化、storage 未配置等问题。
- 直接写数据库会绕过事件广播、权限检查、全文索引/回填逻辑，除迁移脚本外不建议这么做。

## 13. 后续文档建议

第二版建议补齐：

1. 自动从 `api/api_bind.go` 生成 REST 路由清单。
2. 为高频 WebSocket API（消息、频道、身份、Bot）补齐 request/response schema。
3. 为 Webhook、Bot、前端子项目各写一份端到端示例。
4. 抽取 TypeScript SDK 类型，直接复用 `protocol` 与 `ui/src/types*.ts`。
5. 在 CI 中校验文档路由与 `api/api_bind.go` 不漂移。
