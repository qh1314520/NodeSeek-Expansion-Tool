# NodeSeek Expansion Tool

适用于 Chrome 和 Microsoft Edge 的 Manifest V3 扩展。NodeSeek / DeepFlood 论坛插件，提供用户标签、内容管理、趋势图、自动传图、签到提醒、阅读导航、快捷评论、快捷短语、抽奖通知、站内消息通知和访问历史等实用功能。

## 主要功能

- 集成 Nodeseek Max-iSen v1.1.21 的主要页面增强能力：楼中楼、连续加载、快捷回复、回帖足迹、关键词过滤、用户关系、浏览历史、链接净化、NodeImage 图片上传、抽奖识别与提醒等；按需求移除了低等级内容屏蔽。
- “内容管理”可按 NodeSeek / DeepFlood 分站维护关键词与用户屏蔽，支持分组启停、标记颜色、折叠、隐藏、高亮和备注；“快捷短语”可在后台分组增删改，并从论坛编辑器气泡按钮插入。
- 弹窗与设置页以网页增强为主入口，采用极简现代的浅色 / 深色双主题；通知监控与推送渠道作为次级模块。
- 后台检查艾特、主题回复和站内私信；论坛标签页关闭后仍可工作。
- 以通知 ID 建立基线和去重，发送失败会指数退避重试。
- 支持浏览器桌面通知、Telegram Bot、邮件、微信推送、企业微信、钉钉和飞书。
- “抽奖助手”会记录已参加和已跟踪的抽奖帖，展示参与方式、参与时间、开奖时间、通知状态及中奖结果；参与记录、抽奖跟踪和通知状态保存在本地并包含在完整备份中。
- 抽奖通知复用统一推送渠道，可分别控制浏览器通知、外部推送、开奖前提醒和开奖结果通知；“自动签到”已从抽奖助手拆分为独立设置页。
- 通知渠道默认关闭，密钥只保存在 `chrome.storage.local`。
- NodeImage 上传固定使用 `https://api.nodeimage.com/api/upload`，API Key 可在“网页增强”页配置并仅保存在本机。
- “网页增强”设置页覆盖上游 `v1.1.21` 中实际启用模块的全部持久配置；论坛上下文相关的数据操作仍保留在页面内执行。
- 已复核 GreasyFork `v1.0.8`：其功能模块与持久设置均已覆盖；后台“完整备份”还会保存 NodeSeek / DeepFlood 的关键词、浏览历史、快捷回复、好友、黑名单、已访问记录和新标签页偏好，并可导入 GreasyFork `nsx-backup` 与旧版扩展备份。
- “自动签到”页提供 NodeSeek / DeepFlood 独立开关、签到方式和“重试签到”操作，替代扩展环境中不可见的油猴菜单命令。

## 本地安装

### Chrome

1. 打开 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择本项目的 `extension` 目录。

### Microsoft Edge

1. 打开 `edge://extensions/`。
2. 开启“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本项目的 `extension` 目录。

安装后打开扩展设置即可管理页面增强；需要站外提醒时，再配置论坛监控和所需通知渠道。首次成功检查只建立当前通知基线，不会批量推送历史通知。

## 通知渠道

| 渠道 | 配置 |
| --- | --- |
| Telegram Bot | Bot Token、Chat ID |
| 邮件 | Resend、Mailgun、SendGrid 或 EmailJS |
| 微信推送 | Server酱³、Server酱旧版或 PushPlus |
| 企业微信 | 群机器人 Webhook |
| 钉钉 | Webhook，可选加签 Secret 和提醒手机号 |
| 飞书 | Webhook，可选签名密钥 |

## 隐私与权限

- 扩展不会保存论坛密码，也不会读取浏览器密码、历史记录或其他站点 Cookie。
- 论坛请求使用浏览器当前登录状态，仅访问通知列表和页面增强所需接口。
- 开启第三方渠道后，通知标题、用户名、主题或私信摘要会发送到用户配置的服务。
- 可以关闭“包含私信摘要”，仅发送“打开论坛查看私信内容”。
- 主机权限仅覆盖 NodeSeek / DeepFlood、NodeImage、drand 以及当前支持的通知服务域名，不申请通配的 `https://*/*` 访问权限。
- Manifest V3 后台由浏览器调度，休眠或关闭浏览器时无法保证精确到分钟。

## 开发与验证

项目无需构建步骤，`extension` 目录可直接加载。

```powershell
npm.cmd test
npm.cmd run check
npm.cmd run smoke:edge
```

Edge 冒烟测试会在屏幕外打开临时浏览器窗口，完成双主题、设置页路由、弹窗层级和论坛内容脚本检查后自动关闭。

## 参考项目与致谢

NodeSeek Expansion Tool 是独立维护的非官方浏览器扩展，不隶属于 NodeSeek、DeepFlood 或下列项目。项目开发过程中对不同开源脚本和同类扩展进行了源码改造、功能对照或产品形态参考；三者的关系并不相同。

| 项目 | 许可证 / 来源状态 | 本项目中的参考关系 |
| --- | --- | --- |
| [Nodeseek Max-iSen](https://github.com/EISEN0516/nodeseek-pro-userscript) | GPL-3.0，公开源码 | 页面增强核心的直接派生基础 |
| [Nodeseek Pro](https://greasyfork.org/zh-CN/scripts/567109-nodeseek-pro) | GPL-3.0，GreasyFork 公开源码 | 功能覆盖、设置模型、备份数据与交互能力对照 |
| [NodeSeek Helper](https://chromewebstore.google.com/detail/nodeseek-helper/fljjlmmflicoocnceopdeeibflcohenp) | 商店页面未提供源码仓库或许可证 | 仅参考公开功能定位与浏览器扩展产品形态 |

### Nodeseek Max-iSen

- 上游项目：`EISEN0516/nodeseek-pro-userscript`
- 参考版本：`1.1.21`
- 参考提交：`bb63b57cfa6037bd4225464737007260c6d836a3`
- 许可证：GPL-3.0
- 派生文件：`extension/content/nodeseek-max.js`

本项目以该用户脚本的页面增强模块为主要源码基础，保留了自动签到、楼中楼、连续加载、快捷回复、内容过滤、用户关系、浏览历史、链接净化、图片上传、回帖足迹和抽奖辅助等能力。为适配 Chrome / Edge Manifest V3，项目增加了启动门控、`GM_*` 兼容层、扩展后台通信、本地打包的 Layui 与 highlight.js 资源，并重新设计了扩展设置页和浅色 / 深色双主题界面。

在后续改造中，项目将多图床收敛为 NodeImage，增加可编辑 API Key 配置；将抽奖参与记录、开奖时间多来源识别、中奖者展示和通知状态纳入扩展数据模型；同时加入站内消息监控以及 Telegram Bot、邮件、微信推送、企业微信、钉钉和飞书通知。上游项目名称、版本、许可证与派生关系同时记录在 `THIRD_PARTY_NOTICES.md` 和脚本头部。

### Nodeseek Pro

- 发布平台：GreasyFork
- 作者：Woodll
- 对照版本：`1.0.8`
- 许可证：GPL-3.0

该项目用于核对 NodeSeek / DeepFlood 双站支持以及可视化设置面板的功能覆盖，重点参考了快捷短语分组、连续加载、自动签到、NodeImage 拖拽和粘贴上传、内容过滤、用户关系、访问历史、浅色 / 深色适配、配置导出与恢复等公开功能说明和源码结构。

NodeSeek Expansion Tool 针对浏览器扩展环境重新组织了设置分类、存储边界与页面通信，并兼容导入 GreasyFork `nsx-backup` 数据。项目未照搬其完整脚本：按当前产品需求移除了低等级内容屏蔽、多图床与已下架的 AI 回复入口，并新增独立的通知后台、抽奖记录、通知模板、用户信息导出和扩展权限控制。测试套件中的功能与持久设置覆盖检查用于防止后续升级时遗漏已采用的能力。

### NodeSeek Helper

该项目是 Chrome Web Store 上的 NodeSeek 非官方扩展，公开页面展示了用户标签、内容管理、趋势图、自动传图、签到提醒、阅读导航、快捷评论、快捷短语、抽奖通知和访问历史等产品能力。本项目仅将其公开的扩展定位、功能编排和浏览器原生扩展形态作为对照参考。

Chrome Web Store 页面没有提供可核验的源码仓库或开源许可证，因此 NodeSeek Helper **不作为本项目的源码依赖**；仓库没有包含、反编译或重新分发其扩展文件。若其作者后续公开源码及许可证，可再补充更精确的归属说明。

### 第三方库

- [Layui](https://layui.dev/) `2.10.3`：MIT，打包在 `extension/vendor/layui/`。
- [highlight.js](https://highlightjs.org/) `11.9.0`：BSD-3-Clause，打包在 `extension/vendor/highlight/`。

感谢上述项目作者和社区贡献者公开实现、文档与产品经验。本仓库保留各项目的原始链接并明确区分源码派生、功能对照和产品参考，详细第三方声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。本项目整体采用 GPL-3.0 许可证。
