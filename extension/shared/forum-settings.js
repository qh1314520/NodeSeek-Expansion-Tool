export const LINK_PURIFIER_DEFAULT_RULES = `
# 常见跟踪参数
@utm = utm_source, utm_medium, utm_campaign, utm_content, utm_term
@ad = ad_id, clickid, gclid, fbclid, sc_cid
@affiliate = aff, affiliate, partner, promo, promocode, coupon, subid, affid, aff_id
@track = aid, cid, tid, sid, ref_id, tag, via, from, source, campaign, channel

* >> @utm, @ad
*.youtube.com youtu.be >> si, feature, pp
*.bilibili.com b23.tv >> spm_id_from, from_source, from_spmid, seid, share_source, share_medium, share_plat, share_tag, share_session_id, share_from, bbid, ts, timestamp, unique_k, rt, tdsourcetag, spm, vd_source, trackid
*.amazon.com >> /\/ref=[^\/]+/

# 防止误删有业务含义的参数
~github.com ~gitlab.com ~gitee.com >> ref
~t.me ~telegram.me >> start
`.trim();

export const USER_LABEL_OPTIONS = [
  { key: "level", label: "Lv", default: true },
  { key: "chicken", label: "鸡腿", default: true },
  { key: "join_days", label: "加入", default: true },
  { key: "user_id", label: "ID", default: true },
  { key: "username", label: "用户", default: true },
  { key: "stardust", label: "星尘", default: true },
  { key: "registered_at", label: "注册", default: true },
  { key: "role", label: "角色", default: true },
  { key: "admin", label: "管理", default: false },
  { key: "topics", label: "主题", default: false },
  { key: "comments", label: "评论", default: false },
  { key: "following", label: "关注", default: false },
  { key: "followers", label: "粉丝", default: false },
  { key: "favorites", label: "收藏", default: false },
  { key: "score", label: "评分", default: false },
  { key: "diagnosis", label: "诊断", default: false },
  { key: "followed", label: "已关注", default: false }
];

export const USER_LEVEL_STYLES = [
  { level: 1, color: "#e53935", opacity: 100 },
  { level: 2, color: "#fd6f3a", opacity: 100 },
  { level: 3, color: "#11c87d", opacity: 100 },
  { level: 4, color: "#2d86ff", opacity: 100 },
  { level: 5, color: "#ffb300", opacity: 100 },
  { level: 6, color: "#6f58ff", opacity: 100 }
];

export const FEATURE_GROUPS = [
  {
    title: "阅读体验",
    description: "列表、帖子与内容呈现",
    features: [
      ["帖子连续加载", "自动加载下一页帖子", "loading_post.enabled", true, true],
      ["评论连续加载", "浏览帖子时自动加载后续评论", "loading_comment.enabled", true, true],
      ["楼中楼", "按引用关系整理多层回复", "nested_replies.enabled", true, true],
      ["图片预览", "沉浸查看帖子图片", "image_slide.enabled", true, true],
      ["代码高亮", "增强代码块可读性并提供复制按钮", "code_highlight.enabled", true, true],
      ["深色模式同步", "跟随论坛主题切换代码与组件样式", "dark_mode_sync.enabled", true, true],
      ["时间中文化", "将相对时间转换为中文显示", "time_chinese.enabled", true, true],
      ["平滑滚动", "改善长帖页面的滚动体验", "smooth_scroll.enabled", true, true]
    ]
  },
  {
    title: "回复与编辑",
    description: "评论、格式与上传工具",
    features: [
      ["快捷评论", "快速打开回复编辑器", "quick_comment.enabled", true, true],
      ["快捷短语", "在编辑器工具栏中插入分组短语", "quick_comment.phrases_enabled", true, true],
      ["回复快捷键", "使用 Ctrl + Enter 提交评论", "comment_shortcut.enabled", true, true],
      ["Callout", "在编辑器中插入提示块", "callout.enabled", true, true],
      ["NodeImage 图片上传", "粘贴、拖放或选择图片后上传至 NodeImage", "image_upload.enabled", true, true],
      ["回帖足迹", "在列表标记已回复，并在帖子内导航到本人回复楼层", "comment_footprint.enabled", true, true]
    ]
  },
  {
    title: "内容与用户",
    description: "过滤、关系和快捷入口",
    features: [
      ["关键词过滤", "高亮、折叠或隐藏匹配内容", "block_posts.enabled", true, true],
      ["用户信息", "显示等级、注册天数和扩展资料", "inline_user_info.enabled", true, true],
      ["用户悬浮卡", "查看用户资料与关系操作", "user_card_ext.enabled", true, true],
      ["PM / Telegram", "显示站内私信与 Telegram 快捷入口", "communication_quick_links.enabled", true, true],
      ["邮箱导航", "在论坛导航中显示 Seek 邮箱入口", "email_nav_link.enabled", true, true],
      ["链接净化", "绕过跳转页并清理跟踪参数", "link_purifier.enabled", true, true],
      ["浏览历史", "保存最近查看的帖子", "history.enabled", true, true],
      ["已访问标记", "区分已浏览和未浏览链接", "visited_color.enabled", true, true],
      ["帖子新标签页打开", "点击帖子链接时在新标签页打开", "open_post_in_new_tab.enabled", false, false]
    ]
  },
  {
    title: "自动与辅助",
    description: "抽奖、预加载与站点操作",
    features: [
      ["抽奖助手", "识别抽奖、参与状态和开奖结果", "lottery_reminder.enabled", true, true],
      ["页面预加载", "悬停帖子链接时提前加载", "instant_page.enabled", true, true],
      ["外链直达", "自动跳过论坛外链中转页", "auto_jump_external_links.enabled", true, true],
      ["NodeSeek 自动签到", "在 NodeSeek 登录后执行签到", "sign_in.ns.enabled", true, false],
      ["DeepFlood 自动签到", "在 DeepFlood 登录后执行签到", "sign_in.df.enabled", true, false],
      ["签到提示", "自动签到关闭或过期时显示提醒", "signin_tips.enabled", true, true],
      ["规则兼容模式", "停用签到、自动翻页和后台站内请求", "rules_compliance.enabled", false, false]
    ]
  }
];

export const ADVANCED_SETTING_GROUPS = [
  {
    title: "阅读与外观",
    description: "楼中楼、历史记录和内容颜色",
    fields: [
      { path: "nested_replies.max_depth", label: "最大嵌套层级", type: "number", default: 4, min: 1, max: 8 },
      { path: "nested_replies.collapse_depth", label: "默认折叠层级", type: "number", default: 3, min: 1, max: 8 },
      { path: "history.limit", label: "历史记录上限", type: "number", default: 100, min: 10, max: 1000 },
      { path: "history.days", label: "历史保留天数", type: "number", default: 7, min: 1, max: 365 },
      { path: "callout.style", label: "Callout 风格", type: "select", default: "colorful", options: { colorful: "绚丽", clean: "清新" } },
      { path: "comment_footprint.badge_color_light", label: "首页已回复标签颜色（浅色主题）", type: "color", default: "#16a34a", description: "控制浅色主题下帖子列表中“已回复”标签的文字、边框和浅色背景" },
      { path: "comment_footprint.badge_color_dark", label: "首页已回复标签颜色（深色主题）", type: "color", default: "#86efac", description: "控制深色主题下帖子列表中“已回复”标签的文字、边框和浅色背景" },
      { path: "visited_color.light", label: "浅色主题已访问颜色", type: "color", default: "#afb9c1" },
      { path: "visited_color.dark", label: "深色主题已访问颜色", type: "color", default: "#393f4e" }
    ]
  },
  {
    title: "内容与链接",
    description: "关键词高亮与链接净化规则",
    fields: [
      { path: "block_posts.highlight_color", label: "关键词默认高亮色", type: "color", default: "#fff9c4" },
      { path: "link_purifier.mark_external", label: "标记外部链接", type: "checkbox", default: true },
      { path: "link_purifier.force_blank", label: "外链在新标签页打开", type: "checkbox", default: true },
      { path: "link_purifier.rules", label: "链接净化规则", type: "textarea", default: LINK_PURIFIER_DEFAULT_RULES, rows: 12 }
    ]
  },
  {
    title: "用户与关系",
    description: "楼主、评论、好友与黑名单显示方式",
    fields: [
      { path: "inline_user_info.enabled", label: "启用用户标签", type: "checkbox", default: true },
      { path: "inline_user_info.show_op", label: "楼主信息增强", type: "checkbox", default: true },
      { path: "inline_user_info.show_cmt", label: "评论用户信息增强", type: "checkbox", default: true },
      { path: "inline_user_info.label_size", label: "标签尺寸", type: "select", default: "standard", options: { compact: "紧凑", standard: "标准", large: "宽松" } },
      ...USER_LABEL_OPTIONS.map(option => ({
        path: `inline_user_info.labels.${option.key}`,
        label: option.label,
        type: "checkbox",
        default: option.default
      })),
      ...USER_LEVEL_STYLES.flatMap(style => ([
        { path: `inline_user_info.level_colors.lv${style.level}`, label: `Lv ${style.level} 颜色`, type: "color", default: style.color },
        { path: `inline_user_info.level_opacity.lv${style.level}`, label: `Lv ${style.level} 透明度`, type: "number", default: style.opacity, min: 20, max: 100 }
      ])),
      { path: "inline_user_info.simple_lv_style", label: "简洁等级颜色", type: "checkbox", default: false },
      { path: "inline_user_info.simple_lv_color", label: "简洁等级 CSS 颜色", type: "text", default: "rgba(0, 206, 209, 1)" },
      { path: "communication_quick_links.show_message", label: "显示站内私信入口", type: "checkbox", default: true },
      { path: "communication_quick_links.show_telegram", label: "显示 Telegram 入口", type: "checkbox", default: true },
      { path: "relation.show_friend_btn", label: "显示添加好友按钮", type: "checkbox", default: true },
      { path: "relation.friend_btn_color", label: "好友按钮颜色", type: "color", default: "#00b894" },
      { path: "relation.show_block_btn", label: "显示屏蔽用户按钮", type: "checkbox", default: true },
      { path: "relation.block_btn_color", label: "屏蔽按钮颜色", type: "color", default: "#d63031" },
      { path: "relation.blacklist_enabled", label: "高级黑名单", type: "checkbox", default: true },
      { path: "relation.blacklist_mode", label: "黑名单显示模式", type: "select", default: "fold", options: { fold: "折叠显示", official: "官方屏蔽", mark: "仅标记" } },
      { path: "relation.friends_enabled", label: "本地好友高亮", type: "checkbox", default: true },
      { path: "relation.friends_highlight", label: "好友高亮颜色", type: "color", default: "#ff9800" }
    ]
  },
  {
    title: "自动操作",
    description: "签到与抽奖检测参数",
    fields: [
      { path: "sign_in.ns.method", label: "NodeSeek 签到方式", type: "select", valueType: "number", default: 1, options: { 1: "随机鸡腿", 2: "固定 5 鸡腿" } },
      { path: "sign_in.df.method", label: "DeepFlood 签到方式", type: "select", valueType: "number", default: 1, options: { 1: "随机鸡腿", 2: "固定 5 鸡腿" } },
      { path: "lottery_reminder.auto_detect", label: "自动识别抽奖帖", type: "checkbox", default: true },
      { path: "lottery_reminder.joined_badge_color", label: "首页抽奖已参加标签颜色", type: "color", default: "#16a34a", description: "控制首页“抽奖已参加”标签及帖子内抽奖提醒按钮的颜色" },
      { path: "lottery_reminder.unjoined_badge_color", label: "首页抽奖未参加标签颜色", type: "color", default: "#d97706", description: "控制首页“抽奖未参加”标签及帖子内抽奖提醒按钮的颜色" },
      { path: "lottery_reminder.near_minutes", label: "开奖前提醒（分钟）", type: "number", default: 1, min: 0, max: 1440 },
      { path: "lottery_reminder.check_seconds", label: "抽奖检查间隔（秒）", type: "number", default: 30, min: 5, max: 3600 }
    ]
  }
];

export const UPSTREAM_DISABLED_MODULES = ["aiComment"];
export const UPSTREAM_DISABLED_SETTING_PREFIXES = ["ai_comment."];
export const UPSTREAM_REMOVED_SETTINGS = ["block_view_level.enabled"];
export const FORUM_CONTEXT_ACTION_FIELDS = [
  "comment_footprint.reset_db",
  "comment_footprint.show_stats",
  "link_purifier.edit_rules"
];
