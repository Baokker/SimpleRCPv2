# IDE Agent 界面与 Monaco 语言支持调研

调研日期：2026-09-19

## 调研范围

本文只采用 Cursor、Visual Studio Code、Zed、Monaco Editor 与 `@monaco-editor/react` 的官方文档或官方源码，覆盖以下问题：

- IDE 内 Agent 的 session、聊天时间线、执行过程、composer 与代码上下文应当怎样组织。
- Monaco Editor 是否已经提供 C/C++ 和常见语言的语法高亮，文件路径如何关联 `language id`，何时才需要额外 tokenizer。

## IDE Agent 的共同设计

### Session 是持续对话容器

VS Code 将 session 定义为一段完整的 Agent 对话，其中包含用户指令、Agent 回复、工具调用以及逐步积累的上下文。每个 session 有独立的上下文窗口，可以持续接收后续指令，也可以与其他 session 同时运行。[VS Code：Agent sessions](https://code.visualstudio.com/docs/agents/concepts/sessions)

Zed 采用 thread 表达相同概念。多个 thread 可以同时运行，每个 thread 具有独立 Agent、上下文窗口和历史记录；Thread Sidebar 负责切换、归档与恢复。[Zed：Agent Panel - Managing Multiple Threads](https://zed.dev/docs/ai/agent-panel#multiple-threads)

Cursor 也把一次长期任务保存在持续对话中，并提供 side chat、queued message、steer 与 checkpoint。side chat 保留自己的 transcript，并将父 thread 作为隐藏上下文。[Cursor：Agent - Side chats](https://cursor.com/docs/agent/overview.md#side-chats)

由此可得，SimpleRCPv2 的 Agent 面板应当把 `session` 作为主要导航单位。`run` 属于 session 内部的一轮执行，不应当出现在与 session 同级的独立列表中。一个 session 的正文按照时间顺序连续展示用户消息和 Agent 消息。

### 顶部、session 切换、时间线、composer 构成稳定的四层结构

VS Code Chat View 的官方界面分为 sessions list、chat conversation 和 chat input 三个主要区域。sessions list 位于顶部；conversation 显示历史和 Agent 回复；input 位于底部，并承载 Agent target、Agent、model 与 permission 等配置。[VS Code：Chat View - Interface overview](https://code.visualstudio.com/docs/agents/run/chat-view#interface-overview)

Zed 的 Agent Panel 采用同样的主线：工具栏用于创建或切换 thread，中部为 thread 消息，底部为 message editor；模型和 token 使用量靠近 message editor。[Zed：Agent Panel](https://zed.dev/docs/ai/agent-panel)

Cursor 的 Agent 位于 IDE sidepane，prompt input 支持上下文、图片、语音和模型切换；Agents Window 用于跨项目管理大量并行 Agent。[Cursor：Agent Overview](https://cursor.com/docs/agent/overview.md)、[Cursor：Prompting agents](https://cursor.com/docs/agent/prompting.md)、[Cursor：Agents Window](https://cursor.com/docs/agent/agents-window.md)

SimpleRCPv2 右侧面板采用以下顺序：

1. 顶部状态栏显示 `OpenCode Ready`、当前 model、创建 session 与更多操作。运行环境状态只出现一次。
2. 紧随其后的 session tab 区显示用户的 session。宽度有限时使用单行可横向滚动的 tab，并提供 session 列表菜单；tab 显示标题、运行状态和未读状态。
3. 中间区域只显示当前 session 的对话时间线。每一轮由用户消息、Agent 执行过程、Agent 最终回复以及本轮文件变化组成。
4. composer 固定在面板底部。滚动消息时 composer 保持可用。

现有页面中的 `MY SESSIONS`、`CONVERSATION`、任务摘要、运行结果和 trace 卡片占用了多个纵向区域，同一 session 的信息被重复展示。新的结构让 session tab 承担导航，让时间线承担历史，让 composer 承担下一次输入。

### 对话应当保持“用户一轮，Agent 一轮”的阅读节奏

VS Code 明确说明 conversation 区展示历史和 Agent responses，并将一次 request 完成后的改动作为该轮回复的一部分。[VS Code：Chat View](https://code.visualstudio.com/docs/agents/run/chat-view)

Cursor 的 checkpoint 绑定到 chat timeline 中的 request；恢复 checkpoint 只恢复文件，不删除对话消息。[Cursor：Agent - Checkpoints](https://cursor.com/docs/agent/overview.md#checkpoints)

Zed 允许点击用户消息卡片修改并重新提交，也允许从 thread 内直接导航消息。[Zed：Agent Panel - Editing Messages](https://zed.dev/docs/ai/agent-panel#editing-messages)、[Zed：Agent Panel - Navigating the Thread](https://zed.dev/docs/ai/agent-panel#navigating-the-thread)

建议每轮采用以下内容层级：

- 用户消息使用独立消息块，展示原始文本与已附加上下文。
- Agent 区域先显示运行状态；执行完成后显示简短的步骤摘要，例如 `Completed · 11 steps · 3 files changed`。
- 最终回复直接展示 Markdown 正文，代码块保留复制与跳转能力。
- 本轮文件变化显示为紧凑列表，点击文件打开 diff 或编辑器。
- 取消、失败、等待确认等状态放在对应轮次内，避免与整个 session 状态混合。

### 思考与工具过程应当按一轮聚合并默认收起

VS Code 的聊天查找会在命中内容时展开 `Completed N steps` 区域，并明确区分 tool pill、collapsed reasoning 与最终回复。复制完整消息时会包含 thinking steps 和 tool calls；`Copy Final Response` 只复制最后一次工具调用之后的最终 Markdown。这说明其信息层级为“默认可读的最终回复 + 可展开的执行过程”。[VS Code：Chat overview - Find text](https://code.visualstudio.com/docs/chat/chat-overview#find-text-in-a-chat-session)、[VS Code：Manage sessions - Copy chat messages](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions#copy-chat-messages-as-markdown)

Zed 在回复流中显示正在使用哪些工具，并将 `Context Compacted` 作为可展开条目；文件变化也通过 accordion 展开。[Zed：Agent Panel - Overview](https://zed.dev/docs/ai/agent-panel#overview)、[Zed：Agent Panel - Reviewing Changes](https://zed.dev/docs/ai/agent-panel#reviewing-changes)、[Zed：Agent Panel - Token Usage and Compaction](https://zed.dev/docs/ai/agent-panel#token-usage)

SimpleRCPv2 每轮 Agent 回复使用一个 `details` 区域承载过程，折叠标题同时显示状态、耗时、步骤数量和文件数量。展开后按照发生顺序展示：

- reasoning 或进度消息；
- 文件读取与搜索；
- 文件写入及 patch 摘要；
- 命令、退出状态和可展开输出；
- permission、错误与恢复信息。

最终回复位于折叠区域之后并保持可见。每条中间事件可以使用紧凑行或 tool pill；超长命令输出继续提供第二层展开。这样的层级可以同时满足日常阅读和 trace 检查，不需要为 Agent 的每一个句子创建一个独立折叠框。

### Composer 是输入和上下文管理中心

Cursor 通过 `@` 在输入框内添加文件、目录、终端、历史 chat、Git diff 和 browser 上下文，也支持拖放与粘贴图片。[Cursor：Prompting agents - @ mentions](https://cursor.com/docs/agent/prompting.md#-mentions)、[Cursor：Prompting agents - Image input](https://cursor.com/docs/agent/prompting.md#image-input)

VS Code 通过 `#` 或 Add Context 添加文件、目录、symbol、terminal output、source control change 等内容；还支持把 Explorer、Search 和 editor tab 中的文件或目录拖入 chat。[VS Code：Add context to chat](https://code.visualstudio.com/docs/chat/copilot-chat-context)

Zed 通过 `@` 添加文件、目录、symbol、历史 thread、diagnostic、branch diff 和 URL。复制多行代码时，Zed 会自动转成带文件上下文的 mention；编辑器和终端选区也可以加入当前 thread。[Zed：Agent Panel - Adding Context](https://zed.dev/docs/ai/agent-panel#adding-context)

SimpleRCPv2 composer 应当支持：

- 多行输入，内容增长到设定高度后内部滚动；
- `@` 文件搜索，选择后以可移除的 context chip 显示；
- 从文件树和 editor tab 拖入文件；
- 从 Monaco 当前选区执行 `Add selection to Agent`，生成包含文件路径、起止行号和选区文本的 context chip；
- 直接粘贴代码，使用 Markdown fenced code block 保留语言信息；从 Monaco 复制的内容可以自动关联来源文件和行号；
- model 选择、运行模式或 permission 选择位于输入框下沿；
- 发送按钮在执行期间切换为停止、加入队列或立即引导当前执行。

Cursor、VS Code 和 Zed 都支持 Agent 工作期间继续发消息，并区分排队、引导当前执行和立即停止。[Cursor：Queued messages](https://cursor.com/docs/agent/overview.md#queued-messages)、[VS Code：Send messages while a request is running](https://code.visualstudio.com/docs/chat/chat-overview#send-messages-while-a-request-is-running)、[Zed：Queueing Messages](https://zed.dev/docs/ai/agent-panel#queueing-messages)

## 适用于当前页面的界面规格

### 顶部区域

- 第一行：绿色状态点、`OpenCode Ready`、当前 model；右侧使用图标按钮提供新建 session 和更多操作。
- 第二行：session tabs。每个 tab 只显示标题和状态图标；标题截断并通过 tooltip 显示完整内容。
- 当前 session 的标题可以在 tab 菜单中重命名。完成的 session 允许归档，历史通过菜单恢复。
- `Download trace` 放入当前 session 的更多操作；日常界面保留 `View run details` 入口。

### 消息时间线

- 用户消息与 Agent 回复使用明显不同的背景和留白，并保留统一的正文宽度。
- Agent 正在执行时，步骤区域保持展开并滚动到最新事件；完成后自动收起，用户手动展开后保持展开状态。
- 最终回复、代码块和文件列表保持可见。文件列表按本轮变化展示增加和删除行数。
- `Completed`、model、耗时与 token 等元数据使用一行紧凑文本，避免形成单独的大型结果卡片。
- 当前 session 没有历史时直接显示 composer，不再显示任务摘要和空的 conversation 分区。

### Composer

- 固定在面板底部，顶部显示 context chips，中间为输入区，下沿显示添加上下文、model、permission 和发送操作。
- `Add context` 菜单至少提供 `File`、`Folder`、`Current selection`、`Open editors` 和 `Terminal selection`。
- 已附加代码必须显示文件路径与行号；点击 chip 跳转到 Monaco 对应位置。
- 输入框支持 Enter 发送、Shift+Enter 换行；执行期间提供 queue、steer 与 stop。

### 响应式行为

VS Code 为 Chat View 提供 compact 和 side-by-side 两种 session list 布局；compact 模式在 session list 与 conversation 之间切换，宽区域可以同时显示两者。[VS Code：Manage sessions - Sessions list](https://code.visualstudio.com/docs/agents/run/sessions/manage-sessions#sessions-list)

SimpleRCPv2 当前右栏宽度适合 tab 形式。面板进一步变窄时保留当前 tab，并把其余 session 放入下拉菜单；面板变宽后允许显示更多 tab。时间线和 composer 始终占满可用宽度。

## Monaco Editor 语言支持

### Monaco 已经提供常见语言的基础语法高亮

Monaco 的语言目录包含 C、C++、C#、CSS、Dart、Dockerfile、Go、HTML、Java、JavaScript、JSON、Kotlin、Lua、Markdown、Objective-C、Perl、PHP、PowerShell、Python、Ruby、Rust、Shell、SQL、Swift、TypeScript、XML、YAML 等常见语言。[Monaco Editor 官方源码：language definitions](https://github.com/microsoft/monaco-editor/tree/main/src/languages/definitions)

Monaco 将 model 作为文件内容、语言和编辑历史的载体；provider 在 model 上提供 completion、hover 等增强能力。语法着色与语言服务属于不同层次，具备语法着色不表示同时具备完整编译器语义功能。[Monaco Editor README：Concepts](https://github.com/microsoft/monaco-editor#concepts)

### C/C++ 已经有内置语言登记与 Monarch tokenizer

项目当前依赖 `monaco-editor@0.49.0`。该版本官方源码登记了两个 language id：

- `c`：`.c`、`.h`；
- `cpp`：`.cpp`、`.cc`、`.cxx`、`.hpp`、`.hh`、`.hxx`。

来源：[Monaco Editor v0.49.0：C/C++ registration](https://github.com/microsoft/monaco-editor/blob/v0.49.0/src/basic-languages/cpp/cpp.contribution.ts)

同版本的 C/C++ 语言定义已经包含关键字、运算符、注释、字符串、数字、预处理指令和括号 token 规则。[Monaco Editor v0.49.0：C/C++ Monarch definition](https://github.com/microsoft/monaco-editor/blob/v0.49.0/src/basic-languages/cpp/cpp.ts)

因此项目无需为 C++ 重新编写关键字列表或 tokenizer。`example.cpp` 的 model 语言为 `cpp` 后，Monaco 会按需加载内置 C++ Monarch tokenizer 和语言配置。官方注册器的实现可见 [Monaco Editor：language loader](https://github.com/microsoft/monaco-editor/blob/main/src/languages/definitions/_.contribution.ts)。

### 文件路径可以直接驱动语言识别

`monaco.editor.createModel(value, language, uri)` 支持显式传入 language；省略 language 时，会根据 model URI 推断语言。[Monaco Editor API：createModel](https://microsoft.github.io/monaco-editor/docs.html#functions/editor.createModel.html)

`monaco.languages.getLanguages()` 返回全部已登记语言。每个 `ILanguageExtensionPoint` 可以声明 `extensions`、`filenames`、`filenamePatterns`、`firstLine`、`aliases` 和 `mimetypes`。[Monaco Editor API：getLanguages](https://microsoft.github.io/monaco-editor/docs.html#functions/languages.getLanguages.html)、[Monaco Editor API：ILanguageExtensionPoint](https://microsoft.github.io/monaco-editor/docs.html#interfaces/languages.ILanguageExtensionPoint.html)

`@monaco-editor/react` 的 `path` prop 用作 model URI，并说明 `value`、`language`、`path` 是创建 model 的三个参数。该组件在切换 path 时复用已有 model，并保留选区、撤销历史和滚动位置。[`@monaco-editor/react` README：Multi-model editor](https://github.com/suren-atoyan/monaco-react#multi-model-editor)

当前 `EditorArea.tsx` 同时传入 `path` 和人工维护的 `languageForPath`。建议让 Monaco 使用 model URI 和官方语言登记完成常见文件识别：给每个 model 提供稳定、保留扩展名的 URI，创建新 model 时省略 language。确实需要覆盖时再调用 `monaco.editor.setModelLanguage(model, languageId)`。[Monaco Editor API：setModelLanguage](https://microsoft.github.io/monaco-editor/docs.html#functions/editor.setModelLanguage.html)

这项方式能够自动获得 Monaco 已登记语言的扩展名、特殊文件名和首行规则，避免项目维护另一份不完整映射。产品可额外提供语言选择器，用于没有扩展名、扩展名存在歧义或用户希望临时覆盖的文件。

### 需要额外 tokenizer 的条件

以下情况才需要调用 `monaco.languages.register` 和 `setMonarchTokensProvider`：

- Monaco 没有登记该语言；
- 项目拥有自定义 DSL；
- 项目需要修改现有语言的 token 规则。

来源：[Monaco Editor API：register](https://microsoft.github.io/monaco-editor/docs.html#functions/languages.register.html)、[Monaco Editor API：setMonarchTokensProvider](https://microsoft.github.io/monaco-editor/docs.html#functions/languages.setMonarchTokensProvider.html)

若目标是 TextMate grammar 兼容，Monaco 官方 FAQ 说明自身不直接支持 TextMate grammar，并给出 `vscode-textmate`、`vscode-oniguruma` 与 Monaco 的集成方向。[Monaco Editor README：TextMate grammar FAQ](https://github.com/microsoft/monaco-editor#faq)

C/C++ 属于内置语言，当前需求不满足上述条件，因此不增加额外 tokenizer 依赖。

## C++ 高亮检查顺序

截图中 C++ 文本没有显示预期颜色时，按照以下顺序验证：

1. 检查 `editor.getModel()?.getLanguageId()` 是否为 `cpp`。
2. 等待语言按需加载后调用 `monaco.editor.tokenize('int value = 1; // comment', 'cpp')`，确认结果包含 `keyword.cpp`、number 和 comment 等 token。Monaco 提供官方 `tokenize` API，可直接检查 tokenizer 输出。[Monaco Editor API：tokenize](https://microsoft.github.io/monaco-editor/docs.html#functions/editor.tokenize.html)
3. 检查当前 theme 是否为 `vs` 或 `vs-dark`，并检查页面 CSS 是否覆盖 `.monaco-editor` 内 token 的颜色。
4. 检查浏览器 Network 与 Console，确认 C++ language module 已经加载且没有资源加载错误。
5. 检查运行时 Monaco 版本。`@monaco-editor/react` 官方文档说明其 loader 默认从 CDN 下载 Monaco，也允许通过 `loader.config({ monaco })` 使用项目安装的 ESM 包。[`@monaco-editor/react` README：loader/config](https://github.com/suren-atoyan/monaco-react#loaderconfig)

项目已经声明 `monaco-editor@0.49.0`，建议显式把同一个本地 `monaco` 实例传给 loader，使运行时代码、TypeScript 类型、语言定义与 lockfile 版本一致，同时避免语言资源依赖外部 CDN。

## 验收项目

- 新建 `.cpp` 文件后，model language id 为 `cpp`，`int`、`const`、`for`、`return`、字符串、数字、注释和 `#include` 显示不同 token 样式。
- `.c` 使用 `c`；`.hpp`、`.cc`、`.cxx` 使用 `cpp`；Monaco 登记的其他常见语言通过 URI 自动识别。
- Dockerfile、Makefile 等特殊文件名按照 Monaco 的 `filenames` 规则识别。
- 没有识别结果的文件使用 `plaintext`，用户可以从语言选择器覆盖。
- 切换 editor tab 后 model、language id、选区、撤销历史和滚动位置保持不变。
- Agent 面板顶部只显示一次 OpenCode 状态；session 通过 tab 切换；当前 session 正文保持连续聊天时间线；composer 固定在底部。
- 每轮 Agent 的最终回复直接可见，执行过程可以展开；文件变化归属于对应轮次。
- composer 可以添加文件和 Monaco 选区，context chip 显示路径与行号并支持移除和跳转。
