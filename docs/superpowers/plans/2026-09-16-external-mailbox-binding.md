# 外部邮箱绑定模块实施计划

> **面向代理开发者：** 必须按任务逐项执行，并在每个任务完成后运行对应验证。每个任务使用复选框跟踪。

**目标：** 为现有邮箱系统增加外部邮箱独立账号、邮件同步和外部发信能力，同时保持本地邮箱行为不变。

**架构：** 在现有 `account` 账号体系上增加账号来源字段，用独立的 `external_account` 保存连接和加密凭据，用 `external_message` 做远程邮件幂等映射。服务层通过统一适配器接口接入谷歌、微软和通用邮箱协议；同步邮件继续写入现有 `email` 和附件表，前端复用当前账号侧栏和写信页面。

**技术栈：** Cloudflare Workers、Hono、D1、Drizzle、`postal-mime`、Vue3、Pinia、Element Plus、Vitest。

## 全局约束

- `account.source_type = 0` 表示本地邮箱，`account.source_type = 1` 表示外部邮箱；旧数据升级后必须全部保持为本地邮箱。
- 外部密码、刷新令牌和访问令牌必须加密保存，接口响应和日志不得暴露凭据。
- 外部邮箱作为独立账号展示，不合并到统一收件箱。
- 首次同步默认最近三十天，每次任务限制单账号处理数量，并通过游标继续同步。
- 同步邮件必须写入现有 `email` 表并关联本地 `account_id`，附件继续使用现有附件和对象存储流程。
- 本地账号必须继续使用现有收信和发信逻辑。
- 外部发信成功后才能写入本地发件记录；外部发信失败不得伪装成成功。
- 通用邮箱连接默认只接受加密连接；不把密码写入 `wrangler.toml`、数据库明文或调试日志。
- 前端新增文案必须同时补充 `mail-vue/src/i18n/zh.js` 和 `mail-vue/src/i18n/en.js`。
- 代码注释和用户可见文案遵循仓库现有中文约定；新增运行时依赖前先确认现有依赖无法满足需求。

---

## 文件与职责地图

### 后端

- 修改 `mail-worker/src/entity/account.js`：增加账号来源字段。
- 新建 `mail-worker/src/entity/external-account.js`：外部账号实体。
- 新建 `mail-worker/src/entity/external-message.js`：远程邮件映射实体。
- 修改 `mail-worker/src/init/init.js`：增加可重复执行的数据库升级。
- 新建 `mail-worker/src/utils/credential-utils.js`：基于运行时密钥的凭据加密和解密。
- 新建 `mail-worker/src/service/external-mail/contracts.js`：适配器输入输出契约和标准邮件结构。
- 新建 `mail-worker/src/service/external-mail/mime-service.js`：标准邮件解析、编码和附件转换。
- 新建 `mail-worker/src/service/external-mail/google-adapter.js`：谷歌邮箱授权接口适配器。
- 新建 `mail-worker/src/service/external-mail/microsoft-adapter.js`：微软邮箱授权接口适配器。
- 新建 `mail-worker/src/service/external-mail/generic-adapter.js`：通用加密邮箱连接适配器。
- 新建 `mail-worker/src/service/external-account-service.js`：账号生命周期、授权、同步和状态管理。
- 新建 `mail-worker/src/api/external-account-api.js`：外部账号接口。
- 修改 `mail-worker/src/hono/webs.js`：注册外部账号接口。
- 修改 `mail-worker/src/service/email-service.js`：外部账号发信分流。
- 修改 `mail-worker/src/index.js`：定时执行外部账号增量同步。
- 修改 `mail-worker/src/i18n/zh.js`、`mail-worker/src/i18n/en.js`：补充后端错误文案。
- 新建 `mail-worker/test/external-account.spec.js`：接口、同步和权限测试。
- 新建 `mail-worker/test/external-mail-adapter.spec.js`：适配器和邮件解析测试。

### 前端

- 新建 `mail-vue/src/request/external-account.js`：外部账号接口请求。
- 修改 `mail-vue/src/store/account.js`：增加外部账号状态和刷新方法。
- 新建 `mail-vue/src/components/external-account-dialog/index.vue`：绑定、编辑、测试和同步向导。
- 修改 `mail-vue/src/layout/account/index.vue`：入口、状态展示和账号操作。
- 修改 `mail-vue/src/i18n/zh.js`、`mail-vue/src/i18n/en.js`：补充界面文案。
- 修改 `mail-vue/src/enums/account-enum.js`：增加账号来源和连接状态枚举。

---

### 任务 1：数据库实体、升级和凭据加密

**文件：**

- 创建：`mail-worker/src/entity/external-account.js`
- 创建：`mail-worker/src/entity/external-message.js`
- 创建：`mail-worker/src/utils/credential-utils.js`
- 修改：`mail-worker/src/entity/account.js:3-14`
- 修改：`mail-worker/src/init/init.js:14-34`
- 测试：`mail-worker/test/external-account.spec.js`

**接口：**

- 产出 `account.sourceType`、`externalAccount`、`externalMessage`。
- 产出 `credentialUtils.encrypt(value, key)` 和 `credentialUtils.decrypt(value, key)`，返回字符串或对象，不接受缺失密钥。
- 产出数据库升级 `v3_4DB(c)`，可重复执行，旧账号的 `source_type` 为 `0`。

- [ ] **步骤 1：先写失败测试**

在 `mail-worker/test/external-account.spec.js` 增加纯逻辑测试：

```js
it('凭据加密后不能直接读出原文并且可以还原', async () => {
  const value = JSON.stringify({ password: '应用专用密码' });
  const encrypted = await credentialUtils.encrypt(value, '测试密钥');

  expect(encrypted).not.toContain('应用专用密码');
  expect(await credentialUtils.decrypt(encrypted, '测试密钥')).toBe(value);
});

it('旧账号默认属于本地邮箱', () => {
  expect(account.sourceType.default).toBe(0);
});
```

- [ ] **步骤 2：运行失败测试**

运行：

```powershell
pnpm --dir mail-worker exec vitest run test/external-account.spec.js
```

预期：因实体字段和加密工具尚未存在而失败。

- [ ] **步骤 3：实现最小数据库和加密代码**

`account.js` 增加：

```js
sourceType: integer('source_type').default(0).notNull(),
```

`external-account.js` 至少包含 `externalAccountId`、`accountId`、`userId`、`provider`、`authType`、`email`、服务器配置、加密凭据、同步字段、状态和错误字段。

`external-message.js` 至少包含 `externalMessageId`、`externalAccountId`、`remoteId`、`emailId`、`remoteThreadId`、`createTime`，并在初始化中创建 `(external_account_id, remote_id)` 唯一索引。

加密工具使用 `crypto.subtle` 的高强度对称加密算法，随机生成初始化向量，密文格式固定为 `版本.初始化向量.密文`。密钥缺失、格式错误或认证失败都抛出明确业务错误。

`v3_4DB(c)` 使用 `ALTER TABLE account ADD COLUMN ...` 和 `CREATE TABLE IF NOT EXISTS`，每条升级语句单独捕获“已经存在”错误，并在 `init()` 中追加调用。

- [ ] **步骤 4：运行通过测试**

运行：

```powershell
pnpm --dir mail-worker exec vitest run test/external-account.spec.js
```

预期：凭据加解密和实体默认值测试通过。

- [ ] **步骤 5：提交**

```powershell
git add mail-worker/src/entity mail-worker/src/utils/credential-utils.js mail-worker/src/init/init.js mail-worker/test/external-account.spec.js
git commit -m "feat: 添加外部邮箱数据模型"
```

### 任务 2：适配器契约和邮件标准化

**文件：**

- 创建：`mail-worker/src/service/external-mail/contracts.js`
- 创建：`mail-worker/src/service/external-mail/mime-service.js`
- 测试：`mail-worker/test/external-mail-adapter.spec.js`

**接口：**

每个适配器实现：

```js
{
  testConnection(input),
  listMessages(input),
  getMessage(input),
  sendMessage(input)
}
```

标准邮件结构固定为：

```js
{
  remoteId, remoteThreadId, messageId, inReplyTo, relation,
  from: { address, name },
  to: [{ address, name }], cc: [], bcc: [],
  subject, text, html, createTime, attachments: []
}
```

- [ ] **步骤 1：写失败测试**

覆盖纯文本、富文本、多个收件人、引用关系、内嵌图片和附件的原始邮件解析，并验证附件结构包含文件名、类型、大小和二进制内容。

- [ ] **步骤 2：运行失败测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-mail-adapter.spec.js
```

预期：标准化函数尚未存在而失败。

- [ ] **步骤 3：实现标准化工具**

使用现有 `postal-mime` 解析原始邮件；将解析结果转换为标准结构，缺失主题、发件人或正文时使用空值，不因单个异常字段中断整个邮件解析。

实现正文到发送原文的转换，正确生成发件人、收件人、抄送、密送、主题、回复引用、纯文本、富文本和附件部分。

- [ ] **步骤 4：运行通过测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-mail-adapter.spec.js
```

预期：所有邮件标准化测试通过。

- [ ] **步骤 5：提交**

```powershell
git add mail-worker/src/service/external-mail mail-worker/test/external-mail-adapter.spec.js
git commit -m "feat: 增加外部邮件标准化"
```

### 任务 3：常见服务商授权适配器

**文件：**

- 创建：`mail-worker/src/service/external-mail/google-adapter.js`
- 创建：`mail-worker/src/service/external-mail/microsoft-adapter.js`
- 修改：`mail-worker/src/service/external-account-service.js`
- 修改：`mail-worker/src/init/init.js`
- 测试：`mail-worker/test/external-mail-adapter.spec.js`

**接口：**

- `startAuthorization(c, provider, userId)` 返回授权地址和短时状态值。
- `completeAuthorization(c, provider, code, state, userId)` 返回外部账号信息和加密凭据。
- 服务商适配器使用 `listMessages`、`getMessage`、`sendMessage` 产出任务 2 定义的标准结构。

- [ ] **步骤 1：写失败测试**

用 `vi.stubGlobal('fetch', ...)` 验证：

- 授权状态与用户绑定，错误状态不能完成绑定。
- 授权回调能够交换访问令牌和刷新令牌。
- 访问令牌过期时只刷新一次并重试原请求。
- 列表接口的分页游标能够转换为统一游标。
- 服务商错误响应转换为不包含令牌的业务错误。

- [ ] **步骤 2：运行失败测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-mail-adapter.spec.js -t "授权"
```

预期：授权适配器尚未存在而失败。

- [ ] **步骤 3：实现授权和接口适配**

使用环境变量读取服务商客户端配置，不把客户端密钥提交到仓库。使用现有 KV 保存短时授权状态；状态内容至少包含用户标识、服务商和随机值。

谷歌适配器通过邮箱接口的邮件列表、邮件详情和发信接口工作；微软适配器通过微软图形接口的邮件列表、详情和发信接口工作。两者都把服务商响应转换为统一邮件结构。

令牌刷新后更新 `external_account` 的加密凭据。所有访问令牌只存在于当前请求内存中。

- [ ] **步骤 4：运行通过测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-mail-adapter.spec.js -t "授权"
```

预期：授权状态、令牌刷新、分页和错误转换测试通过。

- [ ] **步骤 5：提交**

```powershell
git add mail-worker/src/service/external-mail mail-worker/src/service/external-account-service.js mail-worker/src/init/init.js mail-worker/test/external-mail-adapter.spec.js
git commit -m "feat: 接入常见邮箱授权"
```

### 任务 4：通用加密邮箱连接适配器

**文件：**

- 创建：`mail-worker/src/service/external-mail/generic-adapter.js`
- 修改：`mail-worker/src/service/external-account-service.js`
- 测试：`mail-worker/test/external-mail-adapter.spec.js`

**接口：**

- `testConnection({ receive, send, credential })`
- `listMessages({ receive, credential, cursor, since, limit })`
- `getMessage({ receive, credential, remoteId })`
- `sendMessage({ send, credential, message })`

- [ ] **步骤 1：写失败测试**

使用伪造的可读写流验证：

- 只接受安全连接配置。
- 收信连接能完成登录、选择收件箱、分页读取远程标识和获取原文。
- 单封邮件命令失败时返回可读错误并关闭连接。
- 发信连接能完成登录、发件人、收件人、邮件原文和退出流程。
- 多个收件人和附件原文可以正确写入发送命令。

- [ ] **步骤 2：运行失败测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-mail-adapter.spec.js -t "通用"
```

预期：通用适配器尚未存在而失败。

- [ ] **步骤 3：实现最小协议客户端**

使用运行时提供的出站连接接口建立加密连接；默认端口使用收信九百九十三、发信四百六十五或五百八十七，不允许使用明文协议配置。

将命令读写封装为带超时的会话对象，所有服务器响应先按状态判断，再解析数据。读取邮件原文后交给 `mime-service.js`，发信原文由同一模块生成。

适配器只负责协议，不负责数据库写入；连接超时、认证失败、服务器拒绝和解析失败分别转换为稳定错误类型。

- [ ] **步骤 4：运行通过测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-mail-adapter.spec.js -t "通用"
```

预期：安全校验、收信、发信和失败路径测试通过。

- [ ] **步骤 5：提交**

```powershell
git add mail-worker/src/service/external-mail/generic-adapter.js mail-worker/src/service/external-account-service.js mail-worker/test/external-mail-adapter.spec.js
git commit -m "feat: 支持通用邮箱连接"
```

### 任务 5：外部账号接口、同步服务和定时任务

**文件：**

- 创建：`mail-worker/src/api/external-account-api.js`
- 修改：`mail-worker/src/hono/webs.js`
- 修改：`mail-worker/src/service/external-account-service.js`
- 修改：`mail-worker/src/index.js`
- 修改：`mail-worker/src/i18n/zh.js`
- 修改：`mail-worker/src/i18n/en.js`
- 测试：`mail-worker/test/external-account.spec.js`

**接口：**

- `list(c, userId)` 返回脱敏账号列表。
- `addGeneric(c, params, userId)` 创建通用外部账号。
- `startOAuth(c, provider, userId)` 和 `completeOAuth(c, params, userId)` 完成授权绑定。
- `test(c, params, userId)` 只测试连接，不创建账号。
- `sync(c, externalAccountId, userId)` 返回新增、跳过、失败数量。
- `delete(c, externalAccountId, userId)` 解除绑定并保留本地邮件。
- `syncAll(c)` 只处理启用状态的外部账号。

- [ ] **步骤 1：写失败测试**

覆盖以下行为：

- 非当前用户不能查询、同步、修改或删除外部账号。
- 创建账号会先测试连接，再同时创建 `account` 和 `external_account`。
- 重复绑定同一用户同一邮箱返回业务错误。
- 同一远程邮件重复同步时只保留一条本地邮件。
- 邮件正文和附件写入现有表，映射表保存远程标识。
- 单封邮件失败不影响同批次其他邮件，游标保存到最后成功位置。
- 删除外部账号不删除已同步邮件。

- [ ] **步骤 2：运行失败测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-account.spec.js
```

预期：接口和同步服务尚未实现而失败。

- [ ] **步骤 3：实现账号服务和接口**

在 `external-account-service.js` 中集中实现用户权限校验、账号来源校验、凭据解密、适配器选择、邮件标准化、附件写入和远程映射写入。接口层只负责读取请求、调用服务和返回统一结果。

新增路由：

```js
app.get('/external-account/list', ...);
app.post('/external-account/add', ...);
app.post('/external-account/test', ...);
app.post('/external-account/oauth/start', ...);
app.post('/external-account/oauth/callback', ...);
app.post('/external-account/sync', ...);
app.post('/external-account/reauthorize', ...);
app.put('/external-account/update', ...);
app.delete('/external-account/delete', ...);
```

同步使用数据库事务边界：先写邮件和附件，再写映射和游标；已存在映射直接跳过。新增错误文案必须同时加入中英文国际化文件。

在 `scheduled` 中调用 `externalAccountService.syncAll({ env })`，单账号错误只记录到账号状态，不阻断其他账号同步。

- [ ] **步骤 4：运行通过测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-account.spec.js
```

预期：账号隔离、重复绑定、同步幂等、附件写入和定时同步测试通过。

- [ ] **步骤 5：提交**

```powershell
git add mail-worker/src/api/external-account-api.js mail-worker/src/hono/webs.js mail-worker/src/service/external-account-service.js mail-worker/src/index.js mail-worker/src/i18n/zh.js mail-worker/src/i18n/en.js mail-worker/test/external-account.spec.js
git commit -m "feat: 增加外部邮箱同步接口"
```

### 任务 6：接入外部发信和回复

**文件：**

- 修改：`mail-worker/src/service/email-service.js:250-435`
- 修改：`mail-worker/src/service/external-account-service.js`
- 修改：`mail-worker/src/i18n/zh.js`
- 修改：`mail-worker/src/i18n/en.js`
- 测试：`mail-worker/test/external-account.spec.js`

**接口：**

- `externalAccountService.send(c, accountRow, params, userId)` 返回发送结果和远程邮件标识。
- 现有 `emailService.send` 继续接受原有参数，只在确认 `accountRow.sourceType` 后分流。

- [ ] **步骤 1：写失败测试**

验证：

- 本地账号仍调用原有云端发送逻辑。
- 外部账号不会调用本地发送服务，而是调用对应适配器。
- 外部发送成功后保存发件记录和收件人列表。
- 外部发送失败不写入成功邮件记录。
- 回复外部邮件时传递原邮件标识和引用头。
- 外部账号属于其他用户时返回现有权限错误。

- [ ] **步骤 2：运行失败测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-account.spec.js -t "发信"
```

预期：外部发信分支尚未存在而失败。

- [ ] **步骤 3：实现发信分流**

在现有发信服务完成账号归属和权限校验后增加：

```js
if (accountRow.sourceType === 1) {
  return externalAccountService.send(c, accountRow, params, userId);
}
```

外部发送成功后复用现有邮件记录字段写入 `email` 表，使用标准化邮件原文中的主题、正文、收件人、抄送、密送和回复引用信息。附件先转换为发送适配器所需格式，发送失败时不增加用户发信计数。

- [ ] **步骤 4：运行通过测试**

```powershell
pnpm --dir mail-worker exec vitest run test/external-account.spec.js -t "发信"
```

预期：本地发信回归、外部发信成功、失败和回复测试通过。

- [ ] **步骤 5：提交**

```powershell
git add mail-worker/src/service/email-service.js mail-worker/src/service/external-account-service.js mail-worker/src/i18n/zh.js mail-worker/src/i18n/en.js mail-worker/test/external-account.spec.js
git commit -m "feat: 支持外部邮箱发信"
```

### 任务 7：前端绑定向导和账号侧栏

**文件：**

- 创建：`mail-vue/src/request/external-account.js`
- 创建：`mail-vue/src/components/external-account-dialog/index.vue`
- 修改：`mail-vue/src/store/account.js`
- 修改：`mail-vue/src/layout/account/index.vue`
- 修改：`mail-vue/src/enums/account-enum.js`
- 修改：`mail-vue/src/i18n/zh.js`
- 修改：`mail-vue/src/i18n/en.js`

**接口：**

- 请求模块提供 `externalAccountList`、`externalAccountAdd`、`externalAccountTest`、`externalAccountSync`、`externalAccountUpdate`、`externalAccountDelete`、`externalAccountOAuthStart`。
- 对话框通过事件 `success(account)` 通知侧栏刷新账号列表，通过事件 `close` 关闭自身。
- 账号状态字段与后端脱敏返回字段保持一致：`accountId`、`email`、`name`、`sourceType`、`provider`、`status`、`lastSyncTime`、`lastError`。

- [ ] **步骤 1：先写请求和状态行为**

先在请求模块中定义接口参数和返回值，再在账号状态中增加：

```js
externalAccounts: [],
externalLoading: false,
refreshExternalAccounts(),
syncExternalAccount(accountId),
```

验证新增方法不会改变现有 `currentAccountId`、`currentAccount` 和本地账号列表行为。

- [ ] **步骤 2：实现绑定对话框**

对话框分为两种模式：

- 授权模式：选择谷歌或微软，点击授权后跳转，回调完成后刷新列表。
- 通用配置模式：填写邮箱、显示名称、收信服务器、收信端口、发信服务器、发信端口、账号和专用密码，先测试连接，成功后创建账号。

成功绑定后提供立即同步按钮；同步中禁用提交和关闭操作，完成后展示新增和跳过数量；错误展示后端返回的可读消息。

- [ ] **步骤 3：改造账号侧栏**

在 `layout/account/index.vue` 中：

- 保留现有本地账号新增按钮。
- 增加“绑定其他邮箱”入口。
- 对外部账号显示服务商和同步状态。
- 增加同步、重新授权、编辑和解除绑定操作。
- 删除外部账号前提示只解除绑定且保留本地邮件。
- 账号切换时继续只更新现有 `accountStore.currentAccountId` 和 `currentAccount`。

- [ ] **步骤 4：补充枚举和国际化**

增加账号来源、连接状态、服务商名称、连接测试、同步、重新授权和解除绑定文案，并同步更新中英文文件。

- [ ] **步骤 5：运行前端构建**

```powershell
pnpm --dir mail-vue run build
```

预期：生产构建成功，且没有未解析模块或模板编译错误。

- [ ] **步骤 6：提交**

```powershell
git add mail-vue/src/request/external-account.js mail-vue/src/components/external-account-dialog/index.vue mail-vue/src/store/account.js mail-vue/src/layout/account/index.vue mail-vue/src/enums/account-enum.js mail-vue/src/i18n/zh.js mail-vue/src/i18n/en.js
git commit -m "feat: 增加外部邮箱绑定界面"
```

### 任务 8：集成验证、配置说明和收尾

**文件：**

- 修改：`README.md`
- 修改：`README-en.md`
- 修改：`mail-worker/wrangler-dev.toml`
- 修改：`mail-worker/wrangler-test.toml`
- 修改：`mail-worker/wrangler-action.toml`
- 修改：`mail-worker/wrangler.toml`
- 测试：`mail-worker/test/index.spec.js`

- [ ] **步骤 1：补充运行配置说明**

只增加变量名和配置说明，不提交任何真实密钥。说明外部凭据加密密钥、谷歌客户端配置、微软客户端配置和授权回调地址的配置方式；开发、测试和生产配置保持变量名称一致。

- [ ] **步骤 2：运行后端完整测试**

```powershell
pnpm --dir mail-worker exec vitest run
```

预期：原有测试和新增测试全部通过。

- [ ] **步骤 3：运行前端生产构建**

```powershell
pnpm --dir mail-vue run build
```

预期：构建成功。

- [ ] **步骤 4：检查差异和敏感信息**

```powershell
git diff --check
rg -n "password|token|secret|client_secret|专用密码" mail-worker/src mail-vue/src README.md README-en.md
git status --short
```

预期：代码中只出现字段名、脱敏文案和配置说明，不出现真实凭据；工作区只包含本功能相关改动。

- [ ] **步骤 5：提交收尾**

```powershell
git add README.md README-en.md mail-worker/wrangler-dev.toml mail-worker/wrangler-test.toml mail-worker/wrangler-action.toml mail-worker/wrangler.toml mail-worker/test/index.spec.js
git commit -m "docs: 补充外部邮箱配置说明"
```

## 验收标准

- 旧本地邮箱可以正常登录、收信、发信和切换。
- 用户可以添加一个通用外部邮箱，并在测试连接通过后完成绑定。
- 外部邮箱以独立账号出现在侧栏，能够手动同步邮件。
- 同一远程邮件重复同步不会出现重复记录。
- 外部邮件正文和附件可以在现有详情页查看。
- 用户可以使用外部邮箱地址发信和回复。
- 授权过期、连接失败和发信失败都有可读状态，且不会泄露凭据。
- 后端测试和前端生产构建通过。

