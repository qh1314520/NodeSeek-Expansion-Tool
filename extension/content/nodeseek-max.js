// ==UserScript==
// @name         Nodeseek Max-iSen
// @description  增强 NodeSeek/DeepFlood 论坛体验：楼中楼、抽奖提醒、回帖足迹、链接净化、NodeImage 图片上传、内容过滤、浏览历史及移动端适配。
// @namespace    http://www.nodeseek.com/
// @version      1.1.21
// @homepageURL   https://github.com/EISEN0516/nodeseek-pro-userscript
// @supportURL    https://github.com/EISEN0516/nodeseek-pro-userscript/issues
// @icon          https://raw.githubusercontent.com/EISEN0516/nodeseek-pro-userscript/main/docs/images/nodeseek-max-isen-icon.png
// @updateURL     https://raw.githubusercontent.com/EISEN0516/nodeseek-pro-userscript/main/Nodeseek%20Pro.user.js
// @downloadURL   https://raw.githubusercontent.com/EISEN0516/nodeseek-pro-userscript/main/Nodeseek%20Pro.user.js
// @match        *://www.nodeseek.com/*
// @match        *://nodeseek.com/*
// @match        *://www.deepflood.com/*
// @match        *://deepflood.com/*
// @require      https://s4.zstatic.net/ajax/libs/layui/2.10.3/layui.min.js
// @resource     highlightStyle https://s4.zstatic.net/ajax/libs/highlight.js/11.9.0/styles/atom-one-light.min.css
// @resource     highlightStyle_dark https://s4.zstatic.net/ajax/libs/highlight.js/11.9.0/styles/atom-one-dark.min.css
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_notification
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_getResourceURL
// @grant        GM_addElement
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_xmlhttpRequest
// @grant        GM_info
// @grant        unsafeWindow
// @connect      api.telegram.org
// @connect      api.nodeimage.com
// @connect      api.mailgun.net
// @connect      api.resend.com
// @connect      api.sendgrid.com
// @connect      api.emailjs.com
// @connect      sctapi.ftqq.com
// @connect      sc.ftqq.com
// @connect      www.pushplus.plus
// @connect      oapi.dingtalk.com
// @connect      open.feishu.cn
// @connect      qyapi.weixin.qq.com
// @run-at       document-idle
// @noframes
// @license      GPL-3.0
// ==/UserScript==
(function () {
    'use strict';

    // NSX Core - 核心
    // 环境 + DOM + 网络 + 存储 + 模块管理

    const SITES = [
        { host: "www.nodeseek.com", code: "ns", name: "NodeSeek" },
        { host: "www.deepflood.com", code: "df", name: "DeepFlood" }
    ];

    const info = GM_info?.script || {};
    const normalizedHost = location.hostname.replace(/^www\./i, "").toLowerCase();
    const site = SITES.find(s => s.host.replace(/^www\./i, "").toLowerCase() === normalizedHost);
    let debug = false;
    try { debug = GM_getValue("settings", {})?.debug?.enabled; } catch { }

    // ===== 环境 =====
    const env = {
        info, site, BASE_URL: location.origin,
        log: (...a) => debug && console.log(`[NSX]`, ...a),
        warn: (...a) => debug && console.warn(`[NSX]`, ...a),
        error: (...a) => console.error(`[NSX]`, ...a)
    };

    // ===== DOM =====
    const $ = (s, r = document) => r?.querySelector(s);
    const $$ = (s, r = document) => [...(r?.querySelectorAll(s) || [])];

    function ensureIconGroup() {
        const head = document.querySelector('#nsk-head');
        if (!head) return null;

        const anchor = head.querySelector('.color-theme-switcher');
        const parent = head;

        let grp = document.getElementById('nsx-icon-group');
        if (!grp || grp.tagName !== 'DIV') {
            const old = grp;
            grp = document.createElement('div');
            grp.id = 'nsx-icon-group';
            grp.className = 'right-button-group';
            old?.replaceWith(grp);
        } else if (!grp.className) {
            grp.className = 'right-button-group';
        }

        const target = anchor && anchor.parentElement === parent ? anchor : null;
        if (target) {
            const alreadyInPlace = grp.parentElement === parent && grp.nextSibling === target;
            if (!alreadyInPlace) parent.insertBefore(grp, target);
        } else {
            const searchBox = head.querySelector('.search-box');
            if (searchBox && searchBox.parentElement === parent) {
                const alreadyInPlace = grp.parentElement === parent && grp.nextSibling === searchBox;
                if (!alreadyInPlace) parent.insertBefore(grp, searchBox);
            } else {
                const alreadyInPlace = grp.parentElement === parent && grp === parent.lastElementChild;
                if (!alreadyInPlace) parent.appendChild(grp);
            }
        }
        return grp;
    }

    function addStyle(id, val) {
        if (document.getElementById(id)) return;
        const isUrl = /^(https?:)?\/\//.test(val);
        const el = document.createElement(isUrl ? "link" : "style");
        el.id = id;
        isUrl ? (el.rel = "stylesheet", el.href = val) : (el.textContent = val);
        document.head?.appendChild(el);
    }

    const normalizeStatusColor = (value, fallback) => {
        const color = String(value || "").trim();
        return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
    };

    const closeOtherPanels = activePanel => {
        const controls = window.__nsxPanelCtrl || {};
        Object.entries(controls).forEach(([name, controller]) => {
            if (name !== activePanel) controller?.close?.();
        });
    };

    function addScript(id, val) {
        if (document.getElementById(id)) return;
        const el = document.createElement("script");
        el.id = id;
        /^(https?:)?\/\//.test(val) ? (el.src = val) : (el.textContent = val);
        document.body?.appendChild(el);
    }

    const debounce = (fn, ms) => {
        let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
        d.cancel = () => clearTimeout(t); return d;
    };

    const throttle = (fn, ms) => {
        let last = 0;
        return (...a) => { const now = Date.now(); if (now - last >= ms) { last = now; fn(...a); } };
    };

    // ===== 存储 =====
    const cfgFragments = new Map(), metaFragments = new Map();
    let cfgCache = null;

    const isObj = v => v && typeof v === "object" && !Array.isArray(v);
    const merge = (t, s) => { for (const k in s) isObj(s[k]) ? (isObj(t[k]) || (t[k] = {}), merge(t[k], s[k])) : t[k] === undefined && (t[k] = s[k]); };
    const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
    const setPath = (o, p, v) => { const ks = p.split("."), l = ks.pop(); ks.reduce((a, k) => a[k] ??= {}, o)[l] = v; };

    const store = {
        reg(id, cfg, meta) { cfg && cfgFragments.set(id, cfg); meta && metaFragments.set(id, meta); },
        getDefaults() { const d = { version: info.version, debug: { enabled: false } }; cfgFragments.forEach(f => merge(d, f)); return d; },
        getMeta() { const m = {}; metaFragments.forEach(f => merge(m, f)); return m; },
        init() {
            if (cfgCache) return cfgCache;
            const def = this.getDefaults();
            cfgCache = GM_getValue("settings", null) || {};
            const footprint = cfgCache.comment_footprint;
            if (isObj(footprint) && footprint.badge_color !== undefined) {
                footprint.badge_color_light ??= footprint.badge_color;
                footprint.badge_color_dark ??= String(footprint.badge_color).toLowerCase() === "#16a34a" ? "#86efac" : footprint.badge_color;
                delete footprint.badge_color;
            }
            const lottery = cfgCache.lottery_reminder;
            if (isObj(lottery) && lottery.badge_color !== undefined) {
                lottery.joined_badge_color ??= "#16a34a";
                lottery.unjoined_badge_color ??= lottery.badge_color;
                delete lottery.badge_color;
            }
            merge(cfgCache, def);
            cfgCache.version = def.version;
            GM_setValue("settings", cfgCache);
            return cfgCache;
        },
        get(p, fb) { const v = getPath(this.init(), p); return v === undefined ? fb : v; },
        set(p, v) { setPath(this.init(), p, v); GM_setValue("settings", cfgCache); },
        replace(settings) {
            cfgCache = isObj(settings) ? structuredClone(settings) : {};
            const footprint = cfgCache.comment_footprint;
            if (isObj(footprint) && footprint.badge_color !== undefined) {
                footprint.badge_color_light ??= footprint.badge_color;
                footprint.badge_color_dark ??= String(footprint.badge_color).toLowerCase() === "#16a34a" ? "#86efac" : footprint.badge_color;
                delete footprint.badge_color;
            }
            const lottery = cfgCache.lottery_reminder;
            if (isObj(lottery) && lottery.badge_color !== undefined) {
                lottery.joined_badge_color ??= "#16a34a";
                lottery.unjoined_badge_color ??= lottery.badge_color;
                delete lottery.badge_color;
            }
            const def = this.getDefaults();
            merge(cfgCache, def);
            cfgCache.version = def.version;
            return cfgCache;
        }
    };

    // ===== 网络 =====
    const net = {
        async fetch(url, { method = "GET", data, headers = {}, type = "json" } = {}) {
            const r = await fetch(url.startsWith("http") ? url : env.BASE_URL + url, {
                method, credentials: "include",
                headers: { ...(data ? { "Content-Type": "application/json" } : {}), ...headers },
                body: data ? JSON.stringify(data) : undefined
            });
            return r[type]().catch(() => null);
        },
        get: (u, h, t) => net.fetch(u, { headers: h, type: t }),
        post: (u, d, h, t) => net.fetch(u, { method: "POST", data: d, headers: h, type: t })
    };

    // ===== 模块管理 =====
    const modules = new Map();

    function define(cfg) {
        if (!cfg?.id) throw new Error("id required");
        cfg.deps ??= [];
        cfg.order ??= 100;
        modules.set(cfg.id, cfg);
        cfg.cfg && store.reg(cfg.id, cfg.cfg, cfg.meta);
        return cfg;
    }

    function boot(ctx) {
        store.init();
        // 拓扑排序
        const list = [...modules.values()];
        const indeg = new Map(list.map(m => [m.id, 0]));
        const edges = new Map(list.map(m => [m.id, []]));
        list.forEach(m => m.deps.forEach(d => { if (modules.has(d)) { edges.get(d).push(m.id); indeg.set(m.id, indeg.get(m.id) + 1); } }));
        const q = list.filter(m => indeg.get(m.id) === 0).sort((a, b) => a.order - b.order);
        const sorted = [];
        while (q.length) {
            const cur = q.shift(); sorted.push(cur);
            edges.get(cur.id).forEach(n => { indeg.set(n, indeg.get(n) - 1); if (!indeg.get(n)) q.push(modules.get(n)); });
            q.sort((a, b) => a.order - b.order);
        }
        // 初始化和监听
        sorted.forEach(m => {
            const matched = typeof m.match === "function" ? Boolean(m.match(ctx)) : true;
            if (matched) {
                try { m.init?.(ctx); } catch (e) { env.error(m.id, e); }
                if (ctx.watch) {
                    const w = typeof m.watch === "function" ? m.watch(ctx) : m.watch;
                    [].concat(w || []).filter(Boolean).forEach(i => ctx.watch(i.sel, i.fn, i.opts));
                }
            }
        });
    }

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 自动跳转外部链接
       ========================================================================== */
    const autoJump = {
        id: "autoJump",
        order: 210,
        cfg: { auto_jump_external_links: { enabled: true } },
        meta: { auto_jump_external_links: { label: "自动跳转外部链接", group: "🧭 辅助工具" } },
        match: ctx => ctx.store.get("auto_jump_external_links.enabled", true),
        init(ctx) {
            $$('a[href*="/jump?to="]').forEach(a => {
                try {
                    const to = new URL(a.href).searchParams.get("to");
                    if (to) a.href = decodeURIComponent(to);
                } catch { }
            });
            if (/^\/jump/.test(location.pathname)) ctx.$(".btn")?.click();
        }
    };

    const __vite_glob_0_0 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: autoJump
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 下拉加载 / 自动翻页 (Infinite Scroll)
       ========================================================================== */

    const PROFILES = {
        list: { path: /^\/(categories\/|page|award|search|$)/, threshold: 1500, next: ".nsk-pager a.pager-next", list: "ul.post-list:not(.topic-carousel-panel)", pagerTop: "div.nsk-pager.pager-top", pagerBot: "div.nsk-pager.pager-bottom" },
        post: { path: /^\/post-/, threshold: 690, next: ".nsk-pager a.pager-next", list: "ul.comments", pagerTop: "div.nsk-pager.post-top-pager", pagerBot: "div.nsk-pager.post-bottom-pager" }
    };

    const autoLoading = {
        id: "autoLoading",
        order: 220,
        cfg: { loading_post: { enabled: true }, loading_comment: { enabled: true } },
        meta: {
            loading_post: { label: "自动加载下一页(帖子)", group: "🧭 辅助工具" },
            loading_comment: { label: "自动加载下一页(评论)", group: "🧭 辅助工具" }
        },
        match: ctx => (ctx.isList || ctx.isPost) && !ctx.store.get("rules_compliance.enabled", true),
        init(ctx) {
            const profile = ctx.isList ? PROFILES.list : ctx.isPost ? PROFILES.post : null;
            if (!profile) return;

            const cfgKey = ctx.isList ? "loading_post.enabled" : "loading_comment.enabled";
            let isEnabled = ctx.store.get(cfgKey, true);

            // 注入快捷开关按钮：纯净创造节点，以原生的 class 和 CSS 层叠逻辑定位
            const navGroup = ctx.$("#fast-nav-button-group");
            if (navGroup) {
                const btn = document.createElement("a");
                btn.className = "nav-item-btn";
                btn.id = "nsx-toggle-autoload";
                btn.href = "javascript:void(0);";

                const updateBtn = () => {
                    // 开启时：绿色向下加载流水线； 关闭时：鲜红色带禁止图标
                    if (isEnabled) {
                        btn.title = "瀑布流自动加载：已开启 (点击休眠)";
                        btn.innerHTML = `<svg viewBox="0 0 48 48" fill="none" class="iconpark-icon" style="width:24px;height:24px;color:#4caf50;"><path d="M24 10V38M12 26L24 38L36 26" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                    } else {
                        btn.title = "瀑布流自动加载：已休眠 (点击开启)";
                        btn.innerHTML = `<svg viewBox="0 0 48 48" fill="none" class="iconpark-icon" style="width:24px;height:24px;color:#f44336;"><path d="M24 10V38M12 26L24 38L36 26" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 8L40 40" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                    }
                };
                updateBtn();

                btn.onclick = (e) => {
                    e.preventDefault();
                    isEnabled = !isEnabled;
                    ctx.store.set(cfgKey, isEnabled);
                    updateBtn();
                    ctx.ui?.toast?.(isEnabled ? "✅ 瀑布流向下加载已开启" : "❌ 瀑布流加载已停用");
                };

                // 置于结构序列的第一位，由扩展的 nth-last-child CSS 接管精准定位！
                navGroup.prepend(btn);
            }

            let busy = false, prevY = scrollY;

            const showHoverCard = (anchor, uid) => {
                const hoverCard = ctx.uw?.hoverCard;
                if (!hoverCard || !Number.isFinite(Number(uid))) return;
                if (!hoverCard.$el || !document.body.contains(hoverCard.$el)) {
                    hoverCard.setIsHoverCard?.(true);
                    hoverCard.$mount?.(document.body.appendChild(document.createElement("div")));
                }
                const { left, top } = anchor.getBoundingClientRect();
                Object.assign(hoverCard, { left, top });
                hoverCard.loadUser?.(Number(uid));
                hoverCard.show?.();
            };
            const bindAppendedAvatars = (doc, pageConfig) => {
                if (ctx.isList) {
                    doc.querySelectorAll(".post-list .avatar-normal[data-uid]").forEach(avatar => {
                        const uid = Number(avatar.dataset.uid);
                        if (!Number.isFinite(uid)) return;
                        avatar.addEventListener("click", event => {
                            event.preventDefault();
                            showHoverCard(avatar, uid);
                        });
                    });
                    return;
                }
                const comments = pageConfig?.postData?.comments;
                if (!Array.isArray(comments)) return;
                doc.querySelectorAll(".content-item").forEach((item, index) => {
                    const uid = Number(comments[index]?.poster?.uid);
                    const avatar = item.querySelector(".avatar-normal");
                    if (!avatar || !Number.isFinite(uid)) return;
                    avatar.addEventListener("click", event => {
                        event.preventDefault();
                        showHoverCard(avatar, uid);
                    });
                });
            };
            const processCommentMenus = (commentElements) => {
                if (!ctx.isPost || !commentElements?.length) return;
                const existingMenu = document.querySelector(".comment-menu");
                const vue = existingMenu?.__vue__;
                if (!vue?.$root?.constructor || !vue?.$options) return;
                const startIndex = document.querySelectorAll(".content-item").length - commentElements.length;
                commentElements.forEach((comment, index) => {
                    const menuMount = document.createElement("div");
                    menuMount.className = "comment-menu-mount";
                    comment.appendChild(menuMount);
                    try {
                        const menuInstance = new vue.$root.constructor(vue.$options);
                        if (typeof menuInstance.setIndex === "function") menuInstance.setIndex(startIndex + index);
                        if (typeof menuInstance.$mount === "function") menuInstance.$mount(menuMount);
                    } catch { }
                });
            };

            const load = async () => {
                if (!isEnabled || busy) return;
                const atBottom = document.documentElement.scrollHeight <= innerHeight + scrollY + profile.threshold;
                if (!atBottom) return;
                const nextUrl = ctx.$(profile.next)?.href;
                if (!nextUrl) return;

                busy = true;
                try {
                    const html = await net.get(nextUrl, {}, "text");
                    const doc = new DOMParser().parseFromString(html, "text/html");
                    let pageConfig = null;

                    // 评论数据同步
                    if (ctx.isPost) {
                        const json = doc.getElementById("temp-script")?.textContent;
                        if (json) try {
                            pageConfig = JSON.parse(decodeURIComponent(atob(json).split("").map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")));
                            if (pageConfig?.postData?.comments) ctx.uw.__config__.postData.comments.push(...pageConfig.postData.comments);
                        } catch { }
                    }
                    bindAppendedAvatars(doc, pageConfig);

                    const src = doc.querySelector(profile.list), dst = document.querySelector(profile.list);
                    if (src && dst) {
                        const appended = Array.from(src.children);
                        dst.append(...appended);
                        processCommentMenus(appended);
                    }

                    [profile.pagerTop, profile.pagerBot].forEach(sel => {
                        const s = doc.querySelector(sel), d = document.querySelector(sel);
                        if (s && d) d.innerHTML = s.innerHTML;
                    });

                    history.pushState(null, null, nextUrl);
                } catch (e) { ctx.env.error("autoLoading", e); }
                busy = false;
            };

            const deb = debounce(load, 300);
            addEventListener("scroll", throttle(() => { if (scrollY > prevY) deb(); prevY = scrollY; }, 200), { passive: true });

            document.addEventListener('click', e => {
                const a = e.target.closest('a');
                if (a && (a.classList.contains('pager-pos') || a.classList.contains('pager-prev') || a.classList.contains('pager-next') || a.closest('.nsk-pager'))) {
                    a.target = '_self';
                    e.stopImmediatePropagation();
                }
            }, true);
        }
    };

    const __vite_glob_0_1 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: autoLoading
    }, Symbol.toStringTag, { value: 'Module' }));


    /* ==========================================================================
       [ 🚫 过滤设置 ] - 关键字过滤 (帖子屏蔽)
       ========================================================================== */



    const blockPosts = {
        id: "blockPosts",
        order: 380,
        cfg: { block_posts: { enabled: true, highlight_color: "#fff9c4" } },
        meta: {
            block_posts: {
                label: "关键字管理", group: "🚫 过滤设置",
                fields: {
                    highlight_color: { type: "COLOR", label: "默认高亮色" }
                }
            }
        },
        match: ctx => ctx.isList || ctx.isPost,
        init(ctx) {
            const keywordsKey = 'nsx_advanced_keywords';
            const groupsKey = 'nsx_content_rule_groups';
            const getMap = () => { try { return JSON.parse(localStorage.getItem(keywordsKey) || '{}'); } catch { return {}; } };
            const getGroups = () => {
                try {
                    const groups = JSON.parse(localStorage.getItem(groupsKey) || '{}')?.keywords;
                    return new Map((Array.isArray(groups) ? groups : []).map(group => [String(group?.id || ''), group || {}]));
                } catch { return new Map(); }
            };
            const saveMap = (map) => localStorage.setItem(keywordsKey, JSON.stringify(map));

            const runFilter = (els) => {
                if (!ctx.store.get("block_posts.enabled", true)) return;
                const kws = getMap();
                const groups = getGroups();
                const kwEntries = Object.entries(kws).filter(([, info]) => info?.enabled !== false && (!info?.group || groups.get(String(info.group))?.enabled !== false));
                if (!kwEntries.length) return;
                const hColor = ctx.store.get("block_posts.highlight_color", "#fff9c4");

                els.forEach(item => {
                    if (item.dataset.nsxKwProcessed) return;
                    const titleEl = item.querySelector(".post-title>a");
                    const title = titleEl?.textContent?.toLowerCase() || "";
                    if (!title) return;

                    let matchedColors = [];
                    let shouldHide = false;
                    let foldWords = [];

                    for (const [word, info] of kwEntries) {
                        const groupWords = String(word || "").split(/[，,]/).map(s => s.trim().toLowerCase()).filter(Boolean);
                        if (!groupWords.length) continue;
                        const hit = groupWords.some(w => title.includes(w));
                        if (!hit) continue;

                        if (info.type === 'highlight') {
                            matchedColors.push(groups.get(String(info.group || ''))?.color || info.color || "#fff9c4");
                        } else if (info.type === 'block') {
                            if (info.mode === 'hide') {
                                shouldHide = true;
                                break;
                            } else {
                                foldWords.push(word);
                            }
                        }
                    }

                    if (shouldHide) {
                        item.style.display = 'none';
                    } else if (foldWords.length > 0) {
                        item.classList.add('nsx-post-folded');
                        if (!item.querySelector('.nsx-fold-notice')) {
                            const notice = document.createElement('div');
                            notice.className = 'nsx-fold-notice';
                            notice.style.padding = '10px 15px';
                            const kwText = foldWords.map(w => w.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])).join(', ');
                            notice.innerHTML = `<span>已折叠包含关键词 [<b>${kwText}</b>] 的主题</span><span class="nsx-unfold-btn" style="text-decoration:underline;cursor:pointer">点此查看</span>`;
                            notice.querySelector('.nsx-unfold-btn').onclick = () => { item.classList.remove('nsx-post-folded'); notice.style.display = 'none'; };
                            item.prepend(notice);
                        }
                    } else if (matchedColors.length > 0) {
                        item.style.transition = "background-color 0.3s, background 0.3s";
                        if (matchedColors.length === 1) {
                            item.style.backgroundColor = matchedColors[0];
                        } else {
                            // 多个关键字冲突：使用线性渐变色
                            const uniqueColors = [...new Set(matchedColors)];
                            if (uniqueColors.length === 1) {
                                item.style.backgroundColor = uniqueColors[0];
                            } else {
                                item.style.background = `linear-gradient(90deg, ${uniqueColors.join(', ')})`;
                            }
                        }
                    }

                    if (shouldHide || foldWords.length > 0 || matchedColors.length > 0) {
                        item.dataset.nsxKwProcessed = "1";
                    }
                });
            };

            const reapplyKeywords = () => {
                const all = $$(".post-list-item");
                all.forEach(item => {
                    delete item.dataset.nsxKwProcessed;
                    item.style.display = "";
                    item.style.backgroundColor = "";
                    item.style.background = "";
                    item.style.transition = "";
                    item.classList.remove("nsx-post-folded");
                    item.querySelectorAll(".nsx-fold-notice").forEach(n => n.remove());
                });
                if (ctx.store.get("block_posts.enabled", true)) runFilter(all);
            };

            runFilter($$(".post-list-item"));
            ctx.watch(".post-list-item", els => runFilter(els), { debounce: 150 });
            window.__nsxRuntime ||= {};
            window.__nsxRuntime.reapplyKeywords = reapplyKeywords;
            document.addEventListener("NSPRO_FORUM_DATA_CHANGED", event => {
                try {
                    const keys = JSON.parse(event.detail || "{}").keys || [];
                    if (keys.includes(keywordsKey) || keys.includes(groupsKey)) reapplyKeywords();
                } catch { }
            });

            // --- 独立的关键字面板逻辑 ---
            let kwPanel = null, kwTrigger = null, pState = { open: false, kw: "", tab: "block" };
            const head = ctx.$("#nsk-head");
            if (head) {
                const grp = ensureIconGroup();
                if (!grp) return;
                kwTrigger = document.createElement("div");
                kwTrigger.className = "filter-dropdown-on";
                kwTrigger.style.cssText = "";
                kwTrigger.innerHTML = `<svg viewBox="0 0 48 48" fill="none" style="width:17px;height:17px;color:currentColor;"><path d="M6 9L20.4 25.8178V38.4444L27.6 42V25.8178L42 9H6Z" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/></svg>`;
                kwTrigger.title = "关键字过滤管理";
                grp.appendChild(kwTrigger);

                const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

                const renderList = () => {
                    const map = getMap();
                    let list = Object.entries(map).map(([k, v]) => ({ word: k, ...v }));
                    if (pState.kw) list = list.filter(i => i.word.toLowerCase().includes(pState.kw));
                    list = list.filter(i => (pState.tab === 'highlight' ? i.type === 'highlight' : i.type !== 'highlight'));
                    list.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

                    kwPanel.querySelectorAll('.nsx-rel-tab').forEach(b => b.classList.toggle('is-active', b.dataset.t === pState.tab));
                    const lEl = kwPanel.querySelector(".nsx-rel-list");
                    if (!list.length) { lEl.innerHTML = `<div class="nsx-rel-empty">当前分组没有关键字</div>`; return; }

                    lEl.innerHTML = list.map(i => {
                        return `<div class="nsx-rel-item">
                            <div class="nsx-rel-link">
                                <div class="nsx-rel-info">
                                    <span class="nsx-rel-item-title" data-un="${esc(i.word)}">${esc(i.word)}</span>
                                    <span class="nsx-rel-remark" data-un="${esc(i.word)}">${i.type === 'highlight' ? '高亮 (颜色: ' + (i.color || "默认") + ')' : (i.mode === 'hide' ? '彻底隐藏' : '折叠展示')}（双击编辑）</span>
                                </div>
                            </div>
                            <span class="nsx-rel-time">${i.time ? i.time.split(' ')[0] : ''}</span>
                            <button class="nsx-rel-close" data-a="del" data-un="${esc(i.word)}">移除</button>
                        </div>`;
                    }).join("");
                };

                const openPanel = () => {
                    closeOtherPanels("filter");
                    if (!kwPanel) {
                        kwPanel = document.createElement("div"); kwPanel.id = "nsx-filter-panel";
                        kwPanel.innerHTML = `
                                <div class="nsx-rel-header"><div class="nsx-rel-title">关键字过滤</div><div style="display:flex;gap:8px;"><button class="nsx-rel-action" data-a="add">新增</button><button class="nsx-rel-action" data-a="clear">清空当前组</button></div></div>
                                <div class="nsx-rel-search"><input placeholder="搜索关键字与配置..."/></div>
                                <div class="nsx-rel-tabs"><button class="nsx-rel-tab is-active" data-t="block">屏蔽</button><button class="nsx-rel-tab" data-t="highlight">高亮</button></div>
                                <div class="nsx-rel-list"></div>
                            `;
                        document.body.appendChild(kwPanel);

                        kwPanel.querySelector("input").oninput = e => { pState.kw = e.target.value.toLowerCase(); renderList(); };
                        kwPanel.onclick = e => {
                            e.stopPropagation();
                            const t = e.target.closest('[data-t]');
                            if (t) { pState.tab = t.dataset.t; renderList(); return; }
                            const a = e.target.closest("[data-a]"); if (!a) return;
                            const act = a.dataset.a, un = a.dataset.un;

                            if (act === "clear") {
                                ctx.ui.confirm("清空列表?", `确定要删除当前分组（${pState.tab === 'highlight' ? '高亮' : '屏蔽'}）的关键字吗？`, () => {
                                    const map = getMap();
                                    Object.keys(map).forEach(k => {
                                        const it = map[k] || {};
                                        const isHighlight = it.type === 'highlight';
                                        if ((pState.tab === 'highlight' && isHighlight) || (pState.tab === 'block' && !isHighlight)) delete map[k];
                                    });
                                    saveMap(map); reapplyKeywords(); renderList(); ctx.ui.toast("已清空");
                                });
                            }
                            if (act === "del") {
                                const map = getMap(); delete map[un]; saveMap(map); reapplyKeywords(); renderList(); ctx.ui.toast("已移除");
                            }
                            if (act === "add") {
                                const html = `
                                        <style>
                                            .nsx-kw-form .layui-form-label{width:76px;padding-left:0}
                                            .nsx-kw-form .layui-input-block{margin-left:96px}
                                            .nsx-mobile .nsx-kw-form .layui-form-label{width:auto;float:none;text-align:left;padding:0 0 4px}
                                            .nsx-mobile .nsx-kw-form .layui-input-block{margin-left:0}
                                        </style>
                                        <div class="layui-form nsx-kw-form" style="padding:20px 20px 0;">
                                            <div class="layui-form-item"><label class="layui-form-label">关键字</label><div class="layui-input-block"><input type="text" id="nkw-v" class="layui-input" placeholder="输入词语（可用 , 分隔，同一组）"></div></div>
                                            <div class="layui-form-item"><label class="layui-form-label">类型</label><div class="layui-input-block"><select id="nkw-t" lay-filter="nkw-t-filter"><option value="block" ${pState.tab === 'block' ? 'selected' : ''}>屏蔽</option><option value="highlight" ${pState.tab === 'highlight' ? 'selected' : ''}>高亮</option></select></div></div>
                                            <div class="layui-form-item" id="nkw-m-box"><label class="layui-form-label">模式</label><div class="layui-input-block"><select id="nkw-m"><option value="fold">优雅折叠</option><option value="hide">彻底隐藏</option></select></div></div>
                                            <div class="layui-form-item" id="nkw-c-box" style="display:none;"><label class="layui-form-label">高亮颜色</label><div class="layui-input-block">
                                                <div id="nkw-color-picker"></div>
                                                <input type="hidden" id="nkw-c-val" value="#fff9c4">
                                            </div></div>
                                        </div>
                                    `;
                                ctx.ui.layer.open({
                                    title: '新增关键字', content: html, area: ['min(520px,94vw)', 'auto'], btn: ['添加', '取消'],
                                    success: (l) => {
                                        layui.use(['form', 'colorpicker'], function () {
                                            const form = layui.form;
                                            form.render('select');

                                            const syncTypeUI = (val) => {
                                                const isH = val === 'highlight';
                                                l.find('#nkw-m-box').toggle(!isH);
                                                l.find('#nkw-c-box').toggle(isH);
                                            };

                                            form.on('select(nkw-t-filter)', function (data) {
                                                syncTypeUI(data.value);
                                            });

                                            // 首次打开时根据默认选中项立即同步显示区域
                                            syncTypeUI(l.find('#nkw-t').val());

                                            layui.colorpicker.render({
                                                elem: '#nkw-color-picker',
                                                color: '#fff9c4',
                                                predefine: true,
                                                alpha: true,
                                                done: function (color) { l.find('#nkw-c-val').val(color); }
                                            });
                                        });
                                    },
                                    yes: (idx, l) => {
                                        const w = l.find('#nkw-v').val().trim();
                                        if (!w) return;
                                        const map = getMap();
                                        const type = l.find('#nkw-t').val();
                                        map[w] = {
                                            type,
                                            mode: type === 'block' ? l.find('#nkw-m').val() : null,
                                            color: type === 'highlight' ? l.find('#nkw-c-val').val() : null,
                                            time: new Date().toLocaleString()
                                        };
                                        saveMap(map); reapplyKeywords(); ctx.ui.layer.close(idx); renderList(); ctx.ui.toast("已添加");
                                    }
                                });
                            }
                        };
                        kwPanel.ondblclick = (e) => {
                            const target = e.target.closest('.nsx-rel-item-title,.nsx-rel-remark');
                            if (!target) return;
                            e.preventDefault();
                            e.stopPropagation();
                            const un = target.dataset.un;
                            const map = getMap();
                            const info = map[un];
                            if (!info) return;

                            const html = `
                                <style>
                                    .nsx-kw-form .layui-form-label{width:76px;padding-left:0}
                                    .nsx-kw-form .layui-input-block{margin-left:96px}
                                    .nsx-mobile .nsx-kw-form .layui-form-label{width:auto;float:none;text-align:left;padding:0 0 4px}
                                    .nsx-mobile .nsx-kw-form .layui-input-block{margin-left:0}
                                </style>
                                <div class="layui-form nsx-kw-form" style="padding:20px 20px 0;">
                                    <div class="layui-form-item"><label class="layui-form-label">关键字</label><div class="layui-input-block"><input type="text" id="nkw-e-v" class="layui-input" value="${esc(un)}" placeholder="可用 , 分隔，作为同一组"></div></div>
                                    <div class="layui-form-item"><label class="layui-form-label">类型</label><div class="layui-input-block"><select id="nkw-e-t" lay-filter="nkw-e-t-filter"><option value="block" ${info.type === 'highlight' ? '' : 'selected'}>屏蔽</option><option value="highlight" ${info.type === 'highlight' ? 'selected' : ''}>高亮</option></select></div></div>
                                    <div class="layui-form-item" id="nkw-e-m-box" style="${info.type === 'highlight' ? 'display:none;' : ''}"><label class="layui-form-label">模式</label><div class="layui-input-block"><select id="nkw-e-m"><option value="fold" ${info.mode === 'hide' ? '' : 'selected'}>优雅折叠</option><option value="hide" ${info.mode === 'hide' ? 'selected' : ''}>彻底隐藏</option></select></div></div>
                                    <div class="layui-form-item" id="nkw-e-c-box" style="${info.type === 'highlight' ? '' : 'display:none;'}"><label class="layui-form-label">高亮颜色</label><div class="layui-input-block"><div id="nkw-e-color-picker"></div><input type="hidden" id="nkw-e-c-val" value="${esc(info.color || '#fff9c4')}"></div></div>
                                </div>`;
                            ctx.ui.layer.open({
                                title: '编辑关键字', content: html, area: ['min(520px,94vw)', 'auto'], btn: ['保存', '取消'],
                                success: (l) => {
                                    layui.use(['form', 'colorpicker'], function () {
                                        const form = layui.form;
                                        form.render('select');
                                        form.on('select(nkw-e-t-filter)', function (data) {
                                            const isH = data.value === 'highlight';
                                            l.find('#nkw-e-m-box').toggle(!isH);
                                            l.find('#nkw-e-c-box').toggle(isH);
                                        });
                                        layui.colorpicker.render({ elem: '#nkw-e-color-picker', color: info.color || '#fff9c4', predefine: true, alpha: true, done: color => l.find('#nkw-e-c-val').val(color) });
                                    });
                                },
                                yes: (idx, l) => {
                                    const nw = l.find('#nkw-e-v').val().trim();
                                    if (!nw) return;
                                    const type = l.find('#nkw-e-t').val();
                                    delete map[un];
                                    map[nw] = { type, mode: type === 'block' ? l.find('#nkw-e-m').val() : null, color: type === 'highlight' ? l.find('#nkw-e-c-val').val() : null, time: new Date().toLocaleString() };
                                    saveMap(map); reapplyKeywords(); ctx.ui.layer.close(idx); renderList(); ctx.ui.toast('已更新');
                                }
                            });
                        };
                        document.addEventListener("click", e => {
                            const inLayer = !!e.target.closest('.layui-layer,.layui-layer-page,.layui-layer-dialog,.layui-colorpicker');
                            if (inLayer) return;
                            const hasTopLayer = !!document.querySelector('.layui-layer[style*="z-index"]');
                            if (hasTopLayer) return;
                            if (pState.open && !kwPanel.contains(e.target) && !kwTrigger.contains(e.target)) closePanel();
                        });
                    }
                    const r = kwTrigger.getBoundingClientRect();
                    kwPanel.style.top = `${r.bottom + 8}px`;
                    kwPanel.style.height = `${innerHeight - r.bottom - 16}px`;
                    kwPanel.style.right = ``;
                    renderList(); kwPanel.classList.add("show"); pState.open = true;
                };
                const closePanel = () => { kwPanel?.classList.remove("show"); pState.open = false; };
                window.__nsxPanelCtrl ||= {};
                window.__nsxPanelCtrl.filter = { close: closePanel, isOpen: () => pState.open };
                kwTrigger.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    pState.open ? closePanel() : openPanel();
                };
            }
        }
    };

    const __vite_glob_0_3 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: blockPosts
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🎨 视觉美化 ] - Callout 语法支持 (引述增强)
       ========================================================================== */

    const CSS_BASE = `.post-content blockquote{border-left:none;border-radius:4px;margin:1em 0;box-shadow:inset 4px 0 0 0 rgba(0,0,0,.1)}.callout{--c:8,109,221;overflow:hidden;border-radius:4px;margin:1em 0;padding:12px 12px 12px 24px!important;box-shadow:inset 4px 0 0 0 rgba(var(--c),.5)}.callout.is-collapsible .callout-title{cursor:pointer}.callout-title{display:flex;gap:4px;color:rgb(var(--c));line-height:1.3;align-items:flex-start}.callout-content{overflow-x:auto}.callout-icon{flex:0 0 auto;display:flex;align-items:center}.callout-icon .svg-icon,.callout-fold .svg-icon{color:rgb(var(--c));height:18px;width:18px}.callout-title-inner{font-weight:600}.callout-fold{display:flex;align-items:center;padding-inline-end:8px}.callout-fold .svg-icon{transition:transform .1s}.callout-fold.is-collapsed .svg-icon{transform:rotate(-90deg)}.callout.is-collapsed .callout-content{display:none}.callout[data-callout="abstract"],.callout[data-callout="summary"],.callout[data-callout="tldr"]{--c:83,223,221}.callout[data-callout="info"],.callout[data-callout="todo"]{--c:8,109,221}.callout[data-callout="tip"],.callout[data-callout="hint"],.callout[data-callout="important"]{--c:83,223,221}.callout[data-callout="success"],.callout[data-callout="check"],.callout[data-callout="done"]{--c:68,207,110}.callout[data-callout="question"],.callout[data-callout="help"],.callout[data-callout="faq"]{--c:236,117,0}.callout[data-callout="warning"],.callout[data-callout="caution"],.callout[data-callout="attention"]{--c:236,117,0}.callout[data-callout="failure"],.callout[data-callout="fail"],.callout[data-callout="missing"]{--c:233,49,71}.callout[data-callout="danger"],.callout[data-callout="error"]{--c:233,49,71}.callout[data-callout="bug"]{--c:233,49,71}.callout[data-callout="example"]{--c:120,82,238}.callout[data-callout="quote"],.callout[data-callout="cite"]{--c:158,158,158}.callout-inserter-wrapper{position:relative;display:inline-flex;align-items:center}.callout-inserter-btn{padding:0;border:none;background:0 0;cursor:pointer;display:flex;color:currentColor}.callout-inserter-btn:hover{opacity:.7}.callout-inserter-dropdown{position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:8px;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);z-index:1000;min-width:160px;display:none;overflow:auto;max-height:240px;background:#fff;border:1px solid #e5e7eb}.dark-layout .callout-inserter-dropdown{background:#1f1f1f;border-color:#3a3a3a}.callout-inserter-dropdown.show{display:block}.callout-inserter-item{padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:8px;font-size:13px;transition:background .15s}.callout-inserter-item:hover{background:#f5f5f5}.dark-layout .callout-inserter-item:hover{background:#2a2a2a}.callout-inserter-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}`;
    const CSS_COLORFUL = `.callout{background:rgba(var(--c),.1)}`;

    const ICONS = { note: "M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zm-6.17-1.81 4 4", abstract: "M8 2h8v4H8zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01", info: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 14v-4m0-4h.01", tip: "M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4", success: "M20 6 9 17l-5-5", question: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01", warning: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3M12 9v4m0 4h.01", failure: "M18 6 6 18M6 6l12 12", danger: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z", bug: "M12 20v-9m2-6a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4zM14.12 3.88 16 2M8 2l1.88 1.88M9 7.13V6a3 3 0 1 1 6 0v1.13", example: "M3 5h.01M3 12h.01M3 19h.01M8 5h13M8 12h13M8 19h13", quote: "M16 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2zM5 3a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2 1 1 0 0 1 1 1v1a2 2 0 0 1-2 2 1 1 0 0 0-1 1v2a1 1 0 0 0 1 1 6 6 0 0 0 6-6V5a2 2 0 0 0-2-2z", fold: "m6 9 6 6 6-6" };
    const TYPE_MAP = { summary: "abstract", tldr: "abstract", hint: "tip", important: "tip", check: "success", done: "success", help: "question", faq: "question", caution: "warning", attention: "warning", fail: "failure", missing: "failure", error: "danger", cite: "quote" };
    const MENUS = [{ k: "note", n: "笔记", c: "8,109,221" }, { k: "info", n: "信息", c: "8,109,221" }, { k: "tip", n: "提示", c: "83,223,221" }, { k: "warning", n: "警告", c: "236,117,0" }, { k: "danger", n: "危险", c: "233,49,71" }, { k: "success", n: "成功", c: "68,207,110" }, { k: "question", n: "问题", c: "236,117,0" }, { k: "example", n: "示例", c: "120,82,238" }];
    const svg = d => `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="svg-icon"><path d="${d}"/></svg>`;
    const RE = /^\[!(\w+)\]([+-])?(?:\s+([^<\n]+))?(?:<br\s*\/?>)?([\s\S]*)$/i;

    const render = (els) => {
        els.forEach(bq => {
            if (bq.classList.contains("oc-done") || bq.closest("blockquote.oc-done")) return;
            bq.classList.add("oc-done");
            const p = bq.querySelector(":scope > p");
            const m = (p?.innerHTML?.trim() || "").match(RE);
            if (!m) return;
            const [, type, fold, title, content] = m;
            const t = type.toLowerCase(), base = TYPE_MAP[t] || t, icon = ICONS[base] || ICONS.note;
            const isColl = fold === "+" || fold === "-", isCol = fold === "-";
            const wrap = document.createElement("div");
            wrap.className = `callout${isColl ? " is-collapsible" : ""}${isCol ? " is-collapsed" : ""}`;
            wrap.dataset.callout = t;
            const titleEl = document.createElement("div");
            titleEl.className = "callout-title";
            titleEl.innerHTML = `<div class="callout-icon">${svg(icon)}</div><div class="callout-title-inner">${title?.trim() || type[0].toUpperCase() + type.slice(1)}</div>`;
            if (isColl) {
                const foldEl = document.createElement("div");
                foldEl.className = `callout-fold${isCol ? " is-collapsed" : ""}`;
                foldEl.innerHTML = svg(ICONS.fold);
                titleEl.appendChild(foldEl);
                titleEl.onclick = () => { wrap.classList.toggle("is-collapsed"); foldEl.classList.toggle("is-collapsed"); };
            }
            wrap.appendChild(titleEl);
            const cont = document.createElement("div");
            cont.className = "callout-content";
            if (content?.trim()) { const pp = document.createElement("p"); pp.innerHTML = content.trim(); cont.appendChild(pp); }
            let sib = p.nextSibling;
            while (sib) { const next = sib.nextSibling; cont.appendChild(sib); sib = next; }
            if (cont.childNodes.length) wrap.appendChild(cont);
            bq.replaceWith(wrap);
        });
    };

    const insertCallout = (editor, type) => {
        const cm = editor.querySelector(".CodeMirror")?.CodeMirror;
        if (!cm) return;
        const doc = cm.getDoc();
        let cur = doc.getCursor();
        const lvl = (doc.getLine(cur.line).match(/^(>\s*)+/)?.[0].match(/>/g) || []).length;
        if (lvl > 0) {
            let last = cur.line;
            for (let i = cur.line + 1; i < doc.lineCount(); i++) { if (doc.getLine(i).match(/^>\s*/)) last = i; else break; }
            cur = { line: last, ch: doc.getLine(last).length };
        }
        const pre = lvl > 0 ? ">".repeat(lvl + 1) + " " : "> ";
        doc.replaceRange((lvl > 0 ? "\n" : "") + `${pre}[!${type}] \n${pre}`, cur);
        doc.setCursor({ line: cur.line + (lvl > 0 ? 1 : 0), ch: `${pre}[!${type}] `.length });
        cm.focus();
    };

    let clickBound = false;
    const createInserter = () => {
        const editor = $(".md-editor");
        const bar = editor?.querySelector(".mde-toolbar");
        if (!editor || !bar) return;

        const cleanupManagedSeps = () => {
            bar.querySelectorAll(".nsx-callout-sep").forEach(s => s.remove());
        };

        const ensureSepBetween = (left, right) => {
            if (!left || !right) return;
            if (left.parentElement !== right.parentElement) return;
            let cur = left.nextElementSibling;
            while (cur && cur !== right) {
                const next = cur.nextElementSibling;
                if (cur.classList?.contains("sep")) cur.remove();
                cur = next;
            }
            if (cur !== right) return;

            const sep = document.createElement("div");
            sep.className = "sep nsx-callout-sep";
            right.before(sep);
        };

        const isMobile = document.documentElement.classList.contains("nsx-mobile");
        const quickReplyWrap = bar.querySelector(".nsx-quick-reply-wrap");
        const existedWrap = bar.querySelector(".callout-inserter-wrapper");
        const aiSep = bar.querySelector(".nsx-ai-sep");
        if (existedWrap) {
            cleanupManagedSeps();
            if (quickReplyWrap && quickReplyWrap !== existedWrap) {
                if (!isMobile) {
                    if (quickReplyWrap.previousElementSibling !== existedWrap) {
                        quickReplyWrap.before(existedWrap);
                    }
                    ensureSepBetween(existedWrap, quickReplyWrap);
                } else {
                    if (quickReplyWrap.nextElementSibling !== existedWrap) {
                        quickReplyWrap.after(existedWrap);
                    }
                    ensureSepBetween(quickReplyWrap, existedWrap);
                }
            } else if (!isMobile && aiSep) {
                if (aiSep.previousElementSibling !== existedWrap) {
                    aiSep.before(existedWrap);
                }
            }
            return;
        }

        const vAttr = [...(bar.querySelector(".toolbar-item")?.attributes || [])].find(a => a.name.startsWith("data-v-"))?.name;
        const setV = el => vAttr && el.setAttribute(vAttr, "");

        const wrap = document.createElement("span");
        wrap.className = "callout-inserter-wrapper toolbar-item";
        wrap.title = "Callout - Nodeseek Max-iSen";
        setV(wrap);

        const btn = document.createElement("span");
        btn.className = "callout-inserter-btn i-icon";
        btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 48 48" fill="none"><path d="M44 8H4v30h15l5 5 5-5h15V8Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M24 18v10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="33" r="2" fill="currentColor"/></svg>`;
        setV(btn);

        const drop = document.createElement("div");
        drop.className = "callout-inserter-dropdown";
        MENUS.forEach(t => {
            const item = document.createElement("div");
            item.className = "callout-inserter-item";
            item.innerHTML = `<span class="callout-inserter-dot" style="background:rgb(${t.c})"></span>${t.n}[${t.k}]`;
            item.onclick = e => { e.stopPropagation(); insertCallout(editor, t.k); drop.classList.remove("show"); };
            drop.appendChild(item);
        });

        btn.onclick = e => { e.stopPropagation(); drop.classList.toggle("show"); };
        if (!clickBound) { document.addEventListener("click", () => $$(".callout-inserter-dropdown.show").forEach(d => d.classList.remove("show"))); clickBound = true; }

        const sep = document.createElement("div");
        sep.className = "sep nsx-callout-sep";
        setV(sep);
        wrap.append(btn, drop);

        if (quickReplyWrap) {
            if (!isMobile) {
                quickReplyWrap.before(wrap);
                ensureSepBetween(wrap, quickReplyWrap);
            } else {
                quickReplyWrap.after(wrap);
                ensureSepBetween(quickReplyWrap, wrap);
            }
        } else {
            const aiWrap = bar.querySelector(".nsx-ai-wrap");
            const aiSep = bar.querySelector(".nsx-ai-sep");
            if (aiSep) {
                aiSep.before(wrap);
            } else if (aiWrap) {
                const prev = aiWrap.previousElementSibling;
                if (prev?.classList?.contains("sep")) aiWrap.before(wrap);
                else aiWrap.before(sep, wrap);
            } else {
                const last = bar.lastElementChild;
                if (last?.classList?.contains("sep")) bar.append(wrap);
                else bar.append(sep, wrap);
            }
        }
    };

    const callout = {
        id: "callout",
        order: 360,
        cfg: { callout: { enabled: true, style: "colorful" } },
        meta: { callout: { label: "Callout 语法支持", group: "🎨 视觉美化", fields: { style: { type: "RADIO", label: "风格", options: [{ value: "colorful", text: "绚丽" }, { value: "clean", text: "清新" }] } } } },
        match: ctx => (ctx.isPost || /^\/new-discussion/.test(location.pathname)) && ctx.store.get("callout.enabled", true),
        init(ctx) {
            const style = ctx.store.get("callout.style", "colorful");
            addStyle("nsx-callout", CSS_BASE + (style === "colorful" ? CSS_COLORFUL : ""));
            render($$(".post-content blockquote"));
            createInserter();
            document.addEventListener("click", e => { if (e.target?.closest?.(".md-editor")) requestAnimationFrame(createInserter); });
        },
        watch: () => [{ sel: ".post-content blockquote", fn: render, opts: { debounce: 80 } }, { sel: ".mde-toolbar", fn: createInserter, opts: { debounce: 80 } }]
    };

    const __vite_glob_0_5 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: callout
    }, Symbol.toStringTag, { value: 'Module' }));

    // 代码高亮 + 复制按钮

    const CSS$4 = `.post-content pre{position:relative}.post-content pre span.copy-code{position:absolute;right:.5em;top:.5em;cursor:pointer;color:#c1c7cd}.post-content pre .iconpark-icon{width:16px;height:16px;margin:3px}.post-content pre .iconpark-icon:hover{color:var(--link-hover-color)}.dark-layout .post-content pre code.hljs{padding:1em!important}`;

    const mark$1 = new WeakSet();
    const addCopyBtn = (els, ctx) => {
        els.forEach(code => {
            if (mark$1.has(code)) return;
            mark$1.add(code);
            const btn = document.createElement("span");
            btn.className = "copy-code";
            btn.title = "复制代码";
            btn.innerHTML = `<svg class="iconpark-icon"><use href="#copy"></use></svg>`;
            btn.onclick = async () => {
                let ok = false;
                const text = code.textContent || "";
                try {
                    if (navigator.clipboard?.writeText) {
                        await navigator.clipboard.writeText(text);
                        ok = true;
                    }
                } catch { }

                if (!ok) {
                    try {
                        const sel = getSelection(), range = document.createRange();
                        range.selectNodeContents(code);
                        sel.removeAllRanges();
                        sel.addRange(range);
                        ok = document.execCommand("copy");
                        sel.removeAllRanges();
                    } catch { ok = false; }
                }

                if (ok) {
                    btn.querySelector("use")?.setAttribute("href", "#check");
                    setTimeout(() => btn.querySelector("use")?.setAttribute("href", "#copy"), 1000);
                    ctx.ui.tips?.("复制成功", btn, { tips: 4, time: 1000 });
                } else {
                    ctx.ui.warning?.("复制失败，请手动复制");
                }
            };
            code.after(btn);
        });
    };

    /* ==========================================================================
       [ 🎨 视觉美化 ] - 代码高亮 + 复制按钮
       ========================================================================== */
    const codeHighlight = {
        id: "codeHighlight",
        deps: ["ui"],
        order: 140,
        cfg: { code_highlight: { enabled: true } },
        meta: { code_highlight: { label: "代码高亮", group: "🎨 视觉美化" } },
        match: ctx => ctx.store.get("code_highlight.enabled", true),
        init(ctx) {
            addStyle("nsx-hl-css", CSS$4);
            addCopyBtn($$(".post-content pre code"), ctx);
        },
        watch: ctx => ({ sel: ".post-content pre code", fn: els => addCopyBtn(els, ctx), opts: { debounce: 80 } })
    };

    const __vite_glob_0_6 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: codeHighlight
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 回帖足迹
       ========================================================================== */
    const COMMENT_FOOTPRINT_DB = "nsx-comments-db";
    const COMMENT_FOOTPRINT_STORE = "nsx-comments-store";
    const COMMENT_FOOTPRINT_INDEX = "upid";
    const COMMENT_FOOTPRINT_PROGRESS = { initialized: "nsx_init", page: "nsx_page", time: "nsx_time", count: "nsx_count" };

    /* COMMENT_FOOTPRINT_CORE_START */
    const commentFootprintPostId = href => {
        const match = String(href || "").match(/\/post-(\d+)(?:-\d+)?/);
        return match ? Number(match[1]) : null;
    };
    const commentFootprintTargetPage = (floor, pageSize) => Math.max(1, Math.ceil(Number(floor) / Math.max(1, Number(pageSize) || 10)));
    /* COMMENT_FOOTPRINT_CORE_END */

    let commentFootprintDb = null;
    let commentFootprintDbPromise = null;
    const openCommentFootprintDb = () => {
        if (commentFootprintDb) return Promise.resolve(commentFootprintDb);
        if (commentFootprintDbPromise) return commentFootprintDbPromise;
        commentFootprintDbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(COMMENT_FOOTPRINT_DB, 1);
            request.onerror = () => reject(request.error || new Error("无法打开回帖足迹数据库"));
            request.onupgradeneeded = event => {
                const db = event.target.result;
                const store = db.objectStoreNames.contains(COMMENT_FOOTPRINT_STORE)
                    ? event.target.transaction.objectStore(COMMENT_FOOTPRINT_STORE)
                    : db.createObjectStore(COMMENT_FOOTPRINT_STORE, { keyPath: ["uid", "post_id", "floor_id"] });
                if (!store.indexNames.contains(COMMENT_FOOTPRINT_INDEX)) store.createIndex(COMMENT_FOOTPRINT_INDEX, ["uid", "post_id"]);
            };
            request.onsuccess = event => {
                commentFootprintDb = event.target.result;
                commentFootprintDb.onclose = () => { commentFootprintDb = null; commentFootprintDbPromise = null; };
                commentFootprintDb.onversionchange = () => commentFootprintDb.close();
                resolve(commentFootprintDb);
            };
        }).catch(error => { commentFootprintDbPromise = null; throw error; });
        return commentFootprintDbPromise;
    };

    const withCommentFootprintStore = async (mode, action) => {
        const db = await openCommentFootprintDb();
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(COMMENT_FOOTPRINT_STORE, mode);
            transaction.onerror = () => reject(transaction.error || new Error("回帖足迹数据库操作失败"));
            transaction.onabort = () => reject(transaction.error || new Error("回帖足迹数据库操作已取消"));
            try { action(transaction.objectStore(COMMENT_FOOTPRINT_STORE), resolve, reject); }
            catch (error) { reject(error); }
        });
    };

    const commentFootprintIndexForUser = uid => withCommentFootprintStore("readonly", (store, resolve) => {
        const floorsByPost = new Map();
        const request = store.index(COMMENT_FOOTPRINT_INDEX).openCursor(IDBKeyRange.bound([uid, 0], [uid, Infinity]));
        request.onerror = () => resolve(floorsByPost);
        request.onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) {
                floorsByPost.forEach(floors => floors.sort((left, right) => left - right));
                resolve(floorsByPost);
                return;
            }
            const postId = Number(cursor.value?.post_id);
            const floor = Number(cursor.value?.floor_id);
            if (Number.isFinite(postId) && Number.isFinite(floor) && floor > 0) {
                const floors = floorsByPost.get(postId) || [];
                if (!floors.includes(floor)) floors.push(floor);
                floorsByPost.set(postId, floors);
            }
            cursor.continue();
        };
    });

    const commentFootprintListItems = root => {
        const items = new Set(root.querySelectorAll(".post-list-item,.post-list .list-item,.post-item"));
        root.querySelectorAll('.post-title a[href*="/post-"],a.post-title-link[href*="/post-"]').forEach(link => {
            const item = link.closest(".post-list-item,.post-list .list-item,.post-item,li");
            if (item) items.add(item);
        });
        return [...items];
    };

    const renderCommentFootprintBadge = (ctx, item, floors) => {
        if (!item) return;
        const title = item.querySelector(".post-title") || item.querySelector("[role='heading']");
        const titleLink = title?.querySelector('a[href*="/post-"]') || item.querySelector('a.post-title-link[href*="/post-"]');
        const postId = commentFootprintPostId(titleLink?.href);
        const oldBadge = item.querySelector(".nsx-replied-badge");
        const oldActions = item.querySelector(".nsx-post-status-actions");
        const findCategory = () => item.querySelector(".post-category,.post-list-category,.category-tag,a[href^='/categories/'],a[href*='/categories/']");
        if (!title || !postId || !floors?.length) {
            oldBadge?.remove();
            if (oldActions) {
                const category = oldActions.querySelector(".post-category,.post-list-category,.category-tag,a[href^='/categories/'],a[href*='/categories/']");
                if (category && oldActions.parentElement) oldActions.parentElement.insertBefore(category, oldActions.nextSibling);
                oldActions.remove();
            }
            return;
        }
        const latestFloor = floors[floors.length - 1];
        const badge = oldBadge || document.createElement("a");
        badge.className = "nsx-forum-status-tag nsx-replied-badge";
        badge.textContent = "已回复";
        badge.title = `回复楼层：${floors.map(floor => `#${floor}`).join("、")}`;
        badge.href = `/post-${postId}-${commentFootprintTargetPage(latestFloor, ctx.uw?.__config__?.commentPerPage)}#${latestFloor}`;
        badge.style.setProperty("--nsx-status-color-light", normalizeStatusColor(ctx.store.get("comment_footprint.badge_color_light", "#16a34a"), "#16a34a"));
        badge.style.setProperty("--nsx-status-color-dark", normalizeStatusColor(ctx.store.get("comment_footprint.badge_color_dark", "#86efac"), "#86efac"));
        const resetCategoryAnchor = () => {
            badge.removeAttribute("data-nsx-category-anchor");
            ["position", "right", "left", "bottom", "top", "margin", "z-index"].forEach(property => badge.style.removeProperty(property));
        };
        const category = findCategory();
        if (category?.parentElement) {
            if (oldActions) {
                if (oldActions.contains(category) && oldActions.parentElement) oldActions.parentElement.insertBefore(category, oldActions.nextSibling);
                oldActions.remove();
            }
            category.parentElement.insertBefore(badge, category);
            const categoryStyle = getComputedStyle(category);
            const pixelValue = value => {
                if (!value || value === "auto") return null;
                const parsed = Number.parseFloat(value);
                return Number.isFinite(parsed) ? parsed : null;
            };
            if (categoryStyle.position === "absolute") {
                const gap = document.body?.classList.contains("nsx-mobile") ? 5 : 8;
                const marginLeft = pixelValue(categoryStyle.marginLeft) || 0;
                const marginRight = pixelValue(categoryStyle.marginRight) || 0;
                const right = pixelValue(categoryStyle.right);
                const left = pixelValue(categoryStyle.left);
                badge.dataset.nsxCategoryAnchor = "true";
                badge.style.setProperty("position", "absolute", "important");
                badge.style.setProperty("margin", "0", "important");
                badge.style.setProperty("z-index", "1");
                if (right !== null) {
                    badge.style.setProperty("right", `${right + category.offsetWidth + marginLeft + marginRight + gap}px`, "important");
                    badge.style.setProperty("left", "auto", "important");
                } else if (left !== null) {
                    badge.style.setProperty("left", `${left - badge.offsetWidth - marginLeft - marginRight - gap}px`, "important");
                    badge.style.setProperty("right", "auto", "important");
                }
                const bottom = pixelValue(categoryStyle.bottom);
                const top = pixelValue(categoryStyle.top);
                if (bottom !== null) {
                    badge.style.setProperty("bottom", `${bottom}px`, "important");
                    badge.style.setProperty("top", "auto", "important");
                } else if (top !== null) {
                    badge.style.setProperty("top", `${top}px`, "important");
                    badge.style.setProperty("bottom", "auto", "important");
                }
            } else {
                resetCategoryAnchor();
            }
        } else if (!oldBadge) {
            resetCategoryAnchor();
            title.appendChild(badge);
        }
    };

    const commentFootprint = {
        id: "commentFootprint",
        order: 365,
        cfg: { comment_footprint: { enabled: true, badge_color_light: "#16a34a", badge_color_dark: "#86efac", reset_db: "", show_stats: "" } },
        meta: {
            comment_footprint: {
                label: "回帖足迹",
                group: "🧭 辅助工具",
                fields: {
                    badge_color_light: { type: "COLOR", label: "首页已回复标签颜色（浅色主题）" },
                    badge_color_dark: { type: "COLOR", label: "首页已回复标签颜色（深色主题）" },
                    reset_db: { type: "BUTTON", label: "重置数据", buttonText: "重置足迹", action: "comment_footprint:reset", desc: "仅清除当前账号的本地回帖足迹，并在下次打开页面时重新同步。" },
                    show_stats: { type: "BUTTON", label: "数据统计", buttonText: "查看统计", action: "comment_footprint:stats", desc: "查看当前账号的同步时间、状态和记录数量。" }
                }
            }
        },
        match: ctx => ctx.loggedIn,
        init(ctx) {
            const uid = Number(ctx.uid);
            if (!Number.isFinite(uid)) return;
            const username = String(ctx.user?.member_name || ctx.user?.username || uid);
            const siteKey = `nsx_comment_footprint_${location.host.replace(/\W/g, "_")}`;
            const lockKey = `${siteKey}_${uid}_lock`;

            addStyle("nsx-comment-footprint", `.nsx-replied-badge{margin-left:auto!important;margin-right:8px!important;flex:0 0 auto}.nsx-replied-badge+.post-category,.nsx-replied-badge+.post-list-category,.nsx-replied-badge+.category-tag,.nsx-replied-badge+a[href^='/categories/'],.nsx-replied-badge+a[href*='/categories/']{margin-left:0!important}.nsx-my-replies{display:flex;align-items:center;flex-wrap:wrap;gap:7px;margin:12px 0 18px;padding:10px 12px;border:1px solid var(--nsx-ui-border,#e4e4e7);border-radius:6px;background:var(--nsx-ui-background,#fff);color:var(--nsx-ui-foreground,#09090b);font-size:13px}.nsx-my-replies-label{margin-right:3px;font-weight:600}.nsx-my-reply-floor{display:inline-flex;align-items:center;justify-content:center;min-width:34px;min-height:28px;padding:0 8px;border:1px solid var(--nsx-ui-border,#e4e4e7);border-radius:5px;background:var(--nsx-ui-muted,#f4f4f5);color:var(--nsx-ui-foreground,#18181b)!important;font-size:12px;font-weight:600;text-decoration:none!important}.nsx-my-reply-floor:hover{text-decoration:none!important}.nsx-comment-floor-highlight{animation:nsx-comment-floor-pulse 1.8s ease-out}@keyframes nsx-comment-floor-pulse{0%,35%{box-shadow:0 0 0 3px color-mix(in srgb,#16a34a 22%,transparent);background:color-mix(in srgb,#16a34a 7%,transparent)}100%{box-shadow:none;background:transparent}}.nsx-mobile .nsx-replied-badge{min-height:26px;margin-right:5px!important;flex:0 0 auto}.nsx-mobile .nsx-my-replies{margin:8px 0 14px;padding:9px 10px}`);

            const getSiteProgress = () => {
                const value = GM_getValue(siteKey, {});
                return value && typeof value === "object" ? value : {};
            };
            const getProgress = (key, fallback) => getSiteProgress()?.[uid]?.[key] ?? fallback;
            const setProgress = (key, value) => {
                const all = getSiteProgress();
                all[uid] ||= {};
                all[uid][key] = value;
                GM_setValue(siteKey, all);
            };
            let floorsByPost = new Map();
            let indexPromise = null;
            const loadIndex = (force = false) => {
                if (!force && indexPromise) return indexPromise;
                indexPromise = commentFootprintIndexForUser(uid).then(index => (floorsByPost = index));
                return indexPromise;
            };
            const putRecords = records => withCommentFootprintStore("readwrite", (store, resolve, reject) => {
                const normalized = records.filter(record => Number.isFinite(record.post_id) && Number.isFinite(record.floor_id) && record.floor_id > 0);
                if (!normalized.length) return resolve(0);
                let completed = 0;
                normalized.forEach(record => {
                    const request = store.put(record);
                    request.onerror = () => reject(request.error);
                    request.onsuccess = () => {
                        completed += 1;
                        if (completed === normalized.length) resolve(normalized.length);
                    };
                });
            });
            const countRecords = () => withCommentFootprintStore("readonly", (store, resolve) => {
                const request = store.index(COMMENT_FOOTPRINT_INDEX).count(IDBKeyRange.bound([uid, 0], [uid, Infinity]));
                request.onerror = () => resolve(0);
                request.onsuccess = event => resolve(Number(event.target.result) || 0);
            });
            const clearRecords = () => withCommentFootprintStore("readwrite", (store, resolve, reject) => {
                const request = store.index(COMMENT_FOOTPRINT_INDEX).openCursor(IDBKeyRange.bound([uid, 0], [uid, Infinity]));
                request.onerror = () => reject(request.error);
                request.onsuccess = event => {
                    const cursor = event.target.result;
                    if (!cursor) return resolve();
                    cursor.delete();
                    cursor.continue();
                };
            });
            const renderList = () => {
                if (!ctx.isList) return;
                commentFootprintListItems(document).forEach(item => {
                    const link = item.querySelector('.post-title a[href*="/post-"],a.post-title-link[href*="/post-"]');
                    const postId = commentFootprintPostId(link?.href);
                    renderCommentFootprintBadge(ctx, item, floorsByPost.get(postId));
                });
            };
            const renderPostNavigation = () => {
                if (!ctx.isPost) return;
                const postId = commentFootprintPostId(location.href);
                const floors = floorsByPost.get(postId) || [];
                const root = document.querySelector(".nsk-post") || document.querySelector("article.post-content");
                const title = root?.querySelector(".post-title") || root?.querySelector("h1,.post-content-title");
                const old = root?.querySelector(".nsx-my-replies");
                if (!root || !title || !floors.length) {
                    old?.remove();
                    return;
                }
                const bar = old || document.createElement("div");
                bar.className = "nsx-my-replies";
                const signature = floors.join(",");
                if (old && bar.dataset.floors === signature) return;
                bar.dataset.floors = signature;
                bar.replaceChildren();
                const label = document.createElement("span");
                label.className = "nsx-my-replies-label";
                label.textContent = "我的回复";
                bar.appendChild(label);
                floors.forEach(floor => {
                    const link = document.createElement("a");
                    link.className = "nsx-my-reply-floor";
                    link.textContent = `#${floor}`;
                    link.href = `/post-${postId}-${commentFootprintTargetPage(floor, ctx.uw?.__config__?.commentPerPage)}#${floor}`;
                    link.addEventListener("click", event => {
                        const target = document.getElementById(String(floor));
                        if (!target) return;
                        event.preventDefault();
                        history.replaceState(null, "", `#${floor}`);
                        target.scrollIntoView({ behavior: "smooth", block: "center" });
                        target.classList.remove("nsx-comment-floor-highlight");
                        requestAnimationFrame(() => target.classList.add("nsx-comment-floor-highlight"));
                        setTimeout(() => target.classList.remove("nsx-comment-floor-highlight"), 1900);
                    });
                    bar.appendChild(link);
                });
                if (!old) title.insertAdjacentElement("afterend", bar);
            };
            const renderAll = () => {
                renderList();
                renderPostNavigation();
            };
            const captureVisibleReplies = async () => {
                if (!ctx.isPost) return 0;
                const postId = commentFootprintPostId(location.href);
                if (!postId) return 0;
                const names = new Set([username, ctx.user?.username, ctx.user?.member_name].map(value => String(value || "").trim().toLowerCase()).filter(Boolean));
                const records = [...document.querySelectorAll(".comments .content-item[id],.comments .comment-item[id]")].flatMap(comment => {
                    const floor = Number(comment.id);
                    const author = comment.querySelector('.author-info a[href*="/space/"],.author-name');
                    const sameUid = new RegExp(`/space/${uid}(?:/|$|#)`).test(author?.getAttribute("href") || "");
                    const sameName = names.has(String(author?.textContent || "").trim().toLowerCase());
                    return floor > 0 && (sameUid || sameName) ? [{ uid, post_id: postId, floor_id: floor }] : [];
                });
                return putRecords(records);
            };

            const sync = async (mode, pageLimit = Infinity) => {
                const initial = mode === "initial";
                const commentCount = Math.max(0, Number(ctx.user?.nComment) || 0);
                const maxPages = commentCount ? Math.ceil(commentCount / 15) : 1000;
                let page = initial ? Math.max(1, Number(getProgress(COMMENT_FOOTPRINT_PROGRESS.page, 1)) || 1) : 1;
                let added = 0;
                let stopped = false;
                let receivedPage = false;
                let pagesRead = 0;
                while (!stopped && page <= maxPages && pagesRead < pageLimit) {
                    const response = await ctx.net.get(`/api/content/list-comments?uid=${encodeURIComponent(uid)}&page=${page}`);
                    const comments = Array.isArray(response?.comments) ? response.comments : [];
                    if (!response || response.success === false) throw new Error(response?.message || "无法读取公开回帖记录");
                    receivedPage = true;
                    if (!comments.length) break;
                    const records = comments.flatMap(comment => {
                        const postId = Number(comment?.post_id);
                        const floor = Number(comment?.floor_id);
                        return Number.isFinite(postId) && Number.isFinite(floor) && floor > 0
                            ? [{ uid, post_id: postId, floor_id: floor }]
                            : [];
                    });
                    added += await putRecords(records);
                    if (initial) setProgress(COMMENT_FOOTPRINT_PROGRESS.page, page + 1);
                    if (comments.length < 15) break;
                    page += 1;
                    pagesRead += 1;
                }
                if (!receivedPage && commentCount > 0) throw new Error("未取得公开回帖记录");
                const total = await countRecords();
                setProgress(COMMENT_FOOTPRINT_PROGRESS.count, total);
                setProgress(COMMENT_FOOTPRINT_PROGRESS.time, Date.now());
                if (initial) {
                    setProgress(COMMENT_FOOTPRINT_PROGRESS.initialized, true);
                    setProgress(COMMENT_FOOTPRINT_PROGRESS.page, 1);
                }
                return added;
            };

            const withSyncLock = async action => {
                if (navigator.locks?.request) return navigator.locks.request(`nsx_comment_footprint_${location.host}_${uid}`, { ifAvailable: true }, lock => lock ? action() : undefined);
                const token = `${Date.now()}-${Math.random()}`;
                const existing = GM_getValue(lockKey, null);
                if (existing?.time && Date.now() - existing.time < 120000) return;
                GM_setValue(lockKey, { token, time: Date.now() });
                try { return await action(); }
                finally { if (GM_getValue(lockKey, null)?.token === token) GM_deleteValue(lockKey); }
            };

            const startSync = async () => {
                await loadIndex();
                await captureVisibleReplies();
                await loadIndex(true);
                renderAll();
                if (ctx.store.get("rules_compliance.enabled", false)) return;
                return withSyncLock(async () => {
                    try {
                        await sync("recent", 1);
                        await loadIndex(true);
                        renderAll();
                        if (!getProgress(COMMENT_FOOTPRINT_PROGRESS.initialized, false)) {
                            await sync("initial");
                            await loadIndex(true);
                            renderAll();
                        }
                    } catch (error) { ctx.env.warn("回帖足迹同步失败", error); }
                });
            };
            const refreshSoon = debounce(async () => {
                await captureVisibleReplies();
                await loadIndex(true);
                renderAll();
            }, 80);
            window.__nsxRuntime ||= {};
            window.__nsxRuntime.refreshCommentFootprint = refreshSoon;

            const migrationKey = `${siteKey}_${uid}_v2_enabled`;
            if (!GM_getValue(migrationKey, false)) {
                ctx.store.set("comment_footprint.enabled", true);
                GM_setValue(migrationKey, true);
            }
            if (ctx.store.get("comment_footprint.enabled", true)) startSync();

            document.addEventListener("nsx-action", async event => {
                if (event.detail === "comment_footprint:reset") {
                    const reset = async () => {
                        try {
                            await clearRecords();
                            const all = getSiteProgress();
                            delete all[uid];
                            GM_setValue(siteKey, all);
                            ctx.ui.success?.("当前账号的回帖足迹已重置");
                            floorsByPost = new Map();
                            renderAll();
                            setTimeout(() => location.reload(), 600);
                        } catch (error) { ctx.ui.error?.(`重置失败：${error?.message || "未知错误"}`); }
                    };
                    if (ctx.ui.layer) ctx.ui.layer.confirm("仅清除当前账号的本地回帖足迹。", { title: "确认重置？", icon: 3 }, index => { ctx.ui.layer.close(index); reset(); });
                    else if (window.confirm("确认重置当前账号的回帖足迹？")) reset();
                }
                if (event.detail === "comment_footprint:stats") {
                    const total = await countRecords();
                    const last = Number(getProgress(COMMENT_FOOTPRINT_PROGRESS.time, 0));
                    const text = `账号：${username}\n状态：${getProgress(COMMENT_FOOTPRINT_PROGRESS.initialized, false) ? "已完成首次同步" : "尚未完成首次同步"}\n记录：${total} 条\n最近更新：${last ? new Date(last).toLocaleString() : "无"}`;
                    if (ctx.ui.alert) ctx.ui.alert("回帖足迹统计", text);
                    else window.alert(text);
                }
            });
        },
        watch: ctx => {
            if (!ctx.store.get("comment_footprint.enabled", true)) return null;
            return {
                sel: ".post-list-item,.post-list .list-item,.post-item,.comments .content-item[id]",
                fn: () => window.__nsxRuntime?.refreshCommentFootprint?.(),
                opts: { debounce: 80 }
            };
        }
    };

    const __vite_glob_0_24 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: commentFootprint
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 快捷键回复 (Ctrl+Enter)
       ========================================================================== */
    const commentShortcut = {
        id: "commentShortcut",
        order: 135,
        cfg: { comment_shortcut: { enabled: true } },
        meta: { comment_shortcut: { label: "快捷键快捷回复", group: "🧭 辅助工具" } },
        match: ctx => ctx.isPost && ctx.store.get("comment_shortcut.enabled", true),
        init(ctx) {
            const getBtn = () => $(".md-editor button.submit.btn.focus-visible");
            $$(".CodeMirror").forEach(cmEl => {
                const cm = cmEl?.CodeMirror;
                if (!cm || cm.__nsx) return;
                cm.__nsx = true;
                const bind = () => {
                    const btn = getBtn();
                    if (btn && !/Ctrl\+Enter/i.test(btn.textContent)) btn.textContent += "(Ctrl+Enter)";
                    if (btn && !cm.__nsxMap) {
                        cm.__nsxMap = { "Ctrl-Enter": () => getBtn()?.click() };
                        cm.addKeyMap(cm.__nsxMap);
                    } else if (!btn && cm.__nsxMap) {
                        cm.removeKeyMap(cm.__nsxMap);
                        cm.__nsxMap = null;
                    }
                };
                bind();
                cmEl.addEventListener("focusin", bind, true);
                cmEl.addEventListener("focusout", bind, true);
            });
        }
    };

    const __vite_glob_0_7 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: commentShortcut
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🎨 视觉美化 ] - 深色模式同步系统
       ========================================================================== */
    const darkMode = {
        id: "darkMode",
        order: 180,
        cfg: { dark_mode_sync: { enabled: true } },
        meta: { dark_mode_sync: { label: "深色模式皮肤同步", group: "🎨 视觉美化" } },
        init(ctx) {
            const body = document.body;
            if (!body) return;
            const lightHl = GM_getResourceURL("highlightStyle");
            const darkHl = GM_getResourceURL("highlightStyle_dark");

            const apply = () => {
                const dark = body.classList.contains("dark-layout");
                // 为 html 添加/移除 .dark 类以触发 layui 深色主题
                document.documentElement.classList.toggle("dark", dark);
                // 切换 highlight.js 样式（同时移除 start() 中注入的初始样式避免冲突）
                document.getElementById("hightlight-style")?.remove();
                document.getElementById("nsx-hl")?.remove();
                addStyle("nsx-hl", dark ? darkHl : lightHl);
            };
            apply();
            new MutationObserver(() => apply()).observe(body, { attributes: true, attributeFilter: ["class"] });
        }
    };

    const __vite_glob_0_8 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: darkMode
    }, Symbol.toStringTag, { value: 'Module' }));

    // 浏览历史

    const CSS$3 = `.nsx-history-header{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 6px}.nsx-history-title{font-size:15px;font-weight:600}.nsx-history-action{border:0;background:0;color:#666;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px}.nsx-history-action:hover{background:#f2f3f5}.nsx-history-search{display:flex;align-items:center;gap:6px;margin:0 12px 8px;border:1px solid #e1e1e1;border-radius:8px;padding:6px 8px}.nsx-history-search input{border:0;background:0;outline:0;width:100%;font-size:13px}.nsx-history-tabs{display:flex;gap:16px;padding:0 12px 6px;border-bottom:1px solid #f0f0f0}.nsx-history-tab{border:0;background:0;cursor:pointer;color:#6b6b6b;font-size:12px;padding:6px 0;font-weight:600;border-bottom:2px solid transparent}.nsx-history-tab.is-active{color:#0a62ff;border-bottom-color:#0a62ff}.nsx-history-list{flex:1;overflow-y:auto;padding:6px 8px 12px}.nsx-history-group{margin-bottom:10px}.nsx-history-group-title{display:flex;align-items:center;justify-content:space-between;padding:4px;color:#666;font-size:12px}.nsx-history-items{list-style:none;margin:0;padding:0}.nsx-history-item{display:flex;align-items:center;gap:8px;padding:6px;border-radius:8px}.nsx-history-item:hover{background:#f5f7fb}.nsx-history-link{display:flex;align-items:center;gap:8px;flex:1;min-width:0;text-decoration:none;color:inherit}.nsx-history-icon{width:20px;height:20px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0}.nsx-history-icon img{width:100%;height:100%;object-fit:cover}.nsx-history-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nsx-history-time{color:#9a9a9a;font-size:12px;margin-left:auto}.nsx-history-empty{padding:10px 6px;color:#999;font-size:12px}.nsx-history-close,.nsx-history-restore{border:0;background:0;cursor:pointer;font-size:12px;padding:2px 4px;border-radius:6px;display:none}.nsx-history-close{color:#999}.nsx-history-restore{color:#0a62ff}.nsx-history-item:hover .nsx-history-time{display:none}.nsx-history-item:hover .nsx-history-close,.nsx-history-item:hover .nsx-history-restore{display:block}.nsx-history-group-title .nsx-history-close{display:block;opacity:.9}.nsx-history-close:hover{color:#ff4d4f}.nsx-history-restore:hover{background:#eef3ff}.dark-layout .nsx-history-action{color:#999}.dark-layout .nsx-history-action:hover{background:#2a2a2a}.dark-layout .nsx-history-search{border-color:#3a3a3a}.dark-layout .nsx-history-search input{color:#e0e0e0}.dark-layout .nsx-history-tabs{border-bottom-color:#3a3a3a}.dark-layout .nsx-history-tab{color:#999}.dark-layout .nsx-history-group-title{color:#888}.dark-layout .nsx-history-item:hover{background:#2a2a2a}.dark-layout .nsx-history-icon{background:#3a3a3a}.dark-layout .nsx-history-time{color:#666}.dark-layout .nsx-history-empty{color:#666}`;

    const HKEY = "nsx_browsing_history", RKEY = "nsx_recently_closed";

    const pad = n => String(n).padStart(2, "0");
    const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const now = () => new Date().toISOString();
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 浏览历史记录 (右侧面板)
       ========================================================================== */
    const history$1 = {
        id: "history",
        order: 400,
        cfg: { history: { enabled: true, limit: 100, days: 7 } },
        meta: { history: { label: "浏览历史记录", group: "🧭 辅助工具", fields: { limit: { type: "NUMBER", label: "保存上限", valueType: "number" }, days: { type: "NUMBER", label: "保存天数", valueType: "number" } } } },
        match: ctx => (ctx.isPost || ctx.isList) && ctx.store.get("history.enabled", true),
        init(ctx) {
            let maxItems = ctx.store.get("history.limit", 100) || 100;
            let maxAge = (ctx.store.get("history.days", 7) || 7) * 864e5;

            const prune = arr => {
                const t = Date.now();
                return (arr || []).filter(i => t - new Date(i.time).getTime() < maxAge).sort((a, b) => new Date(a.time) - new Date(b.time)).slice(-maxItems);
            };
            const load = k => { try { const r = JSON.parse(localStorage.getItem(k) || "[]"); const n = prune(r); if (n.length !== r.length) localStorage.setItem(k, JSON.stringify(n)); return n; } catch { return []; } };
            const save = (k, a) => localStorage.setItem(k, JSON.stringify(prune(a)));
            const getH = () => load(HKEY), saveH = a => save(HKEY, a);
            const getR = () => load(RKEY), saveR = a => save(RKEY, a);

            // 使用 postData 获取帖子信息
            const add = (pd, list, saveFn) => {
                if (!pd?.postId) return;
                const id = pd.postId;
                const h = list(), i = h.findIndex(x => x.postId === id);
                const e = { postId: id, title: pd.title || document.title, time: now(), uid: pd.op?.uid || null, author: pd.op?.name || null };
                i > -1 ? Object.assign(h[i], e) : h.push(e);
                saveFn(h);
            };

            addStyle("nsx-hist", CSS$3);
            let panel = null, trigger = null, state = { open: false, tab: "all", kw: "" };

            const head = $("#nsk-head");
            if (!head) return;
            const grp = ensureIconGroup();
            if (!grp) return;
            trigger = document.createElement("div");
            trigger.className = "history-dropdown-on";
            trigger.title = "历史记录";
            trigger.innerHTML = `<svg class="iconpark-icon" style="width:17px;height:17px"><use href="#history"></use></svg>`;
            grp.appendChild(trigger);

            const fmtDayTitle = day => {
                const d = new Date(`${day}T00:00:00`);
                const title = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`;
                return day === fmtDate(new Date()) ? `今天 - ${title}` : title;
            };

            const open = () => {
                closeOtherPanels("history");
                if (!panel) {
                    panel = document.createElement("div");
                    panel.id = "nsx-history-panel";
                    panel.innerHTML = `<div class="nsx-history-header"><div class="nsx-history-title">历史记录</div><button class="nsx-history-action" data-a="clear">清空</button></div><div class="nsx-history-search"><input placeholder="搜索"/></div><div class="nsx-history-tabs"><button class="nsx-history-tab is-active" data-t="all">全部</button><button class="nsx-history-tab" data-t="recent">最近关闭</button></div><div class="nsx-history-list"></div>`;
                    document.body.appendChild(panel);
                    panel.querySelector("input").oninput = e => { state.kw = e.target.value.toLowerCase(); render(); };
                    panel.onclick = e => {
                        e.stopPropagation();
                        const t = e.target.closest("[data-t]");
                        if (t) { state.tab = t.dataset.t; render(); return; }
                        const a = e.target.closest("[data-a]");
                        if (!a) return;
                        const act = a.dataset.a, id = a.dataset.id;
                        if (act === "clear") ctx.ui.confirm("确认", "确定要清空所有记录吗？", () => { localStorage.removeItem(state.tab === "recent" ? RKEY : HKEY); render(); });
                        if (act === "del") { state.tab === "recent" ? saveR(getR().filter(x => x.postId != id)) : saveH(getH().filter(x => x.postId != id)); render(); }
                        if (act === "clear-day") { const key = state.tab === "recent" ? RKEY : HKEY; save(key, load(key).filter(i => fmtDate(new Date(i.time)) !== a.dataset.day)); render(); }
                        if (act === "restore") window.open(`/post-${id}-1`, "_blank");
                    };
                    document.addEventListener("click", e => { if (state.open && !panel.contains(e.target) && !trigger.contains(e.target)) close(); });
                    document.addEventListener("keydown", e => { if (state.open && e.key === "Escape") close(); });
                }
                const r = trigger.getBoundingClientRect();
                panel.style.top = `${r.bottom + 8}px`;
                panel.style.height = `${innerHeight - r.bottom - 16}px`;
                render();
                panel.classList.add("show");
                state.open = true;
            };
            const close = () => { panel?.classList.remove("show"); state.open = false; };
            window.__nsxPanelCtrl ||= {};
            window.__nsxPanelCtrl.history = { close, isOpen: () => state.open };
            const toggle = () => state.open ? close() : open();

            const render = () => {
                let list = (state.tab === "recent" ? getR() : getH()).sort((a, b) => new Date(b.time) - new Date(a.time));
                if (state.kw) list = list.filter(i => (i.title || "").toLowerCase().includes(state.kw));
                panel.querySelectorAll(".nsx-history-tab").forEach(b => b.classList.toggle("is-active", b.dataset.t === state.tab));
                const lEl = panel.querySelector(".nsx-history-list");
                if (!list.length) { lEl.innerHTML = `<div class="nsx-history-empty">暂无记录</div>`; return; }
                const g = {};
                list.forEach(i => { const d = fmtDate(new Date(i.time)); (g[d] ||= []).push(i); });
                lEl.innerHTML = Object.entries(g).map(([day, items]) => {
                    const itemsHtml = items.map(i => {
                        if (!i.postId) return "";
                        const url = `/post-${i.postId}-1`;
                        const avatar = i.uid ? `<img src="/avatar/${i.uid}.png" onerror="this.style.display='none'">` : "";
                        const restore = state.tab === "recent" ? `<button class="nsx-history-restore" data-a="restore" data-id="${i.postId}" title="恢复">↗</button>` : "";
                        return `<li class="nsx-history-item"><a class="nsx-history-link" href="${url}"><span class="nsx-history-icon"${i.author ? ` title="@${esc(i.author)}"` : ""}>${avatar}</span><span class="nsx-history-item-title">${esc((i.title || "").slice(0, 32))}</span></a><span class="nsx-history-time">${fmtTime(new Date(i.time))}</span>${restore}<button class="nsx-history-close" data-a="del" data-id="${i.postId}">✖</button></li>`;
                    }).join("");
                    return `<div class="nsx-history-group"><div class="nsx-history-group-title"><span>${fmtDayTitle(day)}</span><button class="nsx-history-close" data-a="clear-day" data-day="${day}" title="清除当天">✕</button></div><ul class="nsx-history-items">${itemsHtml}</ul></div>`;
                }).join("");
            };

            trigger.onclick = e => {
                e.preventDefault();
                e.stopPropagation();
                toggle();
            };

            // 记录当前页面
            const pd = ctx.uw?.__config__?.postData;
            if (pd) add(pd, getH, saveH);

            // 监听页面关闭
            addEventListener("beforeunload", () => {
                const pd = ctx.uw?.__config__?.postData;
                if (pd) add(pd, getR, saveR);
            }, { capture: true });

            window.__nsxRuntime ||= {};
            window.__nsxRuntime.refreshHistory = () => {
                maxItems = ctx.store.get("history.limit", 100) || 100;
                maxAge = (ctx.store.get("history.days", 7) || 7) * 864e5;
                const h = prune(getH());
                const r = prune(getR());
                localStorage.setItem(HKEY, JSON.stringify(h));
                localStorage.setItem(RKEY, JSON.stringify(r));
                if (panel && state.open) render();
            };
            document.addEventListener("NSPRO_FORUM_DATA_CHANGED", event => {
                try {
                    const keys = JSON.parse(event.detail || "{}").keys || [];
                    if (keys.includes(HKEY) || keys.includes(RKEY)) window.__nsxRuntime.refreshHistory();
                } catch { }
            });
        }
    };

    const __vite_glob_0_9 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: history$1
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🎨 视觉美化 ] - 图片沉浸预览 (灯箱效果)
       ========================================================================== */
    // 图片预览

    const mark = new WeakSet();
    const bind = (els, ctx) => {
        els.forEach(img => {
            const post = img.closest("article.post-content");
            if (!post || mark.has(img)) return;
            mark.add(img);
            const newImg = img.cloneNode(true);
            img.replaceWith(newImg);
            mark.add(newImg);
            newImg.addEventListener("click", e => {
                e.preventDefault();
                const imgs = [...post.querySelectorAll("img:not(.sticker)")];
                const data = imgs.map((x, i) => ({ alt: x.alt, pid: i + 1, src: x.src }));
                ctx.ui.layer?.photos({ photos: { title: "图片预览", start: imgs.indexOf(newImg), data } });
            }, true);
        });
    };

    const imageSlide = {
        id: "imageSlide",
        deps: ["ui"],
        order: 160,
        cfg: { image_slide: { enabled: true } },
        meta: { image_slide: { label: "图片沉浸预览", group: "🎨 视觉美化" } },
        match: ctx => ctx.isPost && ctx.store.get("image_slide.enabled", true),
        init(ctx) { bind($$("article.post-content img:not(.sticker)"), ctx); },
        watch: ctx => ({ sel: "article.post-content img:not(.sticker)", fn: els => bind(els, ctx), opts: { debounce: 80 } })
    };

    const __vite_glob_0_10 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: imageSlide
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 网页预加载 (Instant Page)
       ========================================================================== */
    const instantPage = {
        id: "instantPage",
        order: 320,
        cfg: { instant_page: { enabled: true } },
        meta: { instant_page: { label: "鼠标悬停预加载", group: "🧭 辅助工具" } },
        match: ctx => ctx.store.get("instant_page.enabled", true) && !ctx.store.get("rules_compliance.enabled", true),
        init(ctx) {
            const done = new Set();
            const inflight = new Set();
            document.body.addEventListener("mouseover", e => {
                const a = e.target.closest("a");
                if (!a?.href?.startsWith(`${location.origin}/post-`) || done.has(a.href) || inflight.has(a.href)) return;
                setTimeout(() => {
                    if (!a.matches(":hover") || done.has(a.href) || inflight.has(a.href)) return;
                    const link = document.createElement("link");
                    link.rel = "prefetch";
                    link.href = a.href;
                    inflight.add(a.href);
                    const clear = () => {
                        done.add(a.href);
                        inflight.delete(a.href);
                        link.remove();
                    };
                    link.addEventListener("load", clear, { once: true });
                    link.addEventListener("error", clear, { once: true });
                    document.head.appendChild(link);
                    setTimeout(clear, 5000);
                }, 65);
            }, { passive: true });
        }
    };

    const __vite_glob_0_11 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: instantPage
    }, Symbol.toStringTag, { value: 'Module' }));

    // 等级标签已被移除
    const levelTag = {
        id: "levelTag",
        cfg: {},
        meta: {},
        match: ctx => false,
        init: () => { }
    };

    const __vite_glob_0_12 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: levelTag
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🔒 隐私与规则 ] - 链接净化
       ========================================================================== */
    const LINK_PURIFIER_DEFAULT_RULES = `
# 常见跟踪参数
@utm = utm_source, utm_medium, utm_campaign, utm_content, utm_term
@ad = ad_id, clickid, gclid, fbclid, sc_cid
@affiliate = aff, affiliate, partner, promo, promocode, coupon, subid, affid, aff_id
@track = aid, cid, tid, sid, ref_id, tag, via, from, source, campaign, channel

* >> @utm, @ad
*.youtube.com youtu.be >> si, feature, pp
*.bilibili.com b23.tv >> spm_id_from, from_source, from_spmid, seid, share_source, share_medium, share_plat, share_tag, share_session_id, share_from, bbid, ts, timestamp, unique_k, rt, tdsourcetag, spm, vd_source, trackid
*.amazon.com >> /\\/ref=[^\\/]+/

# 防止误删有业务含义的参数
~github.com ~gitlab.com ~gitee.com >> ref
~t.me ~telegram.me >> start
`.trim();
    const LINK_PURIFIER_SELECTOR = ".post-content a[href],.markdown-body a[href],.comment-content a[href]";

    /* LINK_PURIFIER_CORE_START */
    function parseLinkPurifierRules(text) {
        const rules = { allow: [], block: [], pathBlock: [] };
        const macros = {};
        String(text || "").split("\n").forEach(rawLine => {
            const line = rawLine.trim();
            if (!line || line.startsWith("#")) return;
            if (line.startsWith("@")) {
                const index = line.indexOf("=");
                if (index > 0) macros[line.slice(0, index).trim()] = line.slice(index + 1).split(",").map(value => value.trim()).filter(Boolean);
                return;
            }
            const index = line.indexOf(">>");
            if (index < 0) return;
            const scopeText = line.slice(0, index).trim();
            const parameterText = line.slice(index + 2).trim();
            if (!scopeText || !parameterText) return;
            const allow = scopeText.startsWith("~");
            const scopes = scopeText.split(/\s+/).map(scope => scope.replace(/^~/, "").toLowerCase()).filter(Boolean);
            parameterText.split(",").flatMap(value => macros[value.trim()] || [value.trim()]).filter(Boolean).forEach(parameter => {
                if (parameter.startsWith("/") && parameter.endsWith("/")) {
                    if (allow) return;
                    try { rules.pathBlock.push({ scopes, regex: new RegExp(parameter.slice(1, -1)) }); } catch { }
                    return;
                }
                let matcher;
                if (parameter === "*") matcher = () => true;
                else if (parameter.includes("*")) {
                    const escaped = parameter.split("*").map(value => value.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
                    const regex = new RegExp(`^${escaped}$`, "i");
                    matcher = value => regex.test(value);
                } else {
                    const normalized = parameter.toLowerCase();
                    matcher = value => String(value).toLowerCase() === normalized;
                }
                rules[allow ? "allow" : "block"].push({ scopes, matcher });
            });
        });
        return rules;
    }

    function purifyTrackedUrl(rawUrl, rules) {
        try {
            const url = new URL(rawUrl);
            if (!/^https?:$/.test(url.protocol)) return { url: rawUrl, removed: [] };
            const matchesScope = (hostname, scope) => {
                const normalized = scope.startsWith("*.") ? scope.slice(2) : scope;
                return scope === "*" || hostname === normalized || hostname.endsWith(`.${normalized}`);
            };
            const removed = [];
            const clean = value => {
                const parameters = new URLSearchParams(value);
                const names = [...new Set(parameters.keys())];
                const deletions = names.filter(name => {
                    const matches = list => list.some(rule => rule.scopes.some(scope => matchesScope(url.hostname.toLowerCase(), scope)) && rule.matcher(name));
                    return !matches(rules.allow) && matches(rules.block);
                });
                deletions.forEach(name => { parameters.delete(name); removed.push(name); });
                return deletions.length ? parameters.toString() : null;
            };
            const query = clean(url.search);
            if (query !== null) url.search = query;
            if (url.hash.includes("?")) {
                const index = url.hash.indexOf("?");
                const prefix = url.hash.slice(0, index);
                const hashQuery = clean(url.hash.slice(index + 1));
                if (hashQuery !== null) url.hash = hashQuery ? `${prefix}?${hashQuery}` : prefix;
            }
            let path = url.pathname;
            rules.pathBlock.forEach(rule => {
                if (rule.scopes.some(scope => matchesScope(url.hostname.toLowerCase(), scope))) path = path.replace(rule.regex, "");
            });
            if (path !== url.pathname) {
                url.pathname = path.replace(/\/{2,}/g, "/") || "/";
                removed.push("(path)");
            }
            return { url: removed.length ? url.toString() : rawUrl, removed };
        } catch { return { url: rawUrl, removed: [] }; }
    }

    function unwrapForumJump(rawUrl, forumOrigin) {
        try {
            let url = new URL(rawUrl, forumOrigin);
            let changed = false;
            for (let count = 0; count < 3 && url.origin === forumOrigin && url.pathname === "/jump" && url.searchParams.has("to"); count += 1) {
                url = new URL(url.searchParams.get("to"), forumOrigin);
                changed = true;
            }
            return { url: url.toString(), changed };
        } catch { return { url: rawUrl, changed: false }; }
    }
    /* LINK_PURIFIER_CORE_END */

    const openLinkPurifierRuleEditor = ctx => {
        if (!ctx.ui.layer) return;
        const wrap = document.createElement("div");
        wrap.style.padding = "14px";
        const textarea = document.createElement("textarea");
        textarea.id = "nsx-link-purifier-rules";
        textarea.className = "layui-textarea";
        textarea.style.cssText = "width:100%;height:min(62vh,420px);font-family:monospace;font-size:13px;line-height:1.55;resize:vertical;box-sizing:border-box";
        textarea.value = ctx.store.get("link_purifier.rules", LINK_PURIFIER_DEFAULT_RULES);
        wrap.appendChild(textarea);
        ctx.ui.layer.open({
            type: 1,
            title: "链接净化规则",
            area: [window.innerWidth <= 720 ? "96vw" : "660px", window.innerWidth <= 720 ? "82vh" : "540px"],
            content: wrap,
            btn: ["保存规则", "恢复默认", "取消"],
            yes(index) {
                ctx.store.set("link_purifier.rules", textarea.value.trim() || LINK_PURIFIER_DEFAULT_RULES);
                ctx.ui.layer.close(index);
                ctx.ui.success?.("链接净化规则已保存，刷新页面后生效");
            },
            btn2() { textarea.value = LINK_PURIFIER_DEFAULT_RULES; return false; }
        });
    };

    const linkPurifier = {
        id: "linkPurifier",
        order: 370,
        cfg: {
            link_purifier: {
                enabled: true,
                mark_external: true,
                force_blank: true,
                edit_rules: ""
            }
        },
        meta: {
            link_purifier: {
                label: "链接净化",
                group: "🔒 隐私与规则",
                hidden: ["rules"],
                fields: {
                    mark_external: { type: "SWITCH", label: "标记外部链接" },
                    force_blank: { type: "SWITCH", label: "外链新标签页打开" },
                    edit_rules: { type: "BUTTON", label: "净化规则", buttonText: "编辑规则", action: "link_purifier:edit_rules" }
                }
            }
        },
        match: () => true,
        init(ctx) {
            document.addEventListener("nsx-action", event => {
                if (event.detail === "link_purifier:edit_rules") openLinkPurifierRuleEditor(ctx);
            });
            if (!ctx.store.get("link_purifier.enabled", true)) return;
            const icon = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6'/%3E%3Cpath d='M15 3h6v6M10 14 21 3'/%3E%3C/svg%3E")`;
            addStyle("nsx-link-purifier", `a.nsx-external-link::after{content:"";display:inline-block;width:12px;height:12px;margin-left:4px;background:${icon} no-repeat center/contain;vertical-align:middle;opacity:.72}a.nsx-cleaned-link{border-bottom:1px dashed #28a745!important;text-decoration:none}`);
            const markExternal = ctx.store.get("link_purifier.mark_external", true);
            const forceBlank = ctx.store.get("link_purifier.force_blank", true);
            const rules = parseLinkPurifierRules(ctx.store.get("link_purifier.rules", LINK_PURIFIER_DEFAULT_RULES));
            const processed = new WeakMap();

            const processLink = async anchor => {
                const originalHref = anchor.getAttribute("href");
                if (!originalHref || processed.get(anchor) === originalHref) return;
                const jump = unwrapForumJump(originalHref, location.origin);
                let url;
                try { url = new URL(jump.url, location.href); } catch { return; }
                if (!/^https?:$/.test(url.protocol)) return;
                const notes = [];
                if (jump.changed) notes.push("已绕过论坛跳转页");
                const purified = purifyTrackedUrl(url.toString(), rules);
                if (purified.removed.length) {
                    url = new URL(purified.url);
                    notes.push(`已移除：${purified.removed.join(", ")}`);
                }
                if (notes.length) {
                    anchor.href = url.toString();
                    anchor.classList.add("nsx-cleaned-link");
                    if (!anchor.title) anchor.title = notes.join("\n");
                }
                const external = url.hostname.toLowerCase() !== location.hostname.toLowerCase();
                if (external && markExternal) anchor.classList.add("nsx-external-link");
                if (external && forceBlank) {
                    anchor.target = "_blank";
                    anchor.rel = [...new Set(`${anchor.rel || ""} noopener noreferrer`.trim().split(/\s+/))].join(" ");
                }
                processed.set(anchor, anchor.getAttribute("href"));
            };

            const enqueue = root => {
                if (root instanceof HTMLAnchorElement && root.matches(LINK_PURIFIER_SELECTOR)) processLink(root);
                root?.querySelectorAll?.(LINK_PURIFIER_SELECTOR).forEach(processLink);
            };
            enqueue(document);
            const root = document.body || document.documentElement;
            if (root) new MutationObserver(mutations => mutations.forEach(mutation => {
                if (mutation.type === "attributes") enqueue(mutation.target);
                else mutation.addedNodes.forEach(node => { if (node.nodeType === 1) enqueue(node); });
            })).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
        }
    };

    const __vite_glob_0_25 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: linkPurifier
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 系统核心 ] - 设置菜单 (高级设置面板)
       ========================================================================== */
    // 菜单系统（油猴菜单 + 高级设置面板）

    const CSS$1 = `
      #setting-layer-direction-r{
        --nsx-cfg-accent:#ff4f00;
        --nsx-cfg-ink:#111111;
        --nsx-cfg-muted:#666b73;
        --nsx-cfg-line:#dedfe2;
        --nsx-cfg-soft:#f7f7f8;
        --nsx-cfg-surface:#ffffff;
        border-left:4px solid var(--nsx-cfg-accent)!important;
        background:var(--nsx-cfg-surface)!important;
        box-shadow:none!important;
        max-width:100vw!important;
        box-sizing:border-box;
        font-family:"Helvetica Neue",Helvetica,Arial,"PingFang SC","Microsoft YaHei",sans-serif;
        letter-spacing:0!important;
      }
      #setting-layer-direction-r *{box-sizing:border-box;letter-spacing:0!important}
      #setting-layer-direction-r .layui-layer-title{
        height:64px;line-height:64px;padding:0 62px 0 24px;border-bottom:1px solid var(--nsx-cfg-line);
        background:var(--nsx-cfg-surface);color:var(--nsx-cfg-ink);font-size:20px;font-weight:700;
      }
      #setting-layer-direction-r .layui-layer-setwin{top:12px;right:12px;width:40px;height:40px}
      #setting-layer-direction-r .layui-layer-setwin .layui-layer-close{
        position:relative!important;inset:auto!important;display:block;width:40px!important;height:40px!important;margin:0!important;background:none!important;
      }
      #setting-layer-direction-r .layui-layer-setwin .layui-layer-close::before,
      #setting-layer-direction-r .layui-layer-setwin .layui-layer-close::after{
        position:absolute;top:19px;left:10px;width:20px;height:1px;background:var(--nsx-cfg-ink);content:"";transform:rotate(45deg);
      }
      #setting-layer-direction-r .layui-layer-setwin .layui-layer-close::after{transform:rotate(-45deg)}
      #setting-layer-direction-r .layui-layer-content{background:var(--nsx-cfg-surface)}
      #setting-layer-direction-r .layui-layer-btn{
        height:64px;padding:11px 20px;border-top:1px solid var(--nsx-cfg-line);background:var(--nsx-cfg-surface);
      }
      #setting-layer-direction-r .layui-layer-btn a{
        min-width:96px;height:40px;line-height:38px;margin:0 0 0 8px;border:1px solid var(--nsx-cfg-ink);
        border-radius:4px;background:var(--nsx-cfg-surface);color:var(--nsx-cfg-ink);font-size:14px;font-weight:600;
      }
      #setting-layer-direction-r .layui-layer-btn .layui-layer-btn0{
        border-color:var(--nsx-cfg-accent);background:var(--nsx-cfg-accent);color:#fff;
      }
      #nsx-config-shell{display:flex;height:100%;min-height:0;background:var(--nsx-cfg-surface);color:var(--nsx-cfg-ink)}
      #nsx-config-menu{
        width:210px;min-width:210px;height:100%;overflow-y:auto;border:0;border-right:1px solid var(--nsx-cfg-line);
        background:var(--nsx-cfg-surface);scrollbar-width:thin;
      }
      .nsx-config-brand{display:flex;align-items:center;gap:11px;min-height:82px;padding:16px 18px;border-bottom:1px solid var(--nsx-cfg-line)}
      .nsx-config-brand-mark{
        display:flex;align-items:center;justify-content:center;width:42px;height:42px;flex:0 0 42px;
        border-left:5px solid var(--nsx-cfg-ink);background:var(--nsx-cfg-soft);color:var(--nsx-cfg-ink);font-size:24px;font-weight:700;
      }
      .nsx-config-brand-copy{min-width:0;line-height:1.2}
      .nsx-config-brand-copy strong{display:block;overflow:hidden;text-overflow:ellipsis;color:var(--nsx-cfg-ink);font-size:15px;white-space:nowrap}
      .nsx-config-brand-copy small{display:block;margin-top:5px;color:var(--nsx-cfg-muted);font-size:11px;font-variant-numeric:tabular-nums}
      #nsx-config-menu .layui-menu{padding:10px 0;background:transparent;border:0}
      #nsx-config-menu .layui-menu li{min-height:0;margin:0;background:transparent!important}
      #nsx-config-menu .layui-menu-body-title{padding:0!important}
      #nsx-config-menu .layui-menu a{
        display:grid;grid-template-columns:28px 24px minmax(0,1fr) 30px;align-items:center;gap:6px;min-height:46px;
        padding:7px 12px 7px 17px;border-left:3px solid transparent;color:var(--nsx-cfg-muted);text-decoration:none;
      }
      #nsx-config-menu .layui-menu a:hover{background:var(--nsx-cfg-soft);color:var(--nsx-cfg-ink)}
      #nsx-config-menu .layui-menu-item-checked>a{
        border-left-color:var(--nsx-cfg-accent);background:var(--nsx-cfg-soft);color:var(--nsx-cfg-ink);font-weight:700;
      }
      .nsx-config-menu-index{color:var(--nsx-cfg-accent);font-size:11px;font-weight:700;font-variant-numeric:tabular-nums}
      .nsx-config-menu-emoji{display:inline-flex;align-items:center;justify-content:center;width:24px;font-size:15px;line-height:1}
      .nsx-config-menu-label{min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:13px;white-space:nowrap}
      .nsx-config-menu-count{
        display:inline-flex;align-items:center;justify-content:center;justify-self:center;width:28px;height:22px;overflow:hidden;
        border:1px solid var(--nsx-cfg-line);border-radius:4px;background:var(--nsx-cfg-surface);color:var(--nsx-cfg-muted);
        font-size:10px;line-height:1;font-variant-numeric:tabular-nums;
      }
      .nsx-config-workspace{display:flex;flex:1 1 auto;min-width:0;min-height:0;flex-direction:column;background:var(--nsx-cfg-soft)}
      #nsx-config-content{
        flex:1 1 auto;min-width:0;height:auto;overflow-y:auto;padding:0 24px 36px;background:var(--nsx-cfg-soft);
        scroll-behavior:smooth;scrollbar-width:thin;
      }
      .nsx-config-section{margin:0;padding:0;border:0;scroll-margin-top:16px}
      .nsx-config-section-header{
        display:grid;grid-template-columns:42px minmax(0,1fr);align-items:center;gap:10px;min-height:84px;
        padding:18px 0 12px;border-bottom:1px solid var(--nsx-cfg-line);
      }
      .nsx-config-section-index{color:var(--nsx-cfg-accent);font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
      .nsx-config-section-title{display:flex;align-items:center;gap:8px;margin:0;color:var(--nsx-cfg-ink);font-size:19px;line-height:1.25}
      .nsx-config-section-emoji{display:inline-flex;align-items:center;justify-content:center;width:24px;font-size:19px;line-height:1}
      .nsx-config-section-meta{margin:4px 0 0;color:var(--nsx-cfg-muted);font-size:11px}
      .nsx-config-section-list{background:var(--nsx-cfg-surface)}
      .nsx-config-card{
        display:block;margin:0;border:0;border-bottom:1px solid var(--nsx-cfg-line);border-radius:0;background:var(--nsx-cfg-surface);box-shadow:none;
      }
      .nsx-config-card-header{
        display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:18px;min-height:58px;
        padding:12px 16px;color:var(--nsx-cfg-ink);font-size:14px;font-weight:700;line-height:1.45;
      }
      .nsx-config-card-header .header-checkbox{position:static;align-self:center;justify-self:end;transform:none}
      .nsx-config-card .layui-form-switch{margin-top:0!important;border-color:#bfc1c5;background:#bfc1c5}
      .nsx-config-card .layui-form-onswitch{border-color:var(--nsx-cfg-accent)!important;background:var(--nsx-cfg-accent)!important}
      .nsx-config-card .layui-form-radio:hover>*,.nsx-config-card .layui-form-radioed>*{color:var(--nsx-cfg-accent)!important}
      .nsx-config-card-body{
        display:grid!important;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px 18px;
        padding:4px 16px 16px!important;border-top:1px solid #efeff1;
      }
      .nsx-config-card-body:empty{display:none!important;padding:0!important;border:0}
      .nsx-config-card-body>[class*="layui-col-md"]{float:none!important;width:auto!important;padding:0!important}
      .nsx-config-card-body>.layui-col-md12{grid-column:span 12}.nsx-config-card-body>.layui-col-md6{grid-column:span 6}
      .nsx-config-card-body>.layui-col-md4{grid-column:span 4}.nsx-config-card-body>.layui-col-md3{grid-column:span 3}
      .nsx-config-card .layui-form-item{
        display:grid;grid-template-columns:minmax(112px,38%) minmax(0,1fr);align-items:center;gap:12px;
        min-width:0;margin:0;padding-top:12px;
      }
      .nsx-config-card .layui-form-label{
        float:none!important;width:auto!important;min-width:0;padding:0!important;color:var(--nsx-cfg-muted);
        font-size:12px;line-height:1.45;text-align:left!important;overflow-wrap:anywhere;
      }
      .nsx-config-card .layui-input-block{min-width:0;min-height:0;margin-left:0!important}
      .nsx-config-card .layui-input,.nsx-config-card .layui-textarea,.nsx-config-card select{
        width:100%;border-color:#cfd1d5;border-radius:4px;background:var(--nsx-cfg-surface);color:var(--nsx-cfg-ink);font-size:13px;
      }
      .nsx-config-card .layui-input:focus,.nsx-config-card .layui-textarea:focus{border-color:var(--nsx-cfg-accent)!important}
      .nsx-config-card .layui-textarea{min-height:92px;resize:vertical}
      .nsx-config-card .layui-btn{height:36px;line-height:34px;border-radius:4px;font-size:13px}
      .nsx-config-card .layui-btn-normal{border-color:var(--nsx-cfg-accent);background:var(--nsx-cfg-accent)}
      .nsx-config-card .layui-btn-primary{border-color:var(--nsx-cfg-ink);background:var(--nsx-cfg-surface);color:var(--nsx-cfg-ink)}
      .nsx-config-card .layui-disabled{opacity:.45}
      .nsx-config-tools{display:flex;gap:10px;flex-wrap:wrap}
      .nsx-config-tools .layui-btn{min-width:112px;margin:0}
      .nsx-config-tools-tip{max-width:620px;margin-top:10px;color:var(--nsx-cfg-muted);font-size:12px;line-height:1.65}
      .nsx-config-backup-body{display:block!important}
      .nsx-config-end{padding:28px 0 4px;color:var(--nsx-cfg-muted);font-size:11px;text-align:center}
      .dark-layout #setting-layer-direction-r{
        --nsx-cfg-ink:#f5f5f5;--nsx-cfg-muted:#aaadb3;--nsx-cfg-line:#35363a;--nsx-cfg-soft:#161719;--nsx-cfg-surface:#0f1011;
      }
      .dark-layout #setting-layer-direction-r .nsx-config-card-body{border-top-color:#242529}
      .dark-layout #setting-layer-direction-r .nsx-config-card .layui-input,
      .dark-layout #setting-layer-direction-r .nsx-config-card .layui-textarea,
      .dark-layout #setting-layer-direction-r .nsx-config-card select{border-color:#4a4c52}
      @media(max-width:900px){
        #nsx-config-menu{width:188px;min-width:188px}
        #nsx-config-content{padding-left:18px;padding-right:18px}
        .nsx-config-card-body>.layui-col-md6,.nsx-config-card-body>.layui-col-md4,.nsx-config-card-body>.layui-col-md3{grid-column:span 12}
      }
      @media(max-width:720px){
        #setting-layer-direction-r{right:0!important;width:100vw!important;max-width:100vw!important;height:100vh!important;height:100dvh!important;border-left:0!important;border-top:4px solid var(--nsx-cfg-accent)!important;box-sizing:border-box}
        #setting-layer-direction-r .layui-layer-title{height:56px;line-height:56px;padding-left:16px;font-size:18px}
        #setting-layer-direction-r .layui-layer-setwin{top:8px;right:8px}
        #setting-layer-direction-r .layui-layer-btn{height:64px;padding:10px 12px;padding-bottom:max(10px,env(safe-area-inset-bottom))}
        #setting-layer-direction-r .layui-layer-btn a{min-width:88px;min-height:42px;line-height:40px}
        #nsx-config-shell{flex-direction:column}
        #nsx-config-menu{width:100%;min-width:0;height:auto;max-height:none;overflow:visible;border-right:0;border-bottom:1px solid var(--nsx-cfg-line)}
        .nsx-config-brand{display:none}
        #nsx-config-menu .layui-menu{display:flex;gap:0;overflow-x:auto;padding:0;-webkit-overflow-scrolling:touch;scrollbar-width:none}
        #nsx-config-menu .layui-menu::-webkit-scrollbar{display:none}
        #nsx-config-menu .layui-menu li{flex:0 0 auto}
        #nsx-config-menu .layui-menu a{grid-template-columns:auto 20px auto;gap:6px;min-height:46px;padding:8px 13px;border-left:0;border-bottom:3px solid transparent}
        #nsx-config-menu .layui-menu-item-checked>a{border-bottom-color:var(--nsx-cfg-accent)}
        .nsx-config-menu-emoji{width:20px;font-size:14px}
        .nsx-config-menu-count{display:none}
        .nsx-config-workspace{min-height:0}
        #nsx-config-content{padding:0 12px 28px;-webkit-overflow-scrolling:touch}
        .nsx-config-section-header{grid-template-columns:36px minmax(0,1fr);min-height:70px;padding:14px 0 10px}
        .nsx-config-section-index{font-size:20px}
        .nsx-config-section-title{font-size:17px}
        .nsx-config-card-header{min-height:56px;padding:10px 12px;font-size:14px}
        .nsx-config-card-body{grid-template-columns:1fr;gap:10px;padding:2px 12px 14px!important}
        .nsx-config-card-body>[class*="layui-col-md"]{grid-column:1!important}
        .nsx-config-card .layui-form-item{grid-template-columns:1fr;gap:6px;padding-top:10px}
        .nsx-config-card .layui-input,.nsx-config-card .layui-textarea,.nsx-config-card select{min-height:44px;font-size:16px!important}
        .nsx-config-card .layui-form-label{font-size:12px}
        .nsx-config-card .layui-form-switch{min-height:30px}
        .nsx-config-tools .layui-btn{min-width:0;min-height:42px;flex:1 1 120px}
      }
    `;

    const el = (t, c, p, s) => { const e = document.createElement(t); if (c) e.className = c; if (s) e.style.cssText = s; if (p) p.appendChild(e); return e; };
    const BACKUP_SCHEMA_VERSION = 2;
    const BACKUP_LOCAL_KEYS = [
        "nsx_advanced_keywords",
        "nsx_browsing_history",
        "nsx_recently_closed",
        "nodeseek_quick_reply",
        "nodeseek_quick_reply_auto_submit",
        "nsx_advanced_friends",
        "nsx_advanced_blacklist",
        "nsx_visited_posts"
    ];
    const BACKUP_PLAIN_STRING_KEYS = new Set(["nodeseek_quick_reply_auto_submit"]);
    const BACKUP_NS_PREFERENCE_DB = "ns-preference-db";
    const BACKUP_NS_PREFERENCE_STORE = "ns-preference-store";
    const cloneData = v => {
        try { return JSON.parse(JSON.stringify(v)); } catch { return v; }
    };
    const normalizeSettingsForBackup = (settings) => {
        const normalized = cloneData(settings || {});
        merge(normalized, store.getDefaults());
        normalized.version = store.getDefaults().version;
        return normalized;
    };
    const readBackupLocalValue = key => {
        const raw = localStorage.getItem(key);
        if (raw == null) return null;
        if (BACKUP_PLAIN_STRING_KEYS.has(key)) return raw;
        try { return JSON.parse(raw); } catch { return raw; }
    };
    const writeBackupLocalValue = (key, value) => {
        if (value == null) localStorage.removeItem(key);
        else if (BACKUP_PLAIN_STRING_KEYS.has(key)) localStorage.setItem(key, String(value));
        else localStorage.setItem(key, JSON.stringify(value));
    };
    const readNsPreferenceConfig = () => new Promise(resolve => {
        try {
            const req = indexedDB.open(BACKUP_NS_PREFERENCE_DB);
            req.onerror = () => resolve(null);
            req.onupgradeneeded = () => resolve(null);
            req.onsuccess = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(BACKUP_NS_PREFERENCE_STORE)) {
                    db.close();
                    return resolve(null);
                }
                const tx = db.transaction(BACKUP_NS_PREFERENCE_STORE, "readonly");
                const store = tx.objectStore(BACKUP_NS_PREFERENCE_STORE);
                const getReq = store.get("configuration");
                getReq.onerror = () => { db.close(); resolve(null); };
                getReq.onsuccess = () => {
                    const cfg = getReq.result;
                    db.close();
                    resolve(cfg && typeof cfg === "object" ? cloneData(cfg) : null);
                };
            };
        } catch {
            resolve(null);
        }
    });
    const writeNsPreferenceConfig = (config) => new Promise(resolve => {
        try {
            const req = indexedDB.open(BACKUP_NS_PREFERENCE_DB);
            req.onerror = () => resolve(false);
            req.onsuccess = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(BACKUP_NS_PREFERENCE_STORE)) {
                    db.close();
                    return resolve(false);
                }
                const tx = db.transaction(BACKUP_NS_PREFERENCE_STORE, "readwrite");
                const store = tx.objectStore(BACKUP_NS_PREFERENCE_STORE);
                const putReq = store.put(config || {}, "configuration");
                putReq.onerror = () => { db.close(); resolve(false); };
                putReq.onsuccess = () => { db.close(); resolve(true); };
            };
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(BACKUP_NS_PREFERENCE_STORE)) {
                    db.createObjectStore(BACKUP_NS_PREFERENCE_STORE);
                }
            };
        } catch {
            resolve(false);
        }
    });
    const createBackupPayload = async () => ({
        format: "nsx-backup",
        schemaVersion: BACKUP_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        scriptVersion: info.version,
        data: {
            settings: normalizeSettingsForBackup(store.init()),
            localStorage: BACKUP_LOCAL_KEYS.reduce((acc, key) => {
                const value = readBackupLocalValue(key);
                if (value !== null) acc[key] = cloneData(value);
                return acc;
            }, {}),
            indexedDB: {
                nsPreferenceConfiguration: await readNsPreferenceConfig()
            }
        }
    });
    const isValidBackupPayload = payload => {
        if (!payload || typeof payload !== "object") return false;
        if (payload.format !== "nsx-backup") return false;
        if (!payload.data || typeof payload.data !== "object") return false;
        if (!payload.data.settings || typeof payload.data.settings !== "object" || Array.isArray(payload.data.settings)) return false;
        const ls = payload.data.localStorage;
        if (!(ls === undefined || (ls && typeof ls === "object" && !Array.isArray(ls)))) return false;
        const idb = payload.data.indexedDB;
        return idb === undefined || (idb && typeof idb === "object" && !Array.isArray(idb));
    };
    const applyBackupPayload = async (payload) => {
        const importedSettings = normalizeSettingsForBackup(payload?.data?.settings || {});
        const importedLs = payload?.data?.localStorage || {};
        const importedIdb = payload?.data?.indexedDB || {};
        const schemaVersion = Number(payload?.schemaVersion || 1);
        const shouldClearMissingLocalKeys = schemaVersion >= BACKUP_SCHEMA_VERSION;
        cfgCache = null;
        GM_setValue("settings", importedSettings);
        BACKUP_LOCAL_KEYS.forEach(key => {
            if (Object.prototype.hasOwnProperty.call(importedLs, key)) writeBackupLocalValue(key, importedLs[key]);
            else if (shouldClearMissingLocalKeys) localStorage.removeItem(key);
        });
        if (Object.prototype.hasOwnProperty.call(importedIdb, "nsPreferenceConfiguration") && importedIdb.nsPreferenceConfiguration && typeof importedIdb.nsPreferenceConfiguration === "object") {
            await writeNsPreferenceConfig(importedIdb.nsPreferenceConfiguration);
        } else if (schemaVersion >= 2) {
            await writeNsPreferenceConfig({ openPostInNewPage: !!importedSettings?.open_post_in_new_tab?.enabled });
        }
        cfgCache = null;
    };
    const downloadBackupFile = payload => {
        const stamp = new Date().toISOString().replace(/[:T]/g, "-").replace(/\..+/, "");
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `NSX_Pro_backup_${stamp}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const menus = {
        id: "menus",
        deps: ["ui"],
        order: 30,
        cfg: { open_post_in_new_tab: { enabled: false } },
        meta: { open_post_in_new_tab: { label: "新标签页打开帖子", group: "🧭 辅助工具" } },
        match: () => true,
        init(ctx) {
            const uw = ctx.uw, code = ctx.site?.code || "ns";
            const ids = [];
            const txt = (m, v) => `${m.text} · ${m.states[v].s2}`;


            const regMenus = () => {
                ids.splice(0).forEach(i => GM_unregisterMenuCommand(i));
                menuItems.forEach(m => {
                    let lbl = m.text;
                    if (m.states.length > 0) {
                        let v = 0;
                        if (m.name === "sign_in") v = store.get(`sign_in.${code}.method`, 0);
                        else v = store.get(`${m.name}.enabled`, true) === false ? 0 : 1;
                        lbl = txt(m, v);
                    }
                    const id = GM_registerMenuCommand(lbl, () => m.cb(m.name, m.states), { autoClose: m.autoClose ?? true });
                    ids.push(id || lbl);
                });
            };

            const switchState = (n, states) => {
                if (n === "sign_in") {
                    if (!ctx.site) return;
                    let cur = store.get(`sign_in.${code}.method`, 0);
                    cur = (cur + 1) % states.length;
                    store.set(`sign_in.${code}.enabled`, cur !== 0);
                    store.set(`sign_in.${code}.method`, cur || 1);
                } else if (n === "loading_post") {
                    const next = !store.get("loading_post.enabled", true);
                    store.set("loading_post.enabled", next);
                    store.set("loading_comment.enabled", next);
                } else {
                    store.set(`${n}.enabled`, !store.get(`${n}.enabled`, true));
                }
                regMenus();
            };

            const reSign = () => {
                if (!ctx.loggedIn || store.get(`sign_in.${code}.enabled`, true) === false) return ctx.ui.alert("提示", "签到已关闭");
                store.set(`sign_in.${code}.last_date`, "1753/1/1");
                location.reload();
            };

            const exportConfig = async () => {
                try {
                    const payload = await createBackupPayload();
                    downloadBackupFile(payload);
                    ctx.ui.success?.("配置已导出");
                } catch (e) {
                    env.error("Export config failed", e);
                    ctx.ui.error?.("导出失败，请稍后重试");
                }
            };

            const importConfig = () => {
                const input = document.createElement("input");
                input.type = "file";
                input.accept = "application/json,.json";
                input.style.display = "none";
                input.onchange = () => {
                    const file = input.files?.[0];
                    if (!file) return input.remove();
                    const reader = new FileReader();
                    reader.onload = () => {
                        try {
                            const payload = JSON.parse(String(reader.result || ""));
                            if (!isValidBackupPayload(payload)) throw new Error("备份文件格式不正确");
                            const proceed = async () => {
                                try {
                                    await applyBackupPayload(payload);
                                    ctx.ui.success?.("配置已还原，页面即将刷新");
                                    setTimeout(() => location.reload(), 600);
                                } catch (e) {
                                    env.error("Import config apply failed", e);
                                    ctx.ui.error?.("还原失败，请检查备份文件");
                                }
                            };
                            const msg = "将覆盖当前脚本设置、关键词、浏览历史、快捷回复和社交关系数据，是否继续？";
                            if (window.confirm(msg)) proceed();
                        } catch (e) {
                            env.error("Import config parse failed", e);
                            ctx.ui.error?.(e?.message || "备份文件解析失败");
                        } finally {
                            input.remove();
                        }
                    };
                    reader.onerror = () => {
                        input.remove();
                        ctx.ui.error?.("读取备份文件失败");
                    };
                    reader.readAsText(file, "utf-8");
                };
                document.body.appendChild(input);
                input.click();
            };

            const bindBackupTools = (root) => {
                const exportBtn = root?.querySelector?.("[data-nsx-action='export-config']");
                const importBtn = root?.querySelector?.("[data-nsx-action='import-config']");
                if (exportBtn && !exportBtn.dataset.nsxBound) {
                    exportBtn.dataset.nsxBound = "1";
                    exportBtn.addEventListener("click", e => {
                        e.preventDefault();
                        exportConfig();
                    });
                }
                if (importBtn && !importBtn.dataset.nsxBound) {
                    importBtn.dataset.nsxBound = "1";
                    importBtn.addEventListener("click", e => {
                        e.preventDefault();
                        importConfig();
                    });
                }
            };
            const bindModuleActions = root => {
                root?.querySelectorAll?.("[data-nsx-module-action]").forEach(button => {
                    if (button.dataset.nsxActionBound === "1") return;
                    button.dataset.nsxActionBound = "1";
                    button.addEventListener("click", event => {
                        event.preventDefault();
                        event.stopPropagation();
                        document.dispatchEvent(new CustomEvent("nsx-action", { detail: button.dataset.nsxModuleAction }));
                    });
                });
            };

            const switchNewTab = () => {
                const next = !store.get("open_post_in_new_tab.enabled", false);
                try {
                    uw.indexedDB.open("ns-preference-db").onsuccess = e => {
                        const db = e.target.result;
                        const s = db.transaction("ns-preference-store", "readwrite").objectStore("ns-preference-store");
                        s.get("configuration").onsuccess = e2 => {
                            const c = e2.target.result || {};
                            c.openPostInNewPage = next;
                            s.put(c, "configuration");
                            store.set("open_post_in_new_tab.enabled", next);
                            regMenus();
                            ctx.ui.alert("", `已${next ? "开启" : "关闭"}新标签页打开链接`);
                        };
                    };
                } catch { }
            };

            const advSettings = () => {
                if (!ctx.ui.layer || !window.layui) return;
                addStyle("nsx-cfg", CSS$1);

                // 获取所有模块的 cfg 和 meta
                const defs = store.getDefaults(), metas = store.getMeta();
                const ignore = new Set(["version", "debug", "ui"]);

                // 建立 meta key 到 order 的映射关系
                const metaToOrder = new Map();
                modules.forEach(m => {
                    if (m.meta) {
                        Object.keys(m.meta).forEach(k => metaToOrder.set(k, m.order || 999));
                    }
                });

                // 获取所有设置条目并附加 order
                const entries = Object.entries(metas)
                    .filter(([k]) => defs[k] && !ignore.has(k))
                    .map(([k, m]) => ({
                        key: k,
                        meta: m,
                        order: metaToOrder.get(k) || 999
                    }));

                // 核心：按照 order 从小到大排序
                entries.sort((a, b) => a.order - b.order);

                const groups = {};
                const groupOrder = []; // 记录分组出现的先后顺序
                entries.forEach(e => {
                    const g = e.meta.group || "其他设置";
                    if (!groups[g]) {
                        groups[g] = [];
                        groupOrder.push(g);
                    }
                    groups[g].push(e);
                });

                const cleanUiLabel = value => String(value || "").replace(/^[^A-Za-z0-9\u3400-\u9fff]+/, "").trim();
                const categoryEmoji = Object.freeze({
                    "隐私与规则": "🔒",
                    "基础功能": "⚙️",
                    "视觉美化": "🎨",
                    "辅助工具": "🧰",
                    "帖子阅读": "📖",
                    "过滤设置": "🚫",
                    "社交关系": "🤝",
                    "NodeSeek抽奖": "🎁",
                    "配置备份": "💾",
                    "其他设置": "⚙️"
                });
                const emojiForCategory = label => categoryEmoji[label] || "⚙️";
                const sectionIndex = index => String(index + 1).padStart(2, "0");
                const cont = document.createElement("div");
                cont.id = "nsx-config-shell";
                const menuDiv = el("aside", "", cont);
                menuDiv.id = "nsx-config-menu";
                const brand = el("div", "nsx-config-brand", menuDiv);
                const brandMark = el("span", "nsx-config-brand-mark", brand); brandMark.textContent = "M";
                const brandCopy = el("span", "nsx-config-brand-copy", brand);
                const brandName = el("strong", "", brandCopy); brandName.textContent = "Max-iSen";
                const brandVersion = el("small", "", brandCopy); brandVersion.textContent = `v${info.version || ""}`;
                const menuList = el("ul", "layui-menu", menuDiv);
                const workspace = el("main", "nsx-config-workspace", cont);
                const wrapper = el("div", "", workspace);
                wrapper.id = "nsx-config-content";

                const isObj = v => v && typeof v === "object" && !Array.isArray(v);
                const inferType = (v, m) => m?.type || (Array.isArray(v) ? "TEXTAREA" : typeof v === "boolean" ? "SWITCH" : typeof v === "number" ? "NUMBER" : "TEXT");
                const inferVT = (v, m) => m?.valueType || (Array.isArray(v) ? "array" : typeof v === "number" ? "number" : typeof v === "boolean" ? "boolean" : "string");

                const makeField = (f, path, val, defaultCol = 12) => {
                    const col = f.col ?? defaultCol;
                    const w = el("div", `layui-col-md${col} nsx-config-field`), item = el("div", "layui-form-item nsx-config-field-item", w);
                    const lbl = el("label", "layui-form-label", item); lbl.textContent = f.label || f.key;
                    if (f.desc) {
                        const help = el("span", "layui-icon layui-icon-help", lbl);
                        help.title = f.desc;
                        help.style.cssText = "margin-left:5px;color:#999;cursor:help";
                    }
                    const blk = el("div", "layui-input-block", item);

                    if (f.type === "SWITCH") {
                        item.classList.add("nsx-config-field-switch");
                        let inp = el("input", "", blk); inp.type = "checkbox"; if (val) inp.setAttribute("checked", ""); inp.setAttribute("lay-skin", "switch"); inp.setAttribute("lay-text", "开启|关闭"); inp.name = path;
                    }
                    else if (f.type === "TEXTAREA") { let inp = el("textarea", "layui-textarea", blk); inp.setAttribute("placeholder", f.placeholder || ""); inp.textContent = Array.isArray(val) ? val.join("\n") : (val ?? ""); inp.name = path; }
                    else if (f.type === "RADIO" && f.options) {
                        f.options.forEach(opt => {
                            const r = el("input", "", blk); r.type = "radio"; r.name = path; r.setAttribute("value", opt.value);
                            r.dataset.valueType = f.valueType || "";
                            if (String(val) === String(opt.value)) r.setAttribute("checked", "");
                            r.setAttribute("title", opt.text);
                        });
                    }
                    else if (f.type === "SELECT" && f.options) {
                        const sel = el("select", "", blk); sel.name = path;
                        sel.dataset.valueType = f.valueType || "";
                        const options = Array.isArray(f.options)
                            ? f.options.map(option => [option.value, option.text])
                            : Object.entries(f.options);
                        options.forEach(([k, v]) => {
                            const opt = el("option", "", sel);
                            opt.value = k; opt.textContent = v;
                            if (String(val) === String(k)) opt.setAttribute("selected", "selected");
                        });
                    }
                    else if (f.type === "COLOR") {
                        const inpWrap = el("div", "layui-input-inline", blk); inpWrap.style.width = "100px";
                        let inp = el("input", "layui-input", inpWrap);
                        inp.type = "text";
                        inp.setAttribute("name", path);
                        inp.setAttribute("value", val ?? "");
                        inp.readOnly = true;
                        inp.style.cssText = `background:${val || "#fff"};cursor:pointer;color:transparent`;
                        const cpWrap = el("div", "layui-inline", blk); cpWrap.style.left = "-11px";
                        const wrap = el("div", "", cpWrap);
                        wrap.setAttribute("data-color-path", path);
                        wrap.setAttribute("data-color-val", val ?? "");
                        wrap.setAttribute("data-color-inp", path);
                        wrap.setAttribute("data-color-default", f.defaultVal ?? "");
                    }
                    else if (f.type === "BUTTON") {
                        const button = el("button", "layui-btn layui-btn-primary layui-btn-sm", blk);
                        button.type = "button";
                        button.textContent = f.buttonText || "执行";
                        if (f.action) button.dataset.nsxModuleAction = f.action;
                    }
                    else {
                        let inp = el("input", "layui-input", blk);
                        const sensitive = /(api[_-]?key|token|secret|password|webhook)/i.test(path);
                        inp.type = f.type === "NUMBER" ? "number" : sensitive ? "password" : "text";
                        if (sensitive) inp.autocomplete = "off";
                        inp.setAttribute("value", val ?? "");
                        inp.setAttribute("name", path);
                        inp.dataset.valueType = f.valueType || "";
                    }

                    const firstInp = w.querySelector("input, textarea, select");
                    if (firstInp && !firstInp.dataset.valueType) firstInp.dataset.valueType = f.valueType || "";
                    return w;
                };

                const makeCard = (entry, siteCode) => {
                    const m = entry.meta || {};
                    let base = entry.key, cfg = defs[entry.key];
                    if (entry.key === "sign_in") { cfg = defs.sign_in?.[siteCode] || defs.sign_in?.ns || {}; base = `sign_in.${siteCode}`; }
                    if (!isObj(cfg)) return null;
                    const card = el("section", "layui-form nsx-config-card");
                    card.setAttribute("lay-filter", `nsx-${entry.key}`);
                    const hdr = el("div", "nsx-config-card-header", card); hdr.textContent = m.label || entry.key;
                    if (typeof cfg.enabled === "boolean") {
                        const cbW = el("div", "header-checkbox", hdr), cb = el("input", "", cbW);
                        cb.type = "checkbox"; cb.name = `${base}.enabled`; if (store.get(`${base}.enabled`, cfg.enabled)) cb.setAttribute("checked", "");
                        cb.setAttribute("lay-skin", "switch"); cb.setAttribute("lay-text", "开启|关闭");
                        cb.setAttribute("lay-filter", "nsx-main-switch");
                    }
                    const body = el("div", "nsx-config-card-body layui-row", card);
                    const fields = m.fields || {}, hidden = new Set(m.hidden || []);
                    const cols = m.cols || 1, defaultCol = Math.floor(12 / cols);
                    Object.keys(cfg).filter(k => k !== "enabled" && !isObj(cfg[k]) && !hidden.has(k)).forEach(k => {
                        const fm = fields[k] || {};
                        const f = { key: k, label: fm.label || k, type: inferType(cfg[k], fm), options: fm.options, placeholder: fm.placeholder, valueType: inferVT(cfg[k], fm), col: fm.col, defaultVal: cfg[k], desc: fm.desc, buttonText: fm.buttonText, action: fm.action };
                        let cur = store.get(`${base}.${k}`, cfg[k]);
                        // 处理旧版本 hide -> official 的映射
                        if (k === 'blacklist_mode' && cur === 'hide') cur = 'official';

                        const fe = makeField(f, `${base}.${k}`, cur, defaultCol);
                        if (fe) {
                            body.appendChild(fe);
                        }
                    });
                    return card;
                };

                // 按照排好序的分组进行渲染
                groupOrder.forEach((g, i) => {
                    const list = groups[g];
                    const label = cleanUiLabel(g) || "其他设置";
                    const fs = el("section", "nsx-config-section", wrapper); fs.id = `group-${i}`; fs.dataset.nsxGroup = label.toLowerCase();
                    const sectionHeader = el("header", "nsx-config-section-header", fs);
                    const sectionNumber = el("span", "nsx-config-section-index", sectionHeader); sectionNumber.textContent = sectionIndex(i);
                    const sectionCopy = el("div", "", sectionHeader);
                    const sectionTitle = el("h2", "nsx-config-section-title", sectionCopy);
                    const sectionEmoji = el("span", "nsx-config-section-emoji", sectionTitle); sectionEmoji.textContent = emojiForCategory(label); sectionEmoji.setAttribute("aria-hidden", "true");
                    const sectionLabel = el("span", "", sectionTitle); sectionLabel.textContent = label;
                    const sectionMeta = el("p", "nsx-config-section-meta", sectionCopy); sectionMeta.textContent = `${list.length} 个模块`;
                    const fd = el("div", "layui-form nsx-config-section-list", fs);
                    list.forEach(e => { const c = makeCard(e, code); if (c) fd.appendChild(c); });
                    const mi = el("li", "", menuList); if (i === 0) mi.classList.add("layui-menu-item-checked");
                    mi.dataset.nsxMenuGroup = `group-${i}`;
                    const mb = el("div", "layui-menu-body-title", mi), a = el("a", "", mb); a.href = `#group-${i}`;
                    const menuNumber = el("span", "nsx-config-menu-index", a); menuNumber.textContent = sectionIndex(i);
                    const menuEmoji = el("span", "nsx-config-menu-emoji", a); menuEmoji.textContent = emojiForCategory(label); menuEmoji.setAttribute("aria-hidden", "true");
                    const menuLabel = el("span", "nsx-config-menu-label", a); menuLabel.textContent = label;
                    const menuCount = el("small", "nsx-config-menu-count", a); menuCount.textContent = String(list.length);
                });

                const backupIdx = groupOrder.length;
                const backupFs = el("section", "nsx-config-section", wrapper); backupFs.id = `group-${backupIdx}`; backupFs.dataset.nsxGroup = "配置备份";
                const backupSectionHeader = el("header", "nsx-config-section-header", backupFs);
                const backupSectionNumber = el("span", "nsx-config-section-index", backupSectionHeader); backupSectionNumber.textContent = sectionIndex(backupIdx);
                const backupSectionCopy = el("div", "", backupSectionHeader);
                const backupSectionTitle = el("h2", "nsx-config-section-title", backupSectionCopy);
                const backupSectionEmoji = el("span", "nsx-config-section-emoji", backupSectionTitle); backupSectionEmoji.textContent = emojiForCategory("配置备份"); backupSectionEmoji.setAttribute("aria-hidden", "true");
                const backupSectionLabel = el("span", "", backupSectionTitle); backupSectionLabel.textContent = "配置备份";
                const backupSectionMeta = el("p", "nsx-config-section-meta", backupSectionCopy); backupSectionMeta.textContent = "导出或还原本地设置";
                const backupWrap = el("div", "layui-form nsx-config-section-list", backupFs);
                const backupCard = el("section", "layui-form nsx-config-card", backupWrap);
                const backupHdr = el("div", "nsx-config-card-header", backupCard); backupHdr.textContent = "导出与还原";
                const backupBody = el("div", "nsx-config-card-body nsx-config-backup-body", backupCard);
                backupBody.innerHTML = `<div class="nsx-config-tools"><button type="button" class="layui-btn layui-btn-normal" data-nsx-action="export-config">导出配置</button><button type="button" class="layui-btn layui-btn-primary" data-nsx-action="import-config">还原配置</button></div><div class="nsx-config-tools-tip">会备份设置面板中的开关、颜色、数值等配置，以及关键词、历史记录、快捷回复、好友和黑名单等本地数据。</div>`;
                const backupMi = el("li", "", menuList);
                const backupMb = el("div", "layui-menu-body-title", backupMi), backupA = el("a", "", backupMb);
                backupA.href = `#group-${backupIdx}`;
                backupMi.dataset.nsxMenuGroup = `group-${backupIdx}`;
                const backupMenuNumber = el("span", "nsx-config-menu-index", backupA); backupMenuNumber.textContent = sectionIndex(backupIdx);
                const backupMenuEmoji = el("span", "nsx-config-menu-emoji", backupA); backupMenuEmoji.textContent = emojiForCategory("配置备份"); backupMenuEmoji.setAttribute("aria-hidden", "true");
                const backupMenuLabel = el("span", "nsx-config-menu-label", backupA); backupMenuLabel.textContent = "配置备份";
                const backupMenuCount = el("small", "nsx-config-menu-count", backupA); backupMenuCount.textContent = "1";

                const end = el("div", "nsx-config-end", wrapper); end.textContent = "所有设置均保存在当前浏览器";

                const w = window.innerWidth <= 720 || window.layui.device().mobile ? "100%" : `${Math.min(860, Math.round(window.innerWidth * 0.92))}px`;
                ctx.ui.layer.open({
                    type: 1, offset: "r", anim: "slideLeft", area: [w, "100%"], scrollbar: false, shade: 0.1, shadeClose: false,
                    btn: ["保存更改", "取消"], btnAlign: "r", title: "Max-iSen 设置", id: "setting-layer-direction-r", content: cont.outerHTML,
                    success: ly => {
                        const r = ly?.[0] || ly;
                        try { window.layui.form?.render(); } catch { }
                        bindBackupTools(r);
                        bindModuleActions(r);
                        // 滚动同步：右侧滚动时高亮左侧菜单
                        const content = r?.querySelector?.("#nsx-config-content");
                        const menu = r?.querySelector?.("#nsx-config-menu");
                        if (content && menu) {
                            const items = menu.querySelectorAll("li");
                            content.addEventListener("scroll", () => {
                                const groups = content.querySelectorAll(".nsx-config-section[id^='group-']");
                                const contentTop = content.getBoundingClientRect().top;
                                let activeIdx = 0;
                                groups.forEach((g, i) => { if (g.getBoundingClientRect().top - contentTop <= 50) activeIdx = i; });
                                items.forEach((li, i) => li.classList.toggle("layui-menu-item-checked", i === activeIdx));
                            }, { passive: true });
                        }
                        // 主开关联动
                        const toggleCard = (card, on) => {
                            if (!card) return;
                            card.querySelectorAll(".nsx-config-card-body input,.nsx-config-card-body select,.nsx-config-card-body textarea").forEach(el => {
                                el.disabled = !on;
                                el.closest(".layui-form-item")?.classList.toggle("layui-disabled", !on);
                            });
                            window.layui.form?.render(null, card.getAttribute("lay-filter"));
                        };
                        // 初始 + 监听
                        r?.querySelectorAll?.(".header-checkbox input").forEach(cb => !cb.checked && toggleCard(cb.closest(".nsx-config-card"), false));
                        window.layui.form?.on("switch(nsx-main-switch)", d => toggleCard(d.elem.closest(".nsx-config-card"), d.elem.checked));
                        window.layui.use("colorpicker", () => {
                            const cp = window.layui.colorpicker;
                            r?.querySelectorAll?.("[data-color-path]").forEach(wrap => {
                                const path = wrap.getAttribute("data-color-inp");
                                const inp = r.querySelector(`input[name="${path}"]`);
                                const init = wrap.getAttribute("data-color-val") || "";
                                const def = wrap.getAttribute("data-color-default") || "";
                                if (!inp) return;

                                const setBg = c => { inp.style.background = c || ""; };
                                cp.render({
                                    elem: wrap, color: init, alpha: true, predefine: true, format: "rgb",
                                    change: setBg,
                                    done(c) {
                                        const final = c || def;
                                        inp.value = final;
                                        setBg(final);
                                    },
                                    cancel: setBg
                                });
                            });
                        });
                    },
                    yes: (idx, ly) => {
                        const r = ly?.[0] || ly, sc = r?.querySelector ? r : document;
                        const changedKeys = [];
                        sc.querySelectorAll("input,select,textarea").forEach(el => {
                            if (!el.name) return;
                            // radio 只保存选中的那个
                            if (el.type === "radio" && !el.checked) return;
                            let v;
                            const vt = el.dataset.valueType;
                            if (el.type === "checkbox") v = el.checked;
                            else if (el.type === "radio") v = vt === "number" ? Number(el.value) : el.value;
                            else if (el.tagName === "TEXTAREA") v = vt === "array" ? el.value.split("\n").map(s => s.trim()).filter(Boolean) : el.value;
                            else if (el.type === "number" || vt === "number") { const n = Number(el.value); v = Number.isFinite(n) ? n : 0; }
                            else v = el.value;
                            if (v !== undefined) {
                                const oldV = store.get(el.name);
                                const o = typeof oldV === "object" ? JSON.stringify(oldV) : String(oldV);
                                const n = typeof v === "object" ? JSON.stringify(v) : String(v);
                                if (o !== n) changedKeys.push(el.name);
                                store.set(el.name, v);
                            }
                        });
                        applyRuntimeSettings(ctx, changedKeys);
                        ctx.ui.layer.msg("设置已保存，已即时生效");
                        setTimeout(() => ctx.ui.layer.close(idx), 300);
                    }
                });
            };

            const menuItems = [
                { name: "advanced_settings", cb: advSettings, text: "⚙️ 全局设置", states: [] },
                { name: "sign_in", cb: switchState, text: "🍗 签到方式", states: [{ s2: "关闭" }, { s2: "随机鸡腿" }, { s2: "5 个鸡腿" }] },
                { name: "re_sign", cb: reSign, text: "🔄 立即重试签到", states: [] },
                { name: "open_post_in_new_tab", cb: switchNewTab, text: "↗️ 新标签打开", states: [{ s2: "关闭" }, { s2: "开启" }] },
                { name: "export_config", cb: exportConfig, text: "📤 导出配置", states: [] },
                { name: "import_config", cb: importConfig, text: "📥 还原配置", states: [], autoClose: false },
                { name: "feedback", cb: () => GM_openInTab("https://greasyfork.org/zh-CN/scripts/588182/feedback", { active: true, insert: true, setParent: true }), text: "💬 问题反馈", states: [] }
            ];

            regMenus();
        }
    };

    const __vite_glob_0_13 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: menus
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 快捷评论 (快捷回复区)
       ========================================================================== */

    const quickComment = {
        id: "quickComment",
        order: 120,
        cfg: { quick_comment: { enabled: true, phrases_enabled: true } },
        meta: { quick_comment: { label: "快捷评论", group: "🧭 辅助工具" } },
        match: ctx => ctx.isPost,
        init(ctx) {
            let open = false;
            let activeEditor = null;
            let quickCommentButton = null;
            const isEnabled = () => ctx.store.get("quick_comment.enabled", true);
            const phrasesEnabled = () => ctx.store.get("quick_comment.phrases_enabled", true);
            addStyle("nsx-quick-reply", `
.mde-toolbar > .sep{width:2px !important;height:20px !important;background:#e5e7eb !important;margin:0 6px !important;flex-shrink:0 !important;display:inline-block !important}
.nsx-quick-reply-wrap{position:relative;display:inline-flex;align-items:center}
.nsx-quick-reply-btn{height:auto;line-height:1;border:none;background:transparent;color:var(--text-color,#333);padding:0;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px}
.nsx-quick-reply-btn svg{width:17px;height:17px;display:block}
.nsx-quick-reply-btn:hover{color:#1677ff}
.nsx-quick-reply-menu{position:absolute;left:0;top:36px;z-index:1002;min-width:280px;max-width:min(500px,88vw);background:var(--bg-color,#fff);border:1px solid var(--border-color,#e5e7eb);border-radius:10px;box-shadow:0 8px 22px rgba(0,0,0,.12);padding:8px;display:none}
.nsx-quick-reply-menu.show{display:block}
.nsx-quick-reply-tabs-wrap{display:flex;align-items:flex-start;gap:6px;padding-bottom:11px;margin-bottom:6px;border-bottom:1px solid #eee}
.nsx-quick-reply-tabs{flex:1;display:flex;gap:6px;overflow:auto hidden;scrollbar-width:thin;overflow-y:hidden}
.nsx-quick-reply-tab{flex:0 0 calc((100% - 12px)/3);max-width:calc((100% - 12px)/3);border:1px solid #e4e6eb;background:#fff;border-radius:999px;padding:3px 8px;cursor:pointer;font-size:12px;white-space:nowrap;overflow:hidden;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px}
.nsx-quick-reply-tab .nsx-quick-reply-tab-text{min-width:0;overflow:hidden;text-overflow:ellipsis}
.nsx-quick-reply-tab .nsx-quick-reply-tab-del{flex:0 0 auto;border:0;background:transparent;color:#999;cursor:pointer;line-height:1;padding:0 2px;font-size:12px}
.nsx-quick-reply-tab .nsx-quick-reply-tab-del:hover{color:#ff4d4f}
.nsx-quick-reply-tab.active{background:#1677ff;color:#fff;border-color:#1677ff}
.nsx-quick-reply-tab.active .nsx-quick-reply-tab-del{color:rgba(255,255,255,.85)}
.nsx-quick-reply-tab.active .nsx-quick-reply-tab-del:hover{color:#fff}
.nsx-quick-reply-tab-add-fixed{flex:0 0 auto;border:1px dashed #1677ff;background:#fff;color:#1677ff;border-radius:999px;padding:3px 10px;cursor:pointer;font-size:12px;white-space:nowrap}
.nsx-quick-reply-list{height:216px;overflow-y:auto;overflow-x:hidden;padding-right:2px}
.nsx-quick-reply-item{display:flex;align-items:center;width:100%;text-align:left;border:0;background:transparent;color:inherit;cursor:pointer;border-radius:8px;padding:0 6px 0 10px;height:36px;box-sizing:border-box}
.nsx-quick-reply-item .nsx-quick-reply-item-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}
.nsx-quick-reply-item .nsx-quick-reply-item-del{flex:0 0 auto;border:0;background:transparent;color:#999;cursor:pointer;line-height:1;padding:4px 6px;font-size:12px;border-radius:6px}
.nsx-quick-reply-item .nsx-quick-reply-item-del:hover{color:#ff4d4f;background:rgba(255,77,79,.12)}
.nsx-quick-reply-item:hover{background:var(--hover-color,#f3f4f6)}
.nsx-quick-reply-empty{height:100%;min-height:150px;display:flex;align-items:center;justify-content:center;padding:18px;color:#999;font-size:12px;text-align:center}
.nsx-quick-reply-foot{display:flex;justify-content:space-between;align-items:center;padding-top:6px;margin-top:6px;border-top:1px solid #eee}
.nsx-quick-reply-autosend-wrap{display:flex;align-items:center;gap:4px;font-size:12px;color:#666}
.nsx-quick-reply-autosend-check{width:14px;height:14px;cursor:pointer;accent-color:#1677ff}
.nsx-quick-reply-autosend-label{cursor:pointer;user-select:none}
.nsx-quick-reply-op{border:1px solid #e4e6eb;background:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
.nsx-quick-reply-op:disabled{opacity:.45;cursor:not-allowed}
.nsx-quick-reply-add{border:1px solid #1677ff;background:#1677ff;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:12px}
.dark-layout .mde-toolbar > .sep{background:#666 !important}
.dark-layout .nsx-quick-reply-btn:hover{color:#64b5f6}
.dark-layout .nsx-quick-reply-menu{background:#222;border-color:#3a3a3a;box-shadow:0 8px 22px rgba(0,0,0,.35)}
.dark-layout .nsx-quick-reply-tabs-wrap{border-bottom-color:#3a3a3a}
.dark-layout .nsx-quick-reply-tabs{border-bottom-color:#3a3a3a}
.dark-layout .nsx-quick-reply-tab{background:#2a2a2a;border-color:#444;color:#ddd}
.dark-layout .nsx-quick-reply-tab.active{background:#1677ff;border-color:#1677ff;color:#fff}
.dark-layout .nsx-quick-reply-tab-add-fixed{background:#2a2a2a;border-color:#1677ff;color:#8dbdff}
.dark-layout .nsx-quick-reply-item .nsx-quick-reply-item-del:hover{background:rgba(255,77,79,.18)}
.dark-layout .nsx-quick-reply-item:hover{background:#333}
.dark-layout .nsx-quick-reply-foot{border-top-color:#3a3a3a}
.dark-layout .nsx-quick-reply-autosend-wrap{color:#aaa}
.dark-layout .nsx-quick-reply-op{background:#2a2a2a;border-color:#444;color:#ddd}
`);

            const show = e => {
                if (open || !isEnabled()) return;
                const editor = $(".md-editor");
                if (!editor) return;
                e?.preventDefault?.();
                editor.style.cssText = `position:fixed;bottom:0;margin:0;width:100%;max-width:${editor.clientWidth || 720}px;z-index:999`;
                activeEditor = editor;
                addClose(editor);
                open = true;
            };

            const mountQuickCommentButton = () => {
                const parent = $("#back-to-parent");
                if (!parent) return;
                quickCommentButton = $("#back-to-comment");
                if (!quickCommentButton) {
                    quickCommentButton = parent.cloneNode(true);
                    quickCommentButton.id = "back-to-comment";
                    quickCommentButton.innerHTML = `<svg class="iconpark-icon" style="width:24px;height:24px"><use href="#comments"></use></svg>`;
                    quickCommentButton.onclick = show;
                    parent.before(quickCommentButton);
                }
                quickCommentButton.hidden = !isEnabled();
            };

            document.addEventListener("click", e => {
                if (!e.target?.closest?.(".nsk-post .comment-menu,.comment-container .comments")) return;
                if (isEnabled() && ["引用", "回复", "编辑"].includes(e.target?.textContent)) show(e);
            }, true);

            const ensureQuickCommentMounted = () => {
                mountQuickCommentButton();
                $$(".md-editor").forEach(editor => mountQuickReplyMenu(editor));
            };
            const refreshQuickComment = () => {
                const enabled = isEnabled();
                ensureQuickCommentMounted();
                if (quickCommentButton) quickCommentButton.hidden = !enabled;
                $$(".nsx-quick-reply-wrap").forEach(wrap => {
                    wrap.style.display = phrasesEnabled() ? "" : "none";
                });
                if (!enabled && open) {
                    activeEditor?.style && (activeEditor.style.cssText = "");
                    $(".nsx-close-editor")?.remove();
                    activeEditor = null;
                    open = false;
                }
            };
            window.__nsxRuntime ||= {};
            window.__nsxRuntime.refreshQuickComment = refreshQuickComment;
            ctx.watch(".md-editor .mde-toolbar,#back-to-parent", ensureQuickCommentMounted, { debounce: 100 });
            document.addEventListener("click", event => {
                if (event.target?.closest?.(".md-editor")) requestAnimationFrame(ensureQuickCommentMounted);
            }, true);
            refreshQuickComment();

            function addClose(editor) {
                const tb = $("#editor-body .window_header > :last-child");
                if (!tb || $(".nsx-close-editor")) return;
                const cb = tb.cloneNode(true);
                cb.classList.add("nsx-close-editor");
                cb.title = "关闭";
                const sp = cb.querySelector("span");
                if (sp) {
                    sp.classList.replace("i-icon-full-screen-one", "i-icon-close");
                    sp.innerHTML = `<svg width="16" height="16" viewBox="0 0 48 48" fill="none"><path d="M8 8L40 40M8 40L40 8" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                }
                cb.onclick = () => { editor.style.cssText = ""; cb.remove(); activeEditor = null; open = false; };
                tb.after(cb);
            }

            function mountQuickReplyMenu(editor) {
                const bar = editor.querySelector(".mde-toolbar");
                if (!bar || bar.querySelector(".nsx-quick-reply-wrap")) return;
                const state = { groupIdx: 0 };

                const sep = document.createElement("div");
                const wrap = document.createElement("div");
                wrap.className = "nsx-quick-reply-wrap toolbar-item";
                const btn = document.createElement("span");
                btn.className = "nsx-quick-reply-btn i-icon";
                btn.title = "快捷短语";
                btn.setAttribute("aria-label", "快捷短语");
                btn.innerHTML = `<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M8 8h32v24H22L12 40v-8H8V8Z" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/><path d="M16 17h16M16 24h10" stroke="currentColor" stroke-width="4" stroke-linecap="round"/></svg>`;
                const menu = document.createElement("div");
                menu.className = "nsx-quick-reply-menu";

                // 让菜单始终可见：窗口缩放/滚动时自动贴边，避免跑出视窗外
                const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
                const placeMenu = () => {
                    if (!menu.classList.contains("show")) return;

                    // 覆盖 CSS 里的 absolute，避免父容器溢出/裁剪导致看不到
                    menu.style.position = "fixed";
                    menu.style.margin = "0";

                    const pad = 8;
                    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                    const vh = window.innerHeight || document.documentElement.clientHeight || 0;

                    const bRect = btn.getBoundingClientRect();
                    const mRect = menu.getBoundingClientRect();
                    const w = mRect.width || Math.min(500, Math.max(280, vw * 0.88));
                    const h = mRect.height || 320;

                    let left = clamp(bRect.left, pad, Math.max(pad, vw - w - pad));
                    let top = bRect.bottom + 6;

                    // 优先显示在按钮下方；放不下就翻到上方
                    if (top + h + pad > vh && bRect.top - 6 - h - pad >= 0) {
                        top = bRect.top - 6 - h;
                    }
                    top = clamp(top, pad, Math.max(pad, vh - h - pad));

                    menu.style.left = `${left}px`;
                    menu.style.top = `${top}px`;
                };

                // 支持拖拽移动：按住标签栏区域拖动菜单
                let dragOn = false, dragStartX = 0, dragStartY = 0, dragLeft = 0, dragTop = 0;
                const onDragMove = (e) => {
                    if (!dragOn) return;
                    const pad = 8;
                    const vw = window.innerWidth || document.documentElement.clientWidth || 0;
                    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
                    const r = menu.getBoundingClientRect();
                    const nextLeft = clamp(dragLeft + (e.clientX - dragStartX), pad, Math.max(pad, vw - r.width - pad));
                    const nextTop = clamp(dragTop + (e.clientY - dragStartY), pad, Math.max(pad, vh - r.height - pad));
                    menu.style.left = `${nextLeft}px`;
                    menu.style.top = `${nextTop}px`;
                };
                const onDragEnd = () => { dragOn = false; };

                const tabsWrap = document.createElement("div");
                tabsWrap.className = "nsx-quick-reply-tabs-wrap";
                const tabs = document.createElement("div");
                tabs.className = "nsx-quick-reply-tabs";
                const addGroupTab = document.createElement("button");
                addGroupTab.type = "button";
                addGroupTab.className = "nsx-quick-reply-tab-add-fixed";
                addGroupTab.textContent = "+ 分组";
                addGroupTab.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    openAddGroupDialog(() => {
                        state.groupIdx = Math.max(0, getQuickReplyGroups().length - 1);
                        state.page = 1;
                        renderMenu();
                    });
                };
                const list = document.createElement("div");
                list.className = "nsx-quick-reply-list";
                const foot = document.createElement("div");
                foot.className = "nsx-quick-reply-foot";
                tabsWrap.append(tabs, addGroupTab);
                menu.append(tabsWrap, list, foot);

                tabsWrap.style.cursor = "move";
                tabsWrap.addEventListener("pointerdown", (e) => {
                    if (!menu.classList.contains("show")) return;
                    if (e.button !== 0) return;
                    if (e.target?.closest?.("button,input,select,textarea,a,.nsx-quick-reply-tab,.nsx-quick-reply-tab-add-fixed")) return;
                    e.preventDefault();
                    e.stopPropagation();

                    placeMenu();
                    const r = menu.getBoundingClientRect();
                    dragOn = true;
                    dragStartX = e.clientX;
                    dragStartY = e.clientY;
                    dragLeft = r.left;
                    dragTop = r.top;
                    try { tabsWrap.setPointerCapture(e.pointerId); } catch { }
                }, { passive: false });
                tabsWrap.addEventListener("pointermove", onDragMove);
                tabsWrap.addEventListener("pointerup", onDragEnd);
                tabsWrap.addEventListener("pointercancel", onDragEnd);

                const renderMenu = () => {
                    const groups = getQuickReplyGroups();
                    tabs.innerHTML = "";
                    list.innerHTML = "";
                    foot.innerHTML = "";
                    if (!groups.length) {
                        const empty = document.createElement("div");
                        empty.className = "nsx-quick-reply-empty";
                        empty.textContent = "暂无快捷短语";
                        list.appendChild(empty);
                        const addBtn = document.createElement("button");
                        addBtn.type = "button";
                        addBtn.className = "nsx-quick-reply-add";
                        addBtn.textContent = "新增";
                        addBtn.onclick = () => openAddDialog("", () => {
                            state.groupIdx = 0;
                            renderMenu();
                        });
                        foot.appendChild(addBtn);
                        return;
                    }

                    state.groupIdx = Math.max(0, Math.min(state.groupIdx, groups.length - 1));
                    groups.forEach((g, i) => {
                        // 不要在 button 里嵌套 button（浏览器行为不一致，可能导致误触发关闭）
                        const t = document.createElement("div");
                        t.className = `nsx-quick-reply-tab${i === state.groupIdx ? " active" : ""}`;
                        t.setAttribute("role", "button");
                        t.tabIndex = 0;

                        const label = g.name || `分组${i + 1}`;
                        const text = document.createElement("span");
                        text.className = "nsx-quick-reply-tab-text";
                        text.textContent = label;

                        const del = document.createElement("span");
                        del.className = "nsx-quick-reply-tab-del";
                        del.title = "删除分组";
                        del.textContent = "✕";
                        del.setAttribute("role", "button");
                        del.tabIndex = 0;
                        del.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const groupName = g.name || "";
                            if (!groupName) return;
                            const doDel = () => {
                                let parsed = {};
                                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                                delete parsed[groupName];
                                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
                                state.groupIdx = Math.max(0, Math.min(state.groupIdx, Object.keys(parsed).length - 1));
                                renderMenu();
                            };
                            if (ctx.ui?.confirm) ctx.ui.confirm("确认删除?", `确定要删除分组【${groupName}】吗？（该分组下的快捷回复会一起删除）`, doDel);
                            else if (window.confirm(`确定要删除分组【${groupName}】吗？（该分组下的快捷回复会一起删除）`)) doDel();
                        };

                        const pick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            state.groupIdx = i;
                            renderMenu();
                        };
                        t.onclick = pick;
                        t.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") pick(e); };

                        t.append(text, del);
                        tabs.appendChild(t);
                    });
                    const curGroup = groups[state.groupIdx];
                    const curItems = curGroup.items || [];
                    if (!curItems.length) {
                        const empty = document.createElement("div");
                        empty.className = "nsx-quick-reply-empty";
                        empty.textContent = "暂无快捷短语";
                        list.appendChild(empty);
                    }

                    const curGroupName = curGroup?.name || "";
                    curItems.forEach((item, idx) => {
                        // 同理：避免在 button 里嵌套 button
                        const it = document.createElement("div");
                        it.className = "nsx-quick-reply-item";
                        it.setAttribute("role", "button");
                        it.tabIndex = 0;
                        it.title = item.text;

                        const text = document.createElement("span");
                        text.className = "nsx-quick-reply-item-text";
                        text.textContent = item.label;

                        const del = document.createElement("span");
                        del.className = "nsx-quick-reply-item-del";
                        del.title = "删除";
                        del.textContent = "✕";
                        del.setAttribute("role", "button");
                        del.tabIndex = 0;
                        del.onclick = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!curGroupName) return;
                            const doDel = () => {
                                let parsed = {};
                                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                                const raw = parsed[curGroupName];
                                const arr = normalizeItems(raw).map(x => ({ title: x.label, content: x.text }));
                                arr.splice(idx, 1);
                                parsed[curGroupName] = arr;
                                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
                                renderMenu();
                            };
                            if (ctx.ui?.confirm) ctx.ui.confirm("确认删除?", `确定要删除这条快捷回复吗？`, doDel);
                            else if (window.confirm("确定要删除这条快捷回复吗？")) doDel();
                        };

                        it.append(text, del);
                        const doInsert = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            insertReplyText(editor, item.text);
                            menu.classList.remove("show");
                            // 检查是否自动点击提交按钮
                            const autoSendCheck = document.getElementById("nsx-quick-reply-autosend");
                            if (autoSendCheck && autoSendCheck.checked) {
                                setTimeout(() => {
                                    const submitBtn = editor.querySelector("button.submit.btn");
                                    if (submitBtn) submitBtn.click();
                                }, 100);
                            }
                        };
                        it.onclick = doInsert;
                        it.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") doInsert(e); };
                        list.appendChild(it);
                    });

                    // 自动发送勾选框
                    const autoSendWrap = document.createElement("div");
                    autoSendWrap.className = "nsx-quick-reply-autosend-wrap";
                    const autoSendCheck = document.createElement("input");
                    autoSendCheck.type = "checkbox";
                    autoSendCheck.id = "nsx-quick-reply-autosend";
                    autoSendCheck.className = "nsx-quick-reply-autosend-check";
                    // 从localStorage读取上次设置（兼容NS综合.js的key）
                    const savedAutoSend = localStorage.getItem("nodeseek_quick_reply_auto_submit") === "true";
                    autoSendCheck.checked = savedAutoSend;
                    const autoSendLabel = document.createElement("label");
                    autoSendLabel.htmlFor = "nsx-quick-reply-autosend";
                    autoSendLabel.className = "nsx-quick-reply-autosend-label";
                    autoSendLabel.textContent = "自动提交";
                    // 保存设置到localStorage（使用NS综合.js的key保持兼容）
                    autoSendCheck.onchange = () => {
                        localStorage.setItem("nodeseek_quick_reply_auto_submit", autoSendCheck.checked);
                    };
                    autoSendWrap.append(autoSendCheck, autoSendLabel);

                    const addBtn = document.createElement("button");
                    addBtn.type = "button";
                    addBtn.className = "nsx-quick-reply-add";
                    addBtn.textContent = "新增";
                    addBtn.onclick = () => openAddDialog(curGroup.name || "", () => renderMenu());
                    foot.append(autoSendWrap, addBtn);
                };

                btn.onclick = e => {
                    e.preventDefault();
                    e.stopPropagation();
                    renderMenu();
                    menu.classList.toggle("show");
                    if (menu.classList.contains("show")) requestAnimationFrame(placeMenu);
                };

                document.addEventListener("click", e => {
                    // 当 layui 弹窗打开时（例如“新建分组”的确认/取消），不要自动关闭快捷回复面板
                    // 处理两类情况：1) 点击发生在 layer 内部；2) layer 存在时点击落在外部但仍希望保持面板不被误关
                    if (e.target?.closest?.(".layui-layer,.layui-layer-page,.layui-layer-dialog,.layui-layer-content,.layui-layer-btn,.layui-layer-shade,.layui-colorpicker,.layui-form-select")) return;
                    if (menu.classList.contains("show") && document.querySelector(".layui-layer")) return;
                    if (!wrap.contains(e.target)) menu.classList.remove("show");
                });

                // 窗口变化时重新定位，避免面板被挤出屏幕
                addEventListener("resize", placeMenu, { passive: true });
                addEventListener("scroll", placeMenu, { passive: true });

                sep.className = "sep";
                wrap.append(btn, menu);
                const lastEl = bar.lastElementChild;
                if (lastEl?.classList?.contains("sep")) {
                    bar.append(wrap);
                } else {
                    bar.append(sep, wrap);
                }
                wrap.style.display = phrasesEnabled() ? "" : "none";
                document.addEventListener("NSPRO_FORUM_DATA_CHANGED", event => {
                    try {
                        const keys = JSON.parse(event.detail || "{}").keys || [];
                        if (keys.includes("nodeseek_quick_reply")) renderMenu();
                    } catch { }
                });
            }

            function insertReplyText(editor, text) {
                if (!text) return;
                const cm = editor.querySelector(".CodeMirror")?.CodeMirror;
                if (cm) {
                    const doc = cm.getDoc();
                    const cur = doc.getCursor();
                    doc.replaceRange(text, cur);
                    cm.focus();
                    return;
                }
                const ta = editor.querySelector("textarea");
                if (!ta) return;
                const start = ta.selectionStart ?? ta.value.length;
                const end = ta.selectionEnd ?? ta.value.length;
                ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
                const pos = start + text.length;
                ta.setSelectionRange(pos, pos);
                ta.dispatchEvent(new Event("input", { bubbles: true }));
                ta.focus();
            }

            function getQuickReplyGroups() {
                const raw = localStorage.getItem("nodeseek_quick_reply");
                if (!raw) return [];
                let parsed;
                try { parsed = JSON.parse(raw); } catch { return []; }
                if (!parsed || typeof parsed !== "object") return [];
                const groups = [];
                Object.entries(parsed).forEach(([name, val]) => {
                    const items = normalizeItems(val);
                    groups.push({ name, items });
                });
                return groups;
            }

            function openAddGroupDialog(onDone) {
                const layer = ctx.ui?.layer;
                if (!layer) {
                    const val = window.prompt("请输入分组名：", "默认");
                    const groupName = String(val ?? "").trim();
                    if (!groupName) return;
                    ensureQuickReplyGroup(groupName);
                    ctx.ui?.success?.("分组已创建");
                    onDone?.();
                    return;
                }
                layer.prompt({ title: "新建分组", formType: 0, value: "默认" }, (val, idx) => {
                    const groupName = String(val ?? "").trim();
                    if (!groupName) return ctx.ui?.warning?.("分组名不能为空");
                    ensureQuickReplyGroup(groupName);
                    layer.close(idx);
                    ctx.ui?.success?.("分组已创建");
                    onDone?.();
                });
            }

            function openAddDialog(defaultGroupName, onDone) {
                const layer = ctx.ui?.layer;
                let groups = getQuickReplyGroups().map(g => g.name).filter(Boolean);
                if (!layer || !window.layui) {
                    const ask = (label, def = "") => {
                        const v = window.prompt(label, def);
                        return v == null ? null : String(v).trim();
                    };
                    const group = ask("请输入分组名：", defaultGroupName || groups[0] || "默认");
                    if (group == null) return;
                    if (!group) { ctx.ui?.warning?.("分组名不能为空"); return; }
                    const content = ask("请输入快捷回复内容：", "");
                    if (content == null) return;
                    if (!content.trim()) { ctx.ui?.warning?.("内容不能为空"); return; }
                    saveQuickReplyItem(group, { content: content.trim() });
                    ctx.ui?.success?.("快捷回复已添加");
                    onDone?.();
                    return;
                }

                // 没有任何分组时，先创建一个默认分组，避免下拉为空无法选择
                if (!groups.length) {
                    ensureQuickReplyGroup("默认");
                    groups = getQuickReplyGroups().map(g => g.name).filter(Boolean);
                }

                const escHtml = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
                const defaultGroup = defaultGroupName || groups[0] || "默认";
                const optsHtml = groups.map(g => `<option value="${escHtml(g)}"${g === defaultGroup ? " selected" : ""}>${escHtml(g)}</option>`).join("");
                const html = `
                    <style>
                        .nsx-qr-form .layui-form-label{width:70px}
                        .nsx-qr-form .layui-input-block{margin-left:100px}
                        .nsx-qr-tip{font-size:12px;color:#999;margin-top:4px}
                    </style>
                    <div class="layui-form nsx-qr-form" style="padding:16px 16px 0;">
                        <div class="layui-form-item">
                            <label class="layui-form-label">分组</label>
                            <div class="layui-input-block">
                                <select id="nsx-qr-group">
                                    ${optsHtml}
                                </select>
                                <div class="nsx-qr-tip">需要新分组请点工具栏右侧的“+ 分组”。</div>
                            </div>
                        </div>
                        <div class="layui-form-item">
                            <label class="layui-form-label">内容</label>
                            <div class="layui-input-block">
                                <textarea id="nsx-qr-content" class="layui-textarea" style="min-height:130px" placeholder="输入快捷回复正文"></textarea>
                                <div class="nsx-qr-tip">支持多行文本，列表直接显示正文，插入时会保持换行。</div>
                            </div>
                        </div>
                    </div>
                `;
                layer.open({
                    type: 1,
                    title: "新增快捷回复",
                    area: [window.layui.device().mobile ? "95%" : "560px", "420px"],
                    btn: ["保存", "取消"],
                    content: html,
                    success: ly => {
                        const r = ly?.[0] || ly;
                        if (window.layui?.form) {
                            layui.use("form", () => {
                                const form = layui.form;
                                form.render("select");
                            });
                        }
                        const c = r?.querySelector?.("#nsx-qr-content");
                        c?.focus?.();
                    },
                    yes: idx => {
                        const r = document.getElementById("layui-layer" + idx) || document;
                        const group = r.querySelector("#nsx-qr-group")?.value?.trim() || "";
                        const content = r.querySelector("#nsx-qr-content")?.value || "";
                        if (!group) return ctx.ui?.warning?.("分组名不能为空");
                        if (!content.trim()) return ctx.ui?.warning?.("内容不能为空");
                        saveQuickReplyItem(group, { content: content.trim() });
                        layer.close(idx);
                        ctx.ui?.success?.("快捷回复已添加");
                        onDone?.();
                    }
                });
            }

            function ensureQuickReplyGroup(groupName) {
                let parsed = {};
                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};
                if (!Object.prototype.hasOwnProperty.call(parsed, groupName)) parsed[groupName] = [];
                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
            }

            function saveQuickReplyItem(groupName, item) {
                let parsed = {};
                try { parsed = JSON.parse(localStorage.getItem("nodeseek_quick_reply") || "{}") || {}; } catch { parsed = {}; }
                if (!parsed[groupName]) parsed[groupName] = [];
                if (Array.isArray(parsed[groupName])) {
                    parsed[groupName].push(item);
                } else if (parsed[groupName] && typeof parsed[groupName] === "object") {
                    const arr = normalizeItems(parsed[groupName]).map(i => ({ title: i.label, content: i.text }));
                    arr.push(item);
                    parsed[groupName] = arr;
                } else {
                    parsed[groupName] = [item];
                }
                localStorage.setItem("nodeseek_quick_reply", JSON.stringify(parsed));
            }

            function normalizeItems(src) {
                const arr = Array.isArray(src) ? src : (src && typeof src === "object" ? Object.values(src) : []);
                return arr.map(v => {
                    if (typeof v === "string") return { label: shrink(v), text: v };
                    if (!v || typeof v !== "object") return null;
                    const text = String(v.content ?? v.text ?? v.value ?? "").trim();
                    if (!text) return null;
                    const label = String(v.title ?? v.name ?? v.label ?? shrink(text));
                    return { label, text };
                }).filter(Boolean);
            }

            function shrink(s) {
                const t = String(s).replace(/\s+/g, " ").trim();
                return t.length > 28 ? `${t.slice(0, 28)}...` : t;
            }
        }
    };

    const __vite_glob_0_14 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: quickComment
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🚀 基础功能 ] - 自动签到系统
       ========================================================================== */
    const signIn = {
        id: "signIn",
        deps: ["ui"],
        order: 80,
        cfg: {
            sign_in: {
                ns: { enabled: true, method: 1, last_date: "", ignore_date: "" },
                df: { enabled: true, method: 1, last_date: "", ignore_date: "" }
            }
        },
        meta: {
            sign_in: {
                label: "自动签到", group: "🚀 基础功能",
                fields: { method: { type: "RADIO", label: "签到方式", valueType: "number", options: [{ value: 1, text: "随机🍗" }, { value: 2, text: "5个🍗" }] } },
                hidden: ["last_date", "ignore_date"]
            }
        },
        match: ctx => ctx.site && ctx.loggedIn
            && ctx.store.get(`sign_in.${ctx.site.code}.enabled`, true)
            && !ctx.store.get("rules_compliance.enabled", true),
        async init(ctx) {
            const code = ctx.site.code;
            const method = ctx.store.get(`sign_in.${code}.method`, 0);
            const now = (() => {
                const off = new Date().getTimezoneOffset() + 480;
                const bj = new Date(Date.now() + off * 60000);
                return `${bj.getFullYear()}/${bj.getMonth() + 1}/${bj.getDate()}`;
            })();
            if (ctx.store.get(`sign_in.${code}.last_date`) === now) return;
            try {
                const r = await net.post(`/api/attendance?random=${method === 1}`);
                ctx.store.set(`sign_in.${code}.last_date`, now);
                if (r?.success) {
                    ctx.ui.success?.(`签到成功！+${r.gain}🍗，共${r.current}🍗`);
                } else {
                    ctx.ui.info?.(r?.message || "签到失败");
                }
            } catch (e) { ctx.ui.info?.(e?.message || "签到错误"); }
        }
    };

    const __vite_glob_0_16 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: signIn
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🚀 基础功能 ] - 签到过期提醒
       ========================================================================== */

    const CSS = `.nsplus-tip{background:rgba(255,217,0,.8);padding:3px;text-align:center;animation:blink 5s ease infinite}.nsplus-tip p,.nsplus-tip p a{color:#f00}.nsplus-tip p a:hover{color:#0ff}`;

    const signinTips = {
        id: "signinTips",
        deps: ["ui"],
        order: 79,
        cfg: { signin_tips: { enabled: true } },
        meta: { signin_tips: { label: "签到提示", group: "🚀 基础功能" } },
        match(ctx) {
            if (!ctx.site || !ctx.loggedIn || !ctx.store.get("signin_tips.enabled", true)) return false;
            return ctx.store.get(`sign_in.${ctx.site.code}.enabled`, true) === false;
        },
        init(ctx) {
            addStyle("nsx-signtip", CSS);
            const code = ctx.site.code;
            const now = (() => { const d = new Date(Date.now() + (new Date().getTimezoneOffset() + 480) * 6e4); return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; })();
            if (now === ctx.store.get(`sign_in.${code}.ignore_date`) || now === ctx.store.get(`sign_in.${code}.last_date`)) return;

            const header = $("header");
            if (!header) return;
            const tip = document.createElement("div");
            tip.className = "nsplus-tip";
            tip.innerHTML = `<p>今天还没签到！【<a class="nsx-sign" data-r="1">随机🍗</a>】【<a class="nsx-sign" data-r="0">5个🍗</a>】【<a class="nsx-ign">今天不提示</a>】</p>`;
            header.appendChild(tip);

            $$(".nsx-sign", tip).forEach(a => a.onclick = async e => {
                e.preventDefault();
                try {
                    const r = await net.post(`/api/attendance?random=${a.dataset.r === "1"}`);
                    r?.success ? ctx.ui.success?.(`签到成功！+${r.gain}🍗`) : ctx.ui.info?.(r?.message || "签到失败");
                } catch (e) { ctx.ui.warning?.(e?.message || "失败"); }
                tip.remove();
                ctx.store.set(`sign_in.${code}.last_date`, now);
            });
            $(".nsx-ign", tip).onclick = e => { e.preventDefault(); tip.remove(); ctx.store.set(`sign_in.${code}.ignore_date`, now); };
        }
    };

    const __vite_glob_0_17 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: signinTips
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 网页平滑滚动
       ========================================================================== */
    const smoothScroll = {
        id: "smoothScroll",
        order: 340,
        cfg: { smooth_scroll: { enabled: true } },
        meta: { smooth_scroll: { label: "网页平滑滚动", group: "🧭 辅助工具" } },
        match: ctx => ctx.store.get("smooth_scroll.enabled", true),
        init() {
            addStyle("nsx-smooth", "html{scroll-behavior:smooth}");
        }
    };

    const __vite_glob_0_18 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: smoothScroll
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 侧边卡片通知增强
       ========================================================================== */

    class Broadcast {
        static ins = new Map();
        constructor(name) {
            if (Broadcast.ins.has(name)) return Broadcast.ins.get(name);
            this.myId = `${Date.now()}-${Math.random()}`;
            this.recv = [];
            this.KEY = `nsx_tab_${name}`;
            try { this.ch = new BroadcastChannel(name); this.ch.onmessage = e => this.recv.forEach(f => f(e.data)); } catch { this.ch = null; }
            addEventListener("storage", e => { if (e.key === this.KEY) { e.newValue || localStorage.setItem(this.KEY, this.myId); this._up(); } });
            addEventListener("beforeunload", () => { if (this.active) localStorage.removeItem(this.KEY); });
            localStorage.setItem(this.KEY, this.myId);
            this._up();
            Broadcast.ins.set(name, this);
        }
        _up() { this.active = localStorage.getItem(this.KEY) === this.myId; }
        on(fn) { this.recv.push(fn); }
        send(data) { if (!this.ch) return; const m = { sender: this.myId, data }; this.ch.postMessage(m); this.recv.forEach(f => f(m)); }
        task(fn, ms) {
            let timer = null;
            let backoff = 1;
            const run = async () => {
                if (!this.active || document.hidden) {
                    timer = setTimeout(run, ms);
                    return;
                }
                try {
                    const d = await fn();
                    if (d !== undefined) this.send(d);
                    backoff = 1;
                } catch {
                    backoff = Math.min(backoff * 2, 6);
                }
                timer = setTimeout(run, ms * backoff);
            };
            run();
            return () => timer && clearTimeout(timer);
        }
    }

    const userCardExt = {
        id: "userCardExt",
        order: 200,
        cfg: { user_card_ext: { enabled: true } },
        meta: { user_card_ext: { label: "侧边卡片通知增强", group: "🧭 辅助工具" } },
        match: ctx => ctx.loggedIn && (ctx.isPost || ctx.isList) && ctx.store.get("user_card_ext.enabled", true) && !ctx.store.get("rules_compliance.enabled", true),
        async init(ctx) {
            const bn = new Broadcast("nsx_notify");
            const card = $(".user-card .user-stat");
            const last = card?.querySelector(".stat-block:first-child > :last-child");
            if (!card || !last) return;

            const atEl = last.cloneNode(true), msgEl = last.cloneNode(true);
            last.after(atEl);
            card.querySelector(".stat-block:last-child")?.append(msgEl);

            const up = (el, href, icon, text, cnt) => {
                const a = el.querySelector("a");
                if (!a) return;
                a.href = href;
                el.querySelector("a svg use")?.setAttribute("href", icon);
                const t = el.querySelector("a > :nth-child(2)");
                if (t) t.textContent = `${text} `;
                const c = el.querySelector("a > :last-child");
                if (c) { c.textContent = cnt; c.classList.toggle("notify-count", cnt > 0); }
            };
            const upAll = c => { up(atEl, "/notification#/atMe", "#at-sign", "我", c.atMe); up(msgEl, "/notification#/message?mode=list", "#envelope-one", "私信", c.message); up(last, "/notification#/reply", "#remind-6nce9p47", "回复", c.reply); };

            bn.on(({ data }) => { if (data?.type === "unreadCount" && data.counts) upAll(data.counts); });
            bn.send({ type: "unreadCount", counts: ctx.user?.unViewedCount || {}, timestamp: Date.now() });
            bn.task(async () => {
                const r = await fetch("/api/notification/unread-count", { credentials: "include" });
                if (!r.ok) throw 0;
                const d = await r.json();
                if (d?.success && d.unreadCount) return { type: "unreadCount", counts: d.unreadCount, timestamp: Date.now() };
                throw 0;
            }, 5000);
        }
    };

    const __vite_glob_0_19 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: userCardExt
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🎨 视觉美化 ] - 已访问帖子链接染色
       ========================================================================== */

    const DEFAULT_LIGHT = "#afb9c1";
    const DEFAULT_DARK = "#393f4e";
    const VISITED_POSTS_KEY = "nsx_visited_posts";
    const VISITED_POSTS_LIMIT = 4000;

    const getVisitedPostKey = (href) => {
        if (!href) return "";
        try {
            const url = new URL(href, location.origin);
            const id = url.pathname.match(/^\/post-(\d+)/)?.[1];
            return id ? `post:${id}` : `${url.origin}${url.pathname}`;
        } catch {
            return "";
        }
    };

    const readVisitedPosts = () => {
        try {
            const parsed = JSON.parse(localStorage.getItem(VISITED_POSTS_KEY) || "[]");
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch {
            return [];
        }
    };

    const writeVisitedPosts = (items) => {
        const uniq = [...new Set((items || []).filter(Boolean))];
        localStorage.setItem(VISITED_POSTS_KEY, JSON.stringify(uniq.slice(-VISITED_POSTS_LIMIT)));
    };

    const markVisitedPostLink = (link, visitedSet) => {
        if (!link) return;
        const key = getVisitedPostKey(link.href);
        if (!key) return;
        if (visitedSet?.has(key)) link.classList.add("nsx-visited-link");
        else link.classList.remove("nsx-visited-link");
    };

    const visitedColor = {
        id: "visitedColor",
        order: 350,
        cfg: { visited_color: { enabled: true, light: DEFAULT_LIGHT, dark: DEFAULT_DARK } },
        meta: {
            visited_color: {
                label: "已访问颜色",
                group: "🎨 视觉美化",
                // cols: 2,
                fields: {
                    light: { type: "COLOR", label: "浅色模式" },
                    dark: { type: "COLOR", label: "深色模式" }
                }
            }
        },
        match: ctx => ctx.isList && ctx.store.get("visited_color.enabled", true),
        init(ctx) {
            const light = ctx.store.get("visited_color.light", DEFAULT_LIGHT);
            const dark = ctx.store.get("visited_color.dark", DEFAULT_DARK);
            addStyle("nsx-visited-color", `.post-list .post-title a:visited,.post-list .post-title a.nsx-visited-link{color:${light}}body.dark-layout .post-list .post-title a:visited,body.dark-layout .post-list .post-title a.nsx-visited-link{color:${dark}}`);

            const applyVisitedState = (links = $$(".post-list .post-title a[href*='/post-']")) => {
                const visitedSet = new Set(readVisitedPosts());
                links.forEach(link => markVisitedPostLink(link, visitedSet));
            };

            const persistVisitedLink = (link) => {
                const key = getVisitedPostKey(link?.href);
                if (!key) return;
                const list = readVisitedPosts();
                if (list.includes(key)) {
                    link.classList.add("nsx-visited-link");
                    return;
                }
                list.push(key);
                writeVisitedPosts(list);
                link.classList.add("nsx-visited-link");
            };

            applyVisitedState();
            document.addEventListener("click", (e) => {
                const link = e.target.closest(".post-list .post-title a[href*='/post-']");
                if (!link) return;
                persistVisitedLink(link);
            }, true);
            document.addEventListener("auxclick", (e) => {
                const link = e.target.closest(".post-list .post-title a[href*='/post-']");
                if (!link) return;
                persistVisitedLink(link);
            }, true);

            window.__nsxRuntime ||= {};
            window.__nsxRuntime.refreshVisitedColor = applyVisitedState;
        },
        watch: () => ({ sel: ".post-list .post-title a[href*='/post-']", fn: els => window.__nsxRuntime?.refreshVisitedColor?.(els), opts: { debounce: 100 } })
    };

    const __vite_glob_0_20 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: visitedColor
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🧭 辅助工具 ] - 邮箱导航入口
       ========================================================================== */
    const EMAIL_LINK_URL = "https://seek.li/";

    const emailNavLink = {
        id: "emailNavLink",
        order: 205,
        cfg: { email_nav_link: { enabled: true } },
        meta: { email_nav_link: { label: "邮箱入口", group: "🧭 辅助工具" } },
        match: ctx => ctx.store.get("email_nav_link.enabled", true),
        init(ctx) {
            const TEXT_LINK_ID = "nsx-email-nav";
            const ICON_LINK_ID = "nsx-email-icon-link";

            const isMobile = document.documentElement.classList.contains("nsx-mobile");

            const ensureEntry = () => {
                const headerLinks = [...document.querySelectorAll("header a")];
                const deepFloodLink = headerLinks.find(a => {
                    const t = a.textContent.trim();
                    return t === "DeepFlood" || t === "DF";
                });
                const textLink = document.getElementById(TEXT_LINK_ID);
                const iconLink = document.getElementById(ICON_LINK_ID);

                // 手机端或找到 DF/DeepFlood 链接时，使用文字链接
                if (deepFloodLink || isMobile) {
                    iconLink?.remove();
                    if (textLink) {
                        if (deepFloodLink && textLink.previousElementSibling !== deepFloodLink) deepFloodLink.after(textLink);
                        return true;
                    }

                    const newLink = document.createElement("a");
                    newLink.id = TEXT_LINK_ID;
                    newLink.href = EMAIL_LINK_URL;
                    newLink.textContent = "邮箱";
                    newLink.target = "_blank";
                    newLink.rel = "noopener noreferrer";
                    if (deepFloodLink) {
                        newLink.className = deepFloodLink.className;
                        newLink.style.marginLeft = "16px";
                        deepFloodLink.after(newLink);
                    } else {
                        // 手机端没有 DF 链接时，追加到 header 导航最后
                        const navLinks = document.querySelector("header .nav-links, header nav, #nsk-head .header-nav");
                        if (navLinks) {
                            const lastLink = [...navLinks.querySelectorAll("a")].pop();
                            if (lastLink) {
                                newLink.className = lastLink.className;
                                newLink.style.marginLeft = "16px";
                                lastLink.after(newLink);
                            } else {
                                navLinks.appendChild(newLink);
                            }
                        }
                    }
                    return true;
                }

                // 桌面端无 DeepFlood 链接时，使用图标
                const grp = ensureIconGroup();
                if (!grp) return false;

                if (textLink) textLink.remove();
                if (iconLink) return true;

                const newIconLink = document.createElement("a");
                newIconLink.id = ICON_LINK_ID;
                newIconLink.href = EMAIL_LINK_URL;
                newIconLink.target = "_blank";
                newIconLink.rel = "noopener noreferrer";
                newIconLink.className = "email-dropdown-on";
                newIconLink.title = "邮箱";
                newIconLink.innerHTML = `<svg class="iconpark-icon" style="width:17px;height:17px"><use href="#envelope-one"></use></svg>`;
                grp.appendChild(newIconLink);
                return true;
            };

            ensureEntry();

            const header = document.querySelector("header");
            if (!header) return;
            const syncEntry = debounce(() => { ensureEntry(); }, 120);
            new MutationObserver(syncEntry).observe(header, { childList: true, subtree: true });
        }
    };

    const __vite_glob_0_22 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: emailNavLink
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ========================================================================== 
       [ 🧭 辅助工具 ] - 站内私信 / Telegram 快捷入口
       ========================================================================== */
    const communicationQuickLinks = {
        id: "communicationQuickLinks",
        order: 206,
        cfg: {
            communication_quick_links: {
                enabled: true,
                show_message: true,
                show_telegram: true
            }
        },
        meta: {
            communication_quick_links: {
                label: "通信快捷入口",
                group: "🧭 辅助工具",
                fields: {
                    show_message: { type: "SWITCH", label: "显示站内私信入口" },
                    show_telegram: { type: "SWITCH", label: "显示 Telegram 入口" }
                }
            }
        },
        match: () => true,
        init(ctx) {
            const MESSAGE_ID = "nsx-communication-message";
            const TELEGRAM_ID = "nsx-communication-telegram";
            const TELEGRAM_LOGO = "https://telegram.org/img/t_logo.svg";
            const getSiteLogo = () => {
                const icon = [...document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')]
                    .find(el => el.href);
                try { return icon ? new URL(icon.href, location.href).href : `${location.origin}/favicon.ico`; }
                catch { return `${location.origin}/favicon.ico`; }
            };

            addStyle("nsx-communication-style", `
                #nsx-icon-group>.nsx-communication-link{cursor:pointer;display:flex!important;align-items:center;justify-content:center;gap:4px;height:30px!important;min-width:auto!important;width:auto!important;margin:0!important;padding:0 6px!important;position:relative!important;top:0!important;color:inherit;text-decoration:none;transition:opacity .1s}
                #nsx-icon-group>.nsx-communication-link:hover{opacity:.6}
                #nsx-icon-group>.nsx-communication-link .nsx-communication-icon{display:block;width:16px;height:16px;flex:0 0 16px;object-fit:contain}
                #nsx-icon-group>.nsx-communication-link .nsx-communication-label{font-size:12px;line-height:1;white-space:nowrap}
                #nsx-icon-group>.nsx-communication-link.nsx-communication-icon-fallback .nsx-communication-icon{display:none}
                #nsx-icon-group>.nsx-communication-link.nsx-communication-icon-fallback .nsx-communication-label{font-weight:600}
                @media(max-width:720px){
                    #nsx-icon-group>.nsx-communication-link{padding-left:5px!important;padding-right:5px!important}
                    #nsx-icon-group>.nsx-communication-link .nsx-communication-label{display:none}
                    #nsx-icon-group>.nsx-communication-link.nsx-communication-icon-fallback .nsx-communication-label{display:inline;font-size:10px}
                }
            `);

            const definitions = [
                {
                    id: MESSAGE_ID,
                    enabled: () => ctx.store.get("communication_quick_links.show_message", true),
                    href: () => new URL("/notification#/message?mode=list", location.origin).href,
                    title: "站内私信",
                    label: "私信",
                    logo: getSiteLogo
                },
                {
                    id: TELEGRAM_ID,
                    enabled: () => ctx.store.get("communication_quick_links.show_telegram", true),
                    href: () => "https://web.telegram.org/",
                    title: "Telegram",
                    label: "Telegram",
                    logo: () => TELEGRAM_LOGO
                }
            ];

            const setIcon = (link, definition) => {
                const logo = definition.logo();
                let img = link.querySelector(".nsx-communication-icon");
                if (!img) {
                    img = document.createElement("img");
                    img.className = "nsx-communication-icon";
                    img.alt = "";
                    img.setAttribute("aria-hidden", "true");
                    img.loading = "lazy";
                    img.decoding = "async";
                    img.addEventListener("error", () => link.classList.add("nsx-communication-icon-fallback"), { once: true });
                    link.prepend(img);
                }
                if (img.src !== logo) {
                    link.classList.remove("nsx-communication-icon-fallback");
                    img.src = logo;
                }
            };

            const ensureLink = (group, definition) => {
                let link = document.getElementById(definition.id);
                if (!link || link.tagName !== "A") {
                    link?.remove();
                    link = document.createElement("a");
                    link.id = definition.id;
                    link.className = "nsx-communication-link";
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    group.appendChild(link);
                } else if (link.parentElement !== group) {
                    group.appendChild(link);
                }
                link.href = definition.href();
                link.title = definition.title;
                link.setAttribute("aria-label", definition.title);
                let label = link.querySelector(".nsx-communication-label");
                if (!label) {
                    label = document.createElement("span");
                    label.className = "nsx-communication-label";
                    link.appendChild(label);
                }
                if (label.textContent !== definition.label) label.textContent = definition.label;
                setIcon(link, definition);
            };

            // 通信入口属于具体作者，顶部的通用入口无法确定目标用户，保留设置但清理旧入口。
            const render = () => {
                definitions.forEach(definition => document.getElementById(definition.id)?.remove());
                return true;
            };

            render();
            window.__nsxRuntime ||= {};
            window.__nsxRuntime.refreshCommunicationLinks = render;

            const sync = debounce(render, 120);
            let headerNode = null;
            let headerObserver = null;
            const bindHeaderObserver = () => {
                const header = document.querySelector("header") || document.querySelector("#nsk-head");
                if (header === headerNode) return;
                headerObserver?.disconnect();
                headerNode = header;
                if (header) {
                    headerObserver = new MutationObserver(sync);
                    headerObserver.observe(header, { childList: true, subtree: true });
                }
            };
            const pageRoot = document.body || document.documentElement;
            if (pageRoot) {
                new MutationObserver(() => {
                    bindHeaderObserver();
                    sync();
                }).observe(pageRoot, { childList: true, subtree: true });
            }
            bindHeaderObserver();
        }
    };

    const __vite_glob_0_23 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: communicationQuickLinks
    }, Symbol.toStringTag, { value: 'Module' }));

    /* ==========================================================================
       [ 🎨 视觉美化 ] - 相对时间中文化
       ========================================================================== */
    const timeChinese = {
        id: "timeChinese",
        order: 110,
        cfg: { time_chinese: { enabled: true } },
        meta: { time_chinese: { label: "时间中文化", group: "🎨 视觉美化" } },
        match: ctx => ctx.store.get("time_chinese.enabled", true),
        init(ctx) {
            const trans = (text) => {
                if (!text) return text;
                let res = text.trim();
                const lower = res.toLowerCase();
                if (lower.includes('just now')) return '刚刚';

                let prefix = "";
                if (lower.startsWith('edited')) {
                    prefix = "编辑于 ";
                    res = res.substring(6).trim();
                }

                res = res.replace(/(\d+)\s*y(ears?)?/gi, '$1年');
                res = res.replace(/(\d+)\s*mo(nths?)?/gi, '$1月');
                res = res.replace(/(\d+)\s*d(ays?)?/gi, '$1天');
                res = res.replace(/(\d+)\s*h(ours?)?/gi, '$1小时');
                res = res.replace(/(\d+)\s*min(utes?)?/gi, '$1分钟');
                res = res.replace(/(\d+)\s*s(econds?)?(?!\w)/gi, '$1秒');
                res = res.replace(/ago/gi, '前');

                return prefix + res.replace(/\s+/g, '');
            };
            const run = (els) => {
                els.forEach(el => {
                    const target = el.tagName === 'TIME' ? el : (el.querySelector('time') || el);
                    if (target.dataset.nsxTime) return;
                    const orig = target.textContent.trim();
                    if (!orig || /^\d{4}-\d{2}-\d{2}/.test(orig)) return;

                    const translated = trans(orig);
                    if (orig !== translated) {
                        target.dataset.nsxTime = orig;
                        target.textContent = translated;
                    }
                });
            };
            const sels = 'time, .date-created, .date-updated, .post-info, .comment-info';
            const doRun = () => run(ctx.$$(sels));
            doRun();
            ctx.watch(sels, doRun, { debounce: 200 });
        }
    };

    const __vite_glob_0_21 = /*#__PURE__*/Object.freeze(/*#__PURE__*/Object.defineProperty({
        __proto__: null,
        default: timeChinese
    }, Symbol.toStringTag, { value: 'Module' }));


    // ===== SVG 图标 =====
    const SVG_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" style="display:none">
<symbol id="copy" viewBox="0 0 48 48"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="M13 12.432v-4.62A2.813 2.813 0 0 1 15.813 5h24.374A2.813 2.813 0 0 1 43 7.813v24.375A2.813 2.813 0 0 1 40.188 35h-4.672M7.813 13h24.374A2.813 2.813 0 0 1 35 15.813v24.374A2.813 2.813 0 0 1 32.188 43H7.813A2.813 2.813 0 0 1 5 40.188V15.813A2.813 2.813 0 0 1 7.813 13Z"/></symbol>
<symbol id="check" viewBox="0 0 48 48"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="m4 24 5-5 10 10L39 9l5 5-25 25L4 24Z"/></symbol>
<symbol id="history" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path d="M5.818 6.727V14h7.273"/><path d="M4 24c0 11.046 8.954 20 20 20s20-8.954 20-20S35.046 4 24 4c-7.32 0-13.715 3.932-17.192 9.8"/><path d="M24 12v14l9.33 9.33"/></g></symbol>
<symbol id="comments" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="4"><path d="M44 6H4v30h8.5v7l9-7H44V6Z"/><path stroke-linecap="round" d="M14 19.5h20M14 27.5h12"/></g></symbol>
<symbol id="at-sign" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path d="M24 44c11.046 0 20-8.954 20-20S35.046 4 24 4 4 12.954 4 24s8.954 20 20 20"/><path d="M32 24c0 4.418-3.582 10-8 10s-8-5.582-8-10 3.582-8 8-8 8 3.582 8 8m0 0v10c0 3 3 6 6 6"/></g></symbol>
<symbol id="envelope-one" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path d="M4 39h40V9H4z"/><path d="m4 9 20 15L44 9"/></g></symbol>
<symbol id="remind-6nce9p47" viewBox="0 0 48 48"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4"><path d="M24 44c1.387 0 2.732-.123 4.023-.357M44 24a20 20 0 0 0-40 0c0 4.59 1.55 8.82 4.157 12.194L4 44l7.806-4.157A19.9 19.9 0 0 0 24 44a20 20 0 0 0 4.023-.357"/><path d="M33.805 40a6 6 0 1 0 5.857-9.805"/></g></symbol>
<symbol id="down" viewBox="0 0 48 48"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="4" d="m36 18-12 12-12-12"/></symbol>
</svg>`;

    // ===== 基础 CSS =====
    const BASE_CSS = `.blocked-post{display:none!important}#nsx-toggle-autoload{display:flex;justify-content:center;align-items:center}#back-to-comment{display:flex}#fast-nav-button-group .nav-item-btn:nth-last-child(4){bottom:120px}#fast-nav-button-group .nav-item-btn:nth-last-child(5){bottom:160px}#fast-nav-button-group .nav-item-btn:nth-last-child(6){bottom:200px}#fast-nav-button-group .nav-item-btn:nth-last-child(7){bottom:240px}#nsx-icon-group{display:flex;align-items:center;gap:0!important;list-style:none;border-left:1px solid var(--border-color,#e5e7eb);margin-left:6px!important;padding-left:6px!important;height:30px}#nsx-icon-group>.filter-dropdown-on,#nsx-icon-group>.relation-dropdown-on,#nsx-icon-group>.history-dropdown-on,#nsx-icon-group>.email-dropdown-on{cursor:pointer;display:flex!important;align-items:center;justify-content:center;height:30px!important;padding:0 6px!important;min-width:auto!important;width:auto!important;margin:0!important;position:relative!important;top:0!important;transition:opacity .1s;color:inherit;text-decoration:none}#nsx-icon-group>.filter-dropdown-on svg,#nsx-icon-group>.relation-dropdown-on svg,#nsx-icon-group>.history-dropdown-on svg,#nsx-icon-group>.email-dropdown-on svg{display:block!important;width:16px!important;height:16px!important;transform:translateY(0)!important}#nsx-icon-group>.filter-dropdown-on:hover,#nsx-icon-group>.relation-dropdown-on:hover,#nsx-icon-group>.history-dropdown-on:hover,#nsx-icon-group>.email-dropdown-on:hover{opacity:.6}#nsx-filter-panel,#nsx-history-panel,#nsx-rel-panel{position:fixed;right:12px;top:60px;width:min(380px,94vw);height:min(700px,80vh);background:#fff;border:1px solid #e4e4e4;border-radius:12px;box-shadow:0 16px 32px rgba(0,0,0,.12);z-index:99999;display:none;flex-direction:column;overflow:hidden}#nsx-filter-panel.show,#nsx-history-panel.show,#nsx-rel-panel.show{display:flex}.nsx-mode-layer .layui-layer-content{overflow:visible!important;padding-bottom:8px}.nsx-mode-layer .layui-form-select dl{z-index:999999!important}.dark-layout #nsx-filter-panel,.dark-layout #nsx-history-panel,.dark-layout #nsx-rel-panel{background:#1e1e1e;border-color:#3a3a3a;color:#e0e0e0}.dark-layout #nsx-icon-group{border-left-color:#3a3a3a}.msc-overlay{background-color:var(--bg-sub-color)}.nsx-mobile .md-editor .mde-toolbar{display:flex;flex-wrap:wrap;align-items:center;height:auto!important;min-height:40px;padding-right:4px;overflow:visible}.nsx-mobile .md-editor .mde-toolbar>*{flex:0 0 auto}.nsx-mobile .md-editor .mde-toolbar .toolbar-item{height:30px;line-height:30px}.nsx-mobile .md-editor .mde-toolbar .toolbar-item.right{margin-left:auto}.nsx-mobile .md-editor .mde-toolbar .toolbar-tabs{width:100%;order:-1}.nsx-mobile .layui-layer{max-width:94vw!important}.nsx-mobile .layui-layer .layui-form-label{width:auto!important;float:none!important;text-align:left!important;padding:0 0 4px!important}.nsx-mobile .layui-layer .layui-input-block{margin-left:0!important}.nsx-mobile .nsx-ai-form .layui-form-label{width:auto!important;float:none!important;text-align:left!important;padding:0 0 4px!important}.nsx-mobile .nsx-ai-form .layui-input-block{margin-left:0!important}`;

    const RESPONSIVE_CSS = `
      html.nsx-mobile,html.nsx-mobile body{max-width:100%;overflow-x:hidden}
      html.nsx-mobile body{padding-bottom:calc(56px + env(safe-area-inset-bottom))!important}
      .nsx-mobile img,.nsx-mobile video{max-width:100%;height:auto}
      .nsx-mobile iframe{max-width:100%}
      .nsx-mobile .post-content pre,.nsx-mobile .post-content table{display:block;max-width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch}
      .nsx-mobile .post-content,.nsx-mobile .signature{max-width:100%;overflow-wrap:anywhere;word-break:break-word}
      .nsx-mobile .post-list-item,.nsx-mobile .post-list-content,.nsx-mobile .post-title,.nsx-mobile .post-info{min-width:0!important;max-width:100%}
      .nsx-mobile .post-list-item>.post-list-content{flex:1 1 auto!important;width:auto!important}
      .nsx-mobile .nsk-post-wrapper,.nsx-mobile .comment-container,.nsx-mobile .content-item{min-width:0;max-width:100%}
      .nsx-mobile .nsk-content-meta-info{display:grid!important;grid-template-columns:45px minmax(0,1fr);grid-template-areas:"avatar identity" "avatar actions";align-items:start!important;min-width:0;max-width:100%;column-gap:10px;row-gap:6px}
      .nsx-mobile .nsk-content-meta-info>.avatar-wrapper{grid-area:avatar;margin-right:0!important}
      .nsx-mobile .nsk-content-meta-info>:nth-child(2){grid-area:identity;min-width:0;width:100%;max-width:100%;box-sizing:border-box}
      .nsx-mobile .author-info{min-width:0;width:100%;display:flex!important;align-items:center;flex-wrap:wrap;gap:4px}
      .nsx-mobile .author-info>*{position:static!important;flex:0 0 auto;max-width:100%}
      .nsx-mobile .author-info>.author-name{min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nsx-mobile .nsk-content-meta-info>.floor-link-wrapper{grid-area:actions;position:static!important;inset:auto!important;width:100%;min-width:0;max-width:100%;display:flex!important;align-items:center;justify-content:flex-start;flex-wrap:wrap;gap:4px;margin:0!important;box-sizing:border-box}
      .nsx-mobile .nsk-content-meta-info>.floor-link-wrapper>*{position:static!important;flex:0 0 auto!important;max-width:100%}
      .nsx-mobile .floor-link-wrapper .nsx-relation-btn-wrap{max-width:100%;display:flex!important;align-items:center;flex-wrap:wrap;gap:4px!important;margin-left:0!important}
      .nsx-mobile .floor-link-wrapper .nsx-relation-btn{position:static!important;flex:0 0 auto!important;min-width:40px!important;height:40px!important;min-height:40px!important;margin:0!important;box-sizing:border-box;justify-content:center;touch-action:manipulation}
      .nsx-mobile .content-item.nsx-nested-item>.nsk-content-meta-info{display:grid!important;grid-template-columns:34px minmax(0,1fr);grid-template-areas:"avatar identity" "avatar actions"}
      .nsx-mobile .comment-menu{display:flex!important;align-items:center;flex-wrap:wrap;gap:2px}
      .nsx-mobile .comment-menu .menu-item{display:flex!important;align-items:center;justify-content:center;min-width:36px;min-height:36px;margin:0 2px!important;padding:0 3px!important}
      .nsx-mobile .nsx-relation-btn{min-height:34px!important;display:inline-flex!important;align-items:center}
      .nsx-mobile .nsx-history-close,.nsx-mobile .nsx-history-restore,.nsx-mobile .nsx-rel-close{display:block!important}
      .nsx-mobile .nsx-history-item:hover .nsx-history-time{display:block}

      .nsx-mobile #nsk-head{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto;grid-template-rows:auto auto auto;column-gap:6px;align-items:center;width:100%!important;max-width:100%!important;height:auto!important;min-height:0;padding:6px 8px!important;box-sizing:border-box}
      .nsx-mobile #nsk-head .site-title{grid-column:1;grid-row:1;min-width:0;margin:0!important}
      .nsx-mobile #nsk-head .site-title .title-text{font-size:22px}
      .nsx-mobile #nsk-head #nsx-icon-group{grid-column:2;grid-row:1;justify-self:end;display:flex!important;align-items:center;height:40px!important;border-left:0;margin:0!important;padding:0!important}
      .nsx-mobile #nsk-head #nsx-icon-group>*{display:flex!important;align-items:center;justify-content:center;width:40px!important;min-width:40px!important;height:40px!important;min-height:40px!important;margin:0!important;padding:0!important;box-sizing:border-box;touch-action:manipulation}
      .nsx-mobile #nsk-head #nsx-icon-group>*>svg{width:18px!important;height:18px!important}
      .nsx-mobile #nsk-head .color-theme-switcher{grid-column:3;grid-row:1;justify-self:end;position:static!important;display:flex!important;align-items:center;justify-content:center;width:40px!important;height:40px!important;margin:0!important;inset:auto!important;box-sizing:border-box}
      .nsx-mobile #nsk-head .search-box{grid-column:1/-1;grid-row:2;width:100%!important;min-width:0;margin:5px 0!important}
      .nsx-mobile #nsk-head .search-box #search-site2{width:100%!important;min-height:40px;box-sizing:border-box;font-size:16px}
      .nsx-mobile #nsk-head .nav-menu{grid-column:1/-1;grid-row:3;display:flex!important;gap:0;width:100%;max-width:100%;margin:0!important;padding:2px 0!important;overflow-x:auto;overflow-y:hidden;white-space:nowrap;scrollbar-width:none;-webkit-overflow-scrolling:touch}
      .nsx-mobile #nsk-head .nav-menu::-webkit-scrollbar{display:none}
      .nsx-mobile #nsk-head .nav-menu>li{display:flex!important;flex:0 0 auto;margin:0!important}
      .nsx-mobile #nsk-head .nav-menu a{display:flex;align-items:center;min-height:40px;padding:0 10px!important;margin:0!important;touch-action:manipulation}
      .nsx-mobile #nsk-head #nsx-email-nav{margin-left:0!important}

      .nsx-mobile #nsx-filter-panel,.nsx-mobile #nsx-history-panel,.nsx-mobile #nsx-rel-panel,.nsx-mobile #nsx-lottery-panel{top:var(--nsx-mobile-panel-top,138px)!important;right:6px!important;left:6px!important;right:max(6px,env(safe-area-inset-right))!important;left:max(6px,env(safe-area-inset-left))!important;width:auto!important;height:calc(100vh - var(--nsx-mobile-panel-top,138px) - 10px)!important;height:calc(100dvh - var(--nsx-mobile-panel-top,138px) - 10px)!important;max-height:none!important;border-radius:8px;box-sizing:border-box}
      .nsx-mobile #nsx-filter-panel .nsx-rel-header,.nsx-mobile #nsx-history-panel .nsx-history-header,.nsx-mobile #nsx-rel-panel .nsx-rel-header{min-height:52px;gap:8px;flex-wrap:wrap;box-sizing:border-box}
      .nsx-mobile #nsx-filter-panel button,.nsx-mobile #nsx-history-panel button,.nsx-mobile #nsx-rel-panel button,.nsx-mobile #nsx-lottery-panel button{min-height:40px!important;font-size:14px;touch-action:manipulation}
      .nsx-mobile #nsx-filter-panel .nsx-rel-search,.nsx-mobile #nsx-history-panel .nsx-history-search,.nsx-mobile #nsx-rel-panel .nsx-rel-search{min-height:44px;box-sizing:border-box}
      .nsx-mobile #nsx-filter-panel input,.nsx-mobile #nsx-history-panel input,.nsx-mobile #nsx-rel-panel input{min-width:0;min-height:32px;font-size:16px!important}
      .nsx-mobile #nsx-filter-panel .nsx-rel-tabs,.nsx-mobile #nsx-history-panel .nsx-history-tabs,.nsx-mobile #nsx-rel-panel .nsx-rel-tabs{gap:8px;overflow-x:auto;-webkit-overflow-scrolling:touch}
      .nsx-mobile #nsx-lottery-panel .nsx-lottery-panel-header{min-height:52px;height:auto}
      .nsx-mobile #nsx-lottery-panel .nsx-lottery-toolbar{display:flex;flex-wrap:wrap;gap:8px}
      .nsx-mobile #nsx-lottery-panel .nsx-lottery-icon-btn{width:40px!important;min-width:40px!important;height:40px!important}

      .nsx-mobile .nsx-lottery-modal-mask{padding:8px;box-sizing:border-box}
      .nsx-mobile .nsx-lottery-modal{width:calc(100vw - 16px);max-width:560px;max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);padding:14px;box-sizing:border-box}
      .nsx-mobile .nsx-lottery-modal-header{top:-14px;padding-top:8px}
      .nsx-mobile .nsx-lottery-modal-header .nsx-lottery-icon-btn{width:40px!important;height:40px!important}
      .nsx-mobile .nsx-lottery-form-row{grid-template-columns:1fr!important;gap:5px;margin:10px 0}
      .nsx-mobile .nsx-lottery-form-row input:not([type=checkbox]),.nsx-mobile .nsx-lottery-form-row select{min-height:44px!important;font-size:16px!important;padding:8px 10px!important}
      .nsx-mobile .nsx-lottery-form-row input[type=checkbox]{width:22px;height:22px;margin:6px 0;accent-color:#1677ff}
      .nsx-mobile .nsx-lottery-modal-actions{bottom:-14px;gap:8px;flex-wrap:wrap;padding-bottom:8px}
      .nsx-mobile .nsx-lottery-modal-actions button{min-width:64px;min-height:44px!important;font-size:14px}

      .nsx-mobile #fast-nav-button-group{display:flex!important;flex-direction:row!important;align-items:center;gap:6px;width:auto!important;max-width:calc(100vw - 16px)!important;height:auto!important;right:8px!important;bottom:8px!important;right:max(8px,env(safe-area-inset-right))!important;bottom:max(8px,env(safe-area-inset-bottom))!important;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-webkit-overflow-scrolling:touch}
      .nsx-mobile #fast-nav-button-group::-webkit-scrollbar{display:none}
      .nsx-mobile #fast-nav-button-group .nav-item-btn{position:static!important;inset:auto!important;flex:0 0 40px;width:40px!important;height:40px!important;min-width:40px!important;min-height:40px!important;box-sizing:border-box;opacity:.88;backdrop-filter:blur(5px);touch-action:manipulation}
      .nsx-mobile .md-editor,.nsx-mobile .md-editor .CodeMirror,.nsx-mobile .md-editor .mde-toolbar,.nsx-mobile .md-editor .window_header{max-width:100%!important;box-sizing:border-box}
      .nsx-mobile .md-editor .mde-toolbar{display:flex;flex-wrap:wrap;align-items:center;height:auto!important;min-height:40px;padding-right:4px;overflow:visible}
      .nsx-mobile .md-editor .mde-toolbar>*{flex:0 0 auto}
      .nsx-mobile .md-editor .mde-toolbar .toolbar-item{height:34px;line-height:34px}
      .nsx-mobile .md-editor .mde-toolbar .toolbar-item.right{margin-left:auto}
      .nsx-mobile .md-editor .mde-toolbar .toolbar-tabs{width:100%;order:-1}
      .nsx-mobile .md-editor .window_header{display:flex;align-items:center;flex-wrap:wrap;gap:4px;min-height:40px}
      .nsx-mobile .md-editor .window_header>div:first-child{flex:1 1 auto}
      .nsx-mobile .md-editor .window_header>div[style*="margin-left: auto"]{display:none}
      .nsx-mobile .md-editor .editor-top-button{display:flex;align-items:center;justify-content:center;min-width:36px;min-height:36px}
      .nsx-mobile .md-editor .CodeMirror,.nsx-mobile .md-editor textarea{width:100%!important;font-size:16px;box-sizing:border-box}

      .nsx-mobile .layui-layer{max-width:calc(100vw - 12px)!important}
      .nsx-mobile .layui-layer input:not([type=checkbox]):not([type=radio]),.nsx-mobile .layui-layer select,.nsx-mobile .layui-layer textarea{min-height:40px;font-size:16px!important;box-sizing:border-box}
      .nsx-mobile .layui-layer .layui-form-label{width:auto!important;float:none!important;text-align:left!important;padding:0 0 5px!important}
      .nsx-mobile .layui-layer .layui-input-block{margin-left:0!important}
      .nsx-mobile .layui-layer-btn{padding-bottom:10px;padding-bottom:max(10px,env(safe-area-inset-bottom))}
      .nsx-mobile .layui-layer-btn a{min-height:40px;line-height:40px;box-sizing:border-box}
      @media(max-width:420px){
        .nsx-mobile #nsk-head .site-title .beta-icon{display:none}
        .nsx-mobile .content-item{padding-left:8px!important;padding-right:8px!important}
        .nsx-mobile .author-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .nsx-mobile .nsx-user-info-display{margin-left:2px!important}
        .nsx-mobile .quick-reply-menu,.nsx-mobile .nsx-quick-reply-popover{max-width:calc(100vw - 16px)!important}
      }

      @media(max-width:380px){
        .nsx-mobile #nsk-head{grid-template-columns:minmax(0,1fr) auto;grid-template-rows:auto auto auto auto}
        .nsx-mobile #nsk-head .site-title{grid-column:1;grid-row:1}
        .nsx-mobile #nsk-head .color-theme-switcher{grid-column:2;grid-row:1}
        .nsx-mobile #nsk-head #nsx-icon-group{grid-column:1/-1;grid-row:2;justify-self:end}
        .nsx-mobile #nsk-head .search-box{grid-column:1/-1;grid-row:3}
        .nsx-mobile #nsk-head .nav-menu{grid-column:1/-1;grid-row:4}
      }

      @media(max-width:300px){
        .nsx-mobile #nsk-head .site-title .title-text{font-size:19px}
        .nsx-mobile #nsk-head #nsx-icon-group>*{width:38px!important;min-width:38px!important}
      }

      @media(max-height:500px) and (orientation:landscape){
        .nsx-mobile #nsx-filter-panel,.nsx-mobile #nsx-history-panel,.nsx-mobile #nsx-rel-panel,.nsx-mobile #nsx-lottery-panel{top:6px!important;bottom:6px!important;height:auto!important;max-width:min(520px,70vw);margin-left:auto}
      }
    `;

    const applyRuntimeSettings = (ctx, changedKeys = []) => {
        const changed = new Set(changedKeys || []);
        const has = (prefix) => [...changed].some(k => k === prefix || k.startsWith(prefix + "."));

        if (has("block_posts")) window.__nsxRuntime?.reapplyKeywords?.();
        if (has("relation")) window.__nsxRuntime?.reapplyRelation?.();
        if (has("quick_comment")) window.__nsxRuntime?.refreshQuickComment?.();
        if (has("history")) window.__nsxRuntime?.refreshHistory?.();
        if (has("lottery_reminder")) window.__nsxRuntime?.reapplyLotteryReminder?.();
        if (has("nested_replies")) window.__nsxRuntime?.reapplyNestedReplies?.();
        if (has("communication_quick_links")) {
            window.__nsxRuntime?.refreshCommunicationLinks?.();
            setTimeout(() => location.reload(), 350);
        }
        if (has("rules_compliance")) {
            setTimeout(() => location.reload(), 350);
        }
        if (has("image_upload")) {
            setTimeout(() => location.reload(), 350);
        }
        if (changed.has("comment_footprint.badge_color_light") || changed.has("comment_footprint.badge_color_dark")) {
            window.__nsxRuntime?.refreshCommentFootprint?.();
        } else if (has("comment_footprint") || has("link_purifier")) {
            setTimeout(() => location.reload(), 350);
        }
        if (has("open_post_in_new_tab")) window.__nsxRuntime?.refreshOpenPostInNewTab?.();
        if (has("visited_color")) {
            const styleId = "nsx-visited-color";
            const enabled = ctx.store.get("visited_color.enabled", true);
            const old = document.getElementById(styleId);
            if (!enabled) {
                old?.remove();
            } else {
                const light = ctx.store.get("visited_color.light", DEFAULT_LIGHT);
                const dark = ctx.store.get("visited_color.dark", DEFAULT_DARK);
                const css = `.post-list .post-title a:visited,.post-list .post-title a.nsx-visited-link{color:${light}}body.dark-layout .post-list .post-title a:visited,body.dark-layout .post-list .post-title a.nsx-visited-link{color:${dark}}`;
                if (old && old.tagName === "STYLE") {
                    old.textContent = css;
                } else {
                    old?.remove();
                    const el = document.createElement("style");
                    el.id = styleId;
                    el.textContent = css;
                    document.head?.appendChild(el);
                }
            }
            window.__nsxRuntime?.refreshVisitedColor?.();
        }

        if (has("button_pos") || has("layout") || has("ui")) {
            addStyle("nsx-icon-pos-runtime", ``);
        }
    };

    // ===== Observer =====
    class Observer {
        constructor() { this.listeners = []; this.mo = null; }
        watch(sel, fn, opts = {}) {
            this.listeners.push({ sel, fn, opts });
            if (!this.mo) {
                this.mo = new MutationObserver(debounce((muts) => {
                    if (!muts?.some(m => m.addedNodes?.length)) return;
                    this._run();
                }, 50));
                this.mo.observe(document.body, { childList: true, subtree: true });
            }
        }
        _run() {
            this.listeners.forEach(({ sel, fn, opts }) => {
                const els = $$(sel);
                if (els.length) fn(els, opts);
            });
        }
    }

    // ===== 创建 ctx =====
    function createCtx(obs) {
        const uw = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
        return {
            env, $, $$, addStyle, store, net,
            uw,
            get loggedIn() { return !!uw?.__config__?.user; },
            get user() { return uw?.__config__?.user; },
            get uid() { return uw?.__config__?.user?.member_id; },
            site: env.site,
            isPost: /^\/post-/.test(location.pathname),
            isList: /^\/(categories\/|page|award|search|$)/.test(location.pathname),
            watch: obs.watch.bind(obs),
            ui: {}
        };
    }

    const detectMobileClient = ({ userAgent = "", userAgentMobile = false, viewportWidth = 0, screenWidth = 0, screenHeight = 0, coarsePointer = false, maxTouchPoints = 0 } = {}) => {
        const screenEdges = [Number(screenWidth), Number(screenHeight)].filter(value => Number.isFinite(value) && value > 0);
        const shortScreenEdge = screenEdges.length ? Math.min(...screenEdges) : Infinity;
        const mobileAgent = /Android|webOS|iPhone|iPad|iPod|IEMobile|Opera Mini|Mobile|Mobi|Via/i.test(String(userAgent));
        const narrowViewport = Number(viewportWidth) > 0 && Number(viewportWidth) <= 720;
        const compactTouchScreen = shortScreenEdge <= 720 && (coarsePointer || Number(maxTouchPoints) > 0);
        return !!userAgentMobile || mobileAgent || narrowViewport || compactTouchScreen;
    };

    // ===== 启动 =====
    function start() {
        const mobileViewportQuery = window.matchMedia?.("(max-width: 720px)");
        const coarsePointerQuery = window.matchMedia?.("(hover: none) and (pointer: coarse)");
        const visualViewport = window.visualViewport;
        let mobileLayoutFrame = 0;
        const syncMobileLayout = () => {
            const root = document.documentElement;
            const isMobileClient = detectMobileClient({
                userAgent: navigator.userAgent,
                userAgentMobile: navigator.userAgentData?.mobile,
                viewportWidth: window.innerWidth || root.clientWidth,
                screenWidth: window.screen?.width,
                screenHeight: window.screen?.height,
                coarsePointer: !!coarsePointerQuery?.matches,
                maxTouchPoints: navigator.maxTouchPoints
            });
            root.classList.toggle("nsx-mobile", isMobileClient);
            if (mobileLayoutFrame) cancelAnimationFrame(mobileLayoutFrame);
            mobileLayoutFrame = requestAnimationFrame(() => {
                if (!root.classList.contains("nsx-mobile")) {
                    root.style.removeProperty("--nsx-mobile-panel-top");
                    return;
                }
                const headerBottom = document.querySelector("#nsk-head")?.getBoundingClientRect?.().bottom || 0;
                root.style.setProperty("--nsx-mobile-panel-top", `${Math.max(52, Math.ceil(headerBottom + 4))}px`);
            });
        };
        syncMobileLayout();
        [mobileViewportQuery, coarsePointerQuery].forEach(query => {
            if (query?.addEventListener) query.addEventListener("change", syncMobileLayout);
            else query?.addListener?.(syncMobileLayout);
        });
        addEventListener("resize", syncMobileLayout, { passive: true });
        addEventListener("orientationchange", syncMobileLayout, { passive: true });
        visualViewport?.addEventListener?.("resize", syncMobileLayout);
        const mobileHeader = document.querySelector("#nsk-head");
        if (mobileHeader && typeof ResizeObserver === "function") new ResizeObserver(syncMobileLayout).observe(mobileHeader);

        // 注入资源
        document.body?.insertAdjacentHTML("beforeend", SVG_SPRITE);
        addStyle("nsx-base", BASE_CSS);
        addStyle("nsx-responsive", RESPONSIVE_CSS);
        // layui CSS
        // Layui is packaged by the extension and injected from manifest.json.

        // highlight.js 脚本
        // highlight.js is packaged by the extension and loaded before this script.
        // highlight.js 样式
        addStyle("hightlight-style", GM_getResourceURL("highlightStyle"));
        // hljs 初始化
        addScript("nsx-hljs-onload", `(()=>{const r=()=>{if(window.hljs&&typeof hljs.highlightAll==="function")hljs.highlightAll()};document.readyState==="complete"?r():window.addEventListener("load",r,{once:true})})()`);

        // 加载模块
        const mods = /* #__PURE__ */ Object.assign({ "./features/autoJump.js": __vite_glob_0_0, "./features/autoLoading.js": __vite_glob_0_1, "./features/callout.js": __vite_glob_0_5, "./features/codeHighlight.js": __vite_glob_0_6, "./features/commentFootprint.js": __vite_glob_0_24, "./features/commentShortcut.js": __vite_glob_0_7, "./features/darkMode.js": __vite_glob_0_8, "./features/history.js": __vite_glob_0_9, "./features/imageSlide.js": __vite_glob_0_10, "./features/instantPage.js": __vite_glob_0_11, "./features/levelTag.js": __vite_glob_0_12, "./features/linkPurifier.js": __vite_glob_0_25, "./features/menus.js": __vite_glob_0_13, "./features/quickComment.js": __vite_glob_0_14, "./features/signIn.js": __vite_glob_0_16, "./features/signinTips.js": __vite_glob_0_17, "./features/smoothScroll.js": __vite_glob_0_18, "./features/userCardExt.js": __vite_glob_0_19, "./features/visitedColor.js": __vite_glob_0_20, "./features/timeChinese.js": __vite_glob_0_21, "./features/emailNavLink.js": __vite_glob_0_22, "./features/communicationQuickLinks.js": __vite_glob_0_23 });
        Object.values(mods).forEach(m => {
            const mod = m?.default;
            if (!mod) return;
            define(mod);
        });

        // 创建 Observer & ctx
        const obs = new Observer();
        const ctx = createCtx(obs);
        const rulesCompliance = {
            id: "rulesCompliance",
            order: 1,
            cfg: { rules_compliance: { enabled: false } },
            meta: {
                rules_compliance: {
                    label: "规则兼容模式（停用签到、翻页及后台站内请求；本地抽奖提醒不受影响）",
                    group: "🔒 隐私与规则"
                }
            },
            match: () => true
        };
        define(rulesCompliance);
        ensureIconGroup();
        const headEl = document.querySelector('#nsk-head');
        if (headEl) {
            let syncingIconGroup = false;
            const syncIconGroup = debounce(() => {
                if (syncingIconGroup) return;
                syncingIconGroup = true;
                try { ensureIconGroup(); } finally { syncingIconGroup = false; }
            }, 120);
            new MutationObserver(syncIconGroup).observe(headEl, { childList: true });
        }

        // 初始化 UI (依赖 layui)
        const initUI = () => {
            if (!window.layui?.layer) return (ctx.ui = {});
            const layer = window.layui.layer, uw = ctx.uw;
            ctx.ui = {
                layer,
                toast: (text, style) => { const idx = layer.msg(text, { offset: 't', area: ['100%', 'auto'], anim: 'slideDown' }); layer.style(idx, Object.assign({ opacity: 0.9 }, style)); return idx; },
                info: msg => ctx.ui.toast(msg, { "background-color": "#4D82D6" }),
                success: msg => ctx.ui.toast(msg, { "background-color": "#57BF57" }),
                warning: msg => ctx.ui.toast(msg, { "background-color": "#D6A14D" }),
                error: msg => ctx.ui.toast(msg, { "background-color": "#E1715B" }),
                alert: (t, c, fn) => uw?.mscAlert ? (c === undefined ? uw.mscAlert(t) : uw.mscAlert(t, c)) : layer.alert(c, { title: t, icon: 0, btn: ["确定"] }, fn),
                confirm: (t, c, y, n) => uw?.mscConfirm ? uw.mscConfirm(t, c, y, n) : layer.confirm(c, { title: t, icon: 0, btn: ["确定", "取消"] }, y, n),
                tips: (msg, el, opts) => layer.tips(msg, el, opts)
            };
        };
        initUI();
        if (!ctx.ui.layer) {
            const timer = setInterval(() => { if (window.layui?.layer) { initUI(); clearInterval(timer); } }, 100);
            setTimeout(() => clearInterval(timer), 5000);
        }

        // 启动所有模块
        /* ==========================================================================
           [ 🚀 基础功能 ] - 图床上传助手 (NodeImage)
           ========================================================================== */
        const imageUpload = {
            id: "imageUpload",
            deps: ["ui"],
            order: 150,
            cfg: { image_upload: { enabled: true, api_key: "" } },
            meta: {
                image_upload: {
                    label: "NodeImage 图片上传",
                    group: "🚀 基础功能",
                    fields: {
                        api_key: { type: "TEXT", label: "NodeImage API Key", placeholder: "请在扩展设置中填写" }
                    }
                }
            },
            match: ctx => (ctx.isPost || location.pathname.startsWith('/new-discussion') || location.pathname.startsWith('/notification'))
                && ctx.store.get("image_upload.enabled", true),
            init(ctx) {
                const APP = {
                    api: {
                        key: ctx.store.get("image_upload.api_key", ""),
                        setKey: key => {
                            ctx.store.set("image_upload.api_key", key);
                            ctx.store.set("image_upload.api_key_cleared", false);
                            APP.api.key = key;
                            UI.updateState();
                        },
                        clearKey: () => {
                            ctx.store.set("image_upload.api_key", "");
                            APP.api.key = '';
                            UI.updateState();
                        },
                        endpoints: {
                            upload: 'https://api.nodeimage.com/api/upload',
                            apiKey: 'https://api.nodeimage.com/api/user/api-key'
                        }
                    },
                    site: { url: 'https://www.nodeimage.com' },
                    storage: {
                        keys: { loginCheck: 'nodeimage_login_check', loginStatus: 'nodeimage_login_status', logout: 'nodeimage_logout' },
                        get: key => localStorage.getItem(APP.storage.keys[key]),
                        set: (key, value) => localStorage.setItem(APP.storage.keys[key], value),
                        remove: key => localStorage.removeItem(APP.storage.keys[key])
                    },
                    retry: { max: 2, delay: 1000 },
                    statusTimeout: 2000,
                    auth: { recentLoginGracePeriod: 30000, loginCheckInterval: 3000, loginCheckTimeout: 300000 }
                };

                const SELECTORS = { editor: '.CodeMirror', toolbar: '.mde-toolbar', imgBtn: '.toolbar-item.i-icon.i-icon-pic[title="图片"]', container: '#nodeimage-toolbar-container' };

                const STATUS = {
                    SUCCESS: { class: 'success', color: '#42d392' },
                    ERROR: { class: 'error', color: '#f56c6c' },
                    WARNING: { class: 'warning', color: '#e6a23c' },
                    INFO: { class: 'info', color: '#0078ff' }
                };

                const MESSAGE = { READY: '图床已就绪', UPLOADING: '上传中...', UPLOAD_SUCCESS: '上传成功！', LOGIN_EXPIRED: '图床登录已失效', LOGOUT: '图床已退出登录', RETRY: (c, m) => `重试 (${c}/${m})` };

                const DOM = {
                    editor: null,
                    statusElements: new Set(),
                    loginButtons: new Set(),
                    getEditor: () => DOM.editor?.CodeMirror
                };

                addStyle("nsx-image-upload", `
                #nodeimage-status { margin-left: 10px; display: inline-block; font-size: 13px; height: 28px; line-height: 28px; transition: all 0.3s ease; }
                #nodeimage-status.success { color: ${STATUS.SUCCESS.color}; }
                #nodeimage-status.error { color: ${STATUS.ERROR.color}; }
                #nodeimage-status.warning { color: ${STATUS.WARNING.color}; }
                #nodeimage-status.info { color: ${STATUS.INFO.color}; }
                .nodeimage-login-btn { cursor: pointer; margin-left: 10px; color: ${STATUS.WARNING.color}; font-size: 13px; background: rgba(230,162,60,0.1); padding: 3px 8px; border-radius: 4px; border: 1px solid rgba(230,162,60,0.2); }
                .nodeimage-toolbar-container { display: flex; align-items: center; margin-left: auto; margin-right: 10px; }
            `);

                const Utils = {
                    waitForElement: selector => new Promise(res => {
                        const el = document.querySelector(selector);
                        if (el) return res(el);
                        new MutationObserver((_, o) => { const found = document.querySelector(selector); if (found) { o.disconnect(); res(found); } }).observe(document.body, { childList: true, subtree: true });
                    }),
                    isEditingInEditor: () => { const a = document.activeElement; return a && (a.classList.contains('CodeMirror') || a.closest('.CodeMirror') || a.tagName === 'TEXTAREA'); },
                    getActiveCodeMirror: (evtTarget = null) => {
                        const fromTarget = evtTarget?.closest?.('.CodeMirror')?.CodeMirror;
                        if (fromTarget) return fromTarget;
                        const active = document.activeElement;
                        const fromActive = active?.closest?.('.CodeMirror')?.CodeMirror || (active?.classList?.contains('CodeMirror') ? active.CodeMirror : null);
                        if (fromActive) return fromActive;
                        return DOM.getEditor();
                    },
                    createFileInput: cb => { const i = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept: 'image/*' }); i.onchange = e => cb([...e.target.files]); i.click(); },
                    delay: ms => new Promise(r => setTimeout(r, ms))
                };

                const parseResponsePayload = response => {
                    if (response?.response != null) return response.response;
                    if (!response?.responseText) return null;
                    try { return JSON.parse(response.responseText); } catch { return response.responseText; }
                };

                const responseError = (response, fallback = 'NodeImage 请求失败') => {
                    const payload = parseResponsePayload(response);
                    const detail = payload?.error ?? payload?.message ?? payload?.detail ?? response?.error;
                    let message = fallback;
                    if (typeof detail === 'string' && detail.trim()) message = detail.trim();
                    else if (typeof payload === 'string' && payload.trim()) {
                        const raw = payload.trim();
                        if (/^<!doctype html|^<html/i.test(raw)) {
                            try {
                                const document = new DOMParser().parseFromString(raw, 'text/html');
                                document.querySelectorAll('script, style').forEach(element => element.remove());
                                message = document.body?.textContent?.replace(/\s+/g, ' ').trim() || fallback;
                            } catch {
                                message = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || fallback;
                            }
                        } else {
                            message = raw.replace(/\s+/g, ' ');
                        }
                        message = message.slice(0, 500);
                    }
                    else if (detail != null) {
                        try { message = JSON.stringify(detail); } catch { message = String(detail); }
                    }
                    const status = Number(response?.status) || 0;
                    const error = new Error(status ? `HTTP ${status}: ${message}` : message);
                    error.status = status;
                    error.payload = payload;
                    return error;
                };

                const API = {
                    request: ({ url, method = 'GET', data = null, headers = {}, withAuth = false }) => {
                        return new Promise((resolve, reject) => {
                            GM_xmlhttpRequest({
                                method, url,
                                headers: { 'Accept': 'application/json', ...(withAuth && APP.api.key ? { 'X-API-Key': APP.api.key } : {}), ...headers },
                                data, withCredentials: true, responseType: 'json',
                                onload: response => {
                                    const payload = parseResponsePayload(response);
                                    if (response.status === 200 && payload != null) resolve(payload);
                                    else reject(responseError(response, payload == null ? 'NodeImage 返回了空响应' : 'NodeImage 请求失败'));
                                },
                                onerror: response => reject(responseError(response, '无法连接 NodeImage'))
                            });
                        });
                    },
                    checkLoginAndGetKey: async () => {
                        if (ctx.store.get("image_upload.api_key_cleared", false)) return false;
                        try {
                            const response = await API.request({ url: APP.api.endpoints.apiKey });
                            if (response.api_key) { APP.api.setKey(response.api_key); return true; }
                            if (response.error) APP.api.clearKey();
                            return false;
                        } catch (error) { APP.api.clearKey(); return false; }
                    },
                    uploadImage: async (file, retries = 0) => {
                        try {
                            const formData = new FormData();
                            formData.append('image', file);
                            const result = await API.request({ url: APP.api.endpoints.upload, method: 'POST', data: formData, withAuth: true });
                            const links = result?.links || result?.data?.links || {};
                            const direct = links.direct || links.url || result?.url || result?.data?.url || '';
                            const markdown = links.markdown || result?.markdown || (direct ? `![](${direct})` : '');
                            if (result?.success !== false && markdown) return { url: direct, markdown };
                            else {
                                const detail = result?.error || result?.message || result?.detail;
                                const errorMsg = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : 'NodeImage 没有返回有效图片链接';
                                if (errorMsg.toLowerCase().match(/unauthorized|invalid api key|未授权|无效的api密钥/)) { APP.api.clearKey(); throw new Error(MESSAGE.LOGIN_EXPIRED); }
                                throw new Error(errorMsg);
                            }
                        } catch (error) {
                            if (error.status === 401 || error.status === 403) { APP.api.clearKey(); throw new Error(MESSAGE.LOGIN_EXPIRED); }
                            if (retries < APP.retry.max) {
                                setStatus(STATUS.WARNING.class, MESSAGE.RETRY(retries + 1, APP.retry.max));
                                await Utils.delay(APP.retry.delay);
                                return API.uploadImage(file, retries + 1);
                            }
                            throw error instanceof Error ? error : responseError(error);
                        }
                    }
                };

                const setStatus = (cls, msg, ttl = 0) => { DOM.statusElements.forEach(el => { el.className = cls; el.textContent = msg; }); if (ttl) return Utils.delay(ttl).then(UI.updateState); };

                const UI = {
                    updateState: () => {
                        const isLoggedIn = Boolean(APP.api.key);
                        DOM.loginButtons.forEach(btn => { btn.style.display = isLoggedIn ? 'none' : 'inline-block'; });
                        DOM.statusElements.forEach(el => {
                            if (isLoggedIn) { el.className = STATUS.SUCCESS.class; el.textContent = MESSAGE.READY; }
                            else { el.textContent = ''; }
                        });
                    },
                    openLogin: () => {
                        ctx.store.set("image_upload.api_key_cleared", false);
                        APP.storage.set('loginStatus', 'login_pending');
                        window.open(APP.site.url, '_blank');
                    },
                    setupToolbar: toolbar => {
                        if (!toolbar || toolbar.querySelector(SELECTORS.container)) return;
                        const container = document.createElement('div'); container.id = 'nodeimage-toolbar-container'; container.className = 'nodeimage-toolbar-container';

                        const fullScreenBtn = toolbar.querySelector('.i-icon-full-screen-one')?.parentElement || toolbar.querySelector('.i-icon-off-screen-one')?.parentElement || toolbar.querySelector('.toolbar-item.right');
                        if (fullScreenBtn) {
                            toolbar.insertBefore(container, fullScreenBtn);
                        } else {
                            toolbar.appendChild(container);
                        }

                        const imgBtn = toolbar.querySelector(SELECTORS.imgBtn);
                        if (imgBtn) {
                            const newBtn = imgBtn.cloneNode(true);
                            imgBtn.parentNode.replaceChild(newBtn, imgBtn);
                            newBtn.addEventListener('click', async () => {
                                DOM.editor = document.activeElement?.closest?.('.CodeMirror') || DOM.editor;
                                if (!APP.api.key || !(await Auth.checkLoginIfNeeded())) { UI.openLogin(); return; }
                                const targetCm = Utils.getActiveCodeMirror();
                                Utils.createFileInput(files => ImageHandler.handleFiles(files, targetCm));
                            });
                        }

                        const statusEl = document.createElement('div'); statusEl.id = 'nodeimage-status'; statusEl.className = STATUS.INFO.class;
                        container.appendChild(statusEl); DOM.statusElements.add(statusEl);
                        const loginBtn = document.createElement('div'); loginBtn.className = 'nodeimage-login-btn'; loginBtn.textContent = '登录 NodeImage';
                        loginBtn.addEventListener('click', UI.openLogin); loginBtn.style.display = 'none';
                        container.appendChild(loginBtn); DOM.loginButtons.add(loginBtn);
                        UI.updateState();
                    }
                };

                const ImageHandler = {
                    handlePaste: e => {
                        if (!Utils.isEditingInEditor()) return;
                        const targetCm = Utils.getActiveCodeMirror(e.target);
                        if (targetCm?.getWrapperElement) DOM.editor = targetCm.getWrapperElement();
                        const dt = e.clipboardData || e.originalEvent?.clipboardData; if (!dt) return;
                        let files = [];
                        if (dt.files && dt.files.length) { files = Array.from(dt.files).filter(f => f.type.startsWith('image/')); }
                        else if (dt.items && dt.items.length) { files = Array.from(dt.items).filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean); }
                        if (files.length) {
                            e.preventDefault(); e.stopPropagation();
                            if (!APP.api.key) { UI.openLogin(); return; }
                            ImageHandler.handleFiles(files, targetCm);
                        }
                    },
                    handleFiles: (files, targetCm = null) => {
                        if (!APP.api.key) { UI.openLogin(); return; }
                        files.filter(file => file?.type.startsWith('image/')).forEach(file => ImageHandler.uploadAndInsert(file, targetCm));
                    },
                    uploadAndInsert: async (file, targetCm = null) => {
                        setStatus(STATUS.INFO.class, MESSAGE.UPLOADING);
                        try {
                            const result = await API.uploadImage(file);
                            ImageHandler.insertMarkdown(result.markdown, targetCm);
                            await setStatus(STATUS.SUCCESS.class, MESSAGE.UPLOAD_SUCCESS, APP.statusTimeout);
                        } catch (error) {
                            if (error.message === MESSAGE.LOGIN_EXPIRED) await Auth.checkLoginIfNeeded(true);
                            console.error('[NodeImage]', error, { name: file.name, type: file.type, size: file.size });
                            await setStatus(STATUS.ERROR.class, `上传失败: ${error.message}`, APP.statusTimeout);
                            ctx.ui.error?.(`图片上传失败: ${error.message}`);
                        }
                    },
                    insertMarkdown: (markdown, preferredCm = null) => {
                        const cm = preferredCm || Utils.getActiveCodeMirror();
                        if (cm) { const cursor = cm.getCursor(); cm.replaceRange(`\n${markdown}\n`, cursor); }
                    }
                };

                const Auth = {
                    checkLoginIfNeeded: async (forceCheck = false) => {
                        if (APP.api.key && !forceCheck) return true;
                        const isLoggedIn = await API.checkLoginAndGetKey();
                        if (!isLoggedIn && APP.api.key) setStatus(STATUS.WARNING.class, MESSAGE.LOGIN_EXPIRED);
                        UI.updateState();
                        return isLoggedIn;
                    },
                    checkLogoutFlag: () => { if (APP.storage.get('logout') === 'true') { APP.api.clearKey(); APP.storage.remove('logout'); setStatus(STATUS.WARNING.class, MESSAGE.LOGOUT); } },
                    checkRecentLogin: async () => { const lastLoginCheck = APP.storage.get('loginCheck'); if (lastLoginCheck && (Date.now() - parseInt(lastLoginCheck) < APP.auth.recentLoginGracePeriod)) { await API.checkLoginAndGetKey(); APP.storage.remove('loginCheck'); } },
                    setupStorageListener: () => {
                        window.addEventListener('storage', event => {
                            const { loginStatus, logout } = APP.storage.keys;
                            if (event.key === loginStatus && event.newValue === 'login_success') { API.checkLoginAndGetKey(); localStorage.removeItem(loginStatus); }
                            else if (event.key === logout && event.newValue === 'true') { APP.api.clearKey(); localStorage.removeItem(logout); }
                        });
                    }
                };

                const initModule = async () => {
                    document.addEventListener('paste', ImageHandler.handlePaste, true);
                    window.addEventListener('focus', () => Auth.checkLoginIfNeeded());
                    Utils.waitForElement(SELECTORS.editor).then(editor => {
                        DOM.editor = editor;
                        editor.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
                        editor.addEventListener('drop', e => {
                            e.preventDefault(); e.stopPropagation();
                            const targetCm = Utils.getActiveCodeMirror(e.target);
                            if (targetCm?.getWrapperElement) DOM.editor = targetCm.getWrapperElement();
                            ImageHandler.handleFiles(Array.from(e.dataTransfer.files), targetCm);
                        });
                    });
                    Utils.waitForElement(SELECTORS.toolbar).then(UI.setupToolbar);
                    ctx.watch(SELECTORS.toolbar, () => {
                        const toolbar = document.querySelector(SELECTORS.toolbar);
                        if (toolbar && !toolbar.querySelector(SELECTORS.container)) UI.setupToolbar(toolbar);
                    }, { debounce: 200 });
                    const observer = new MutationObserver(() => {
                        const editor = document.querySelector(SELECTORS.editor);
                        if (editor) DOM.editor = editor;
                        const toolbar = document.querySelector(SELECTORS.toolbar);
                        if (toolbar && !toolbar.querySelector(SELECTORS.container)) UI.setupToolbar(toolbar);
                    });
                    observer.observe(document.body, {
                        childList: true,
                        subtree: true,
                        attributes: true,
                        attributeFilter: ['class', 'style']
                    });
                    document.addEventListener('click', e => {
                        if (e.target.closest('.tab-option')) {
                            setTimeout(() => {
                                const editor = document.querySelector(SELECTORS.editor);
                                if (editor) DOM.editor = editor;
                                const toolbar = document.querySelector(SELECTORS.toolbar);
                                if (toolbar && !toolbar.querySelector(SELECTORS.container)) UI.setupToolbar(toolbar);
                            }, 100);
                        }
                    });

                    Auth.checkLogoutFlag(); Auth.setupStorageListener(); await Auth.checkRecentLogin(); await Auth.checkLoginIfNeeded();
                };

                initModule();
            }
        };
        define(imageUpload);

        /* ========================================================================== 
           [ 🧭 辅助工具 ] - 新标签页打开链接修复
           ========================================================================== */
        const openInNewTabFix = {
            id: "openInNewTabFix",
            order: 390,
            match: () => true,
            meta: { open_post_in_new_tab: { label: "新标签页打开帖子", group: "🧭 辅助工具" } },
            init(ctx) {
                const selector = 'a[href^="/post-"]';
                let enabled = false;
                const syncPreference = async () => {
                    if (ctx.site?.code !== "ns") return;
                    const config = await readNsPreferenceConfig() || {};
                    if (config.openPostInNewPage === enabled) return;
                    config.openPostInNewPage = enabled;
                    await writeNsPreferenceConfig(config);
                };
                const applyTargets = (els = document.querySelectorAll(selector)) => {
                    els.forEach(anchor => {
                        if (enabled) anchor.setAttribute("target", "_blank");
                        else anchor.removeAttribute("target");
                    });
                };
                const apply = () => {
                    enabled = ctx.store.get("open_post_in_new_tab.enabled", false) === true;
                    applyTargets();
                    syncPreference();
                };
                document.addEventListener("click", event => {
                    if (enabled) return;
                    const anchor = event.target?.closest?.(selector);
                    if (!anchor) return;
                    anchor.removeAttribute("target");
                    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || anchor.hasAttribute("download")) return;
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    location.assign(anchor.href);
                }, true);
                ctx.watch(selector, applyTargets, { debounce: 100 });
                window.__nsxRuntime ||= {};
                window.__nsxRuntime.refreshOpenPostInNewTab = apply;
                apply();
            }
        };
        define(openInNewTabFix);

        /* ==========================================================================
           [ 🎨 视觉美化 ] - 名望诊断系统 (Reputation System)
           ========================================================================== */
        const inlineUserInfo = {
            id: "inlineUserInfo",
            deps: ["ui"],
            order: 390,
            cfg: {
                inline_user_info: {
                    enabled: true,
                    show_op: true,
                    show_cmt: true,
                    label_size: "standard",
                    labels: {
                        level: true, chicken: true, join_days: true, user_id: true, username: true,
                        stardust: true, registered_at: true, role: true, admin: false,
                        topics: false, comments: false, following: false, followers: false,
                        favorites: false, score: false, diagnosis: false, followed: false
                    },
                    level_colors: {
                        lv1: "#e53935", lv2: "#fd6f3a", lv3: "#11c87d",
                        lv4: "#2d86ff", lv5: "#ffb300", lv6: "#6f58ff"
                    },
                    level_opacity: { lv1: 100, lv2: 100, lv3: 100, lv4: 100, lv5: 100, lv6: 100 },
                    simple_lv_style: false,
                    simple_lv_color: "rgba(0, 206, 209, 1)"
                }
            },
            meta: {
                inline_user_info: {
                    label: "名望诊断系统",
                    group: "🧭 辅助工具",
                    fields: {
                        show_op: { type: "SWITCH", label: "作用于楼主" },
                        show_cmt: { type: "SWITCH", label: "作用于评论" },
                        label_size: { type: "SELECT", label: "标签尺寸", options: { compact: "紧凑", standard: "标准", large: "宽松" } },
                        simple_lv_style: { type: "SWITCH", label: "简洁颜色模式" },
                        simple_lv_color: { type: "COLOR", label: "简洁模式颜色" }
                    }
                }
            },
            match: ctx => ctx.loggedIn && ctx.isPost && !ctx.store.get("rules_compliance.enabled", true) && (ctx.store.get("inline_user_info.enabled", true) || ctx.store.get("relation.show_friend_btn", true) || ctx.store.get("relation.show_block_btn", true) || ctx.store.get("communication_quick_links.enabled", true)),
            init(ctx) {
                const showOp = ctx.store.get("inline_user_info.show_op", true);
                const showCmt = ctx.store.get("inline_user_info.show_cmt", true);
                const simpleLvStyle = ctx.store.get("inline_user_info.simple_lv_style", false);
                const simpleLvColorCfg = (ctx.store.get("inline_user_info.simple_lv_color", "rgba(0, 206, 209, 1)") || "").trim();
                const labelSize = ctx.store.get("inline_user_info.label_size", "standard");
                const labelDefaults = {
                    level: true, chicken: true, join_days: true, user_id: true, username: true,
                    stardust: true, registered_at: true, role: true, admin: false,
                    topics: false, comments: false, following: false, followers: false,
                    favorites: false, score: false, diagnosis: false, followed: false
                };
                const levelColorDefaults = ["#e53935", "#fd6f3a", "#11c87d", "#2d86ff", "#ffb300", "#6f58ff"];
                const labelEnabled = key => ctx.store.get(`inline_user_info.labels.${key}`, labelDefaults[key] ?? false);
                const escapeInlineHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
                    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
                })[char]);
                const firstValue = (...values) => values.find(value => value !== undefined && value !== null && value !== "");
                const primitiveValue = (...values) => {
                    const value = firstValue(...values);
                    return ["string", "number"].includes(typeof value) ? value : "";
                };
                const finiteValue = (...values) => {
                    const value = firstValue(...values);
                    return value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
                };
                const trueValue = value => value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
                const cache = new Map();
                const fetching = new Map();
                let fetchQueue = Promise.resolve(); // 用于控制并发的队列列车

                addStyle("nsx-lv-colors", `.role-tag.user-level{color:#fafafa;font-weight:bold;}.user-lv0{background:#b71c1c;border-color:#b71c1c}.user-lv1{background:#e53935;border-color:#e53935}.user-lv2{background:#f57c00;border-color:#f57c00}.user-lv3{background:#ffca28;border-color:#ffca28;color:#333}.user-lv4{background:#cddc39;border-color:#cddc39;color:#333}.user-lv5{background:#7cb342;border-color:#7cb342}.user-lv6{background:#43a047;border-color:#43a047}.user-lv7{background:#00897b;border-color:#00897b}.user-lv8{background:#039be5;border-color:#039be5}.user-lv9{background:#1e88e5;border-color:#1e88e5}.user-lv10{background:#3949ab;border-color:#3949ab}.user-lv11{background:#5e35b1;border-color:#5e35b1}.user-lv12{background:#8e24aa;border-color:#8e24aa}.user-lv13{background:#d81b60;border-color:#d81b60}.user-lv14{background:#546e7a;border-color:#546e7a}.user-lv15{background:#212121;border-color:#212121;color:#ffca28}`);
                addStyle("nsx-inline-communication", `
                    .nsx-inline-communication{display:inline-flex;align-items:center;gap:4px;margin-left:6px;vertical-align:middle}
                    .nsx-inline-communication .nsx-communication-btn{display:inline-flex;align-items:center;justify-content:center;gap:3px;min-height:22px;padding:2px 7px;border:1px solid currentColor;border-radius:4px;background:transparent;color:currentColor;text-decoration:none!important;font-size:11px;font-weight:600;line-height:16px;box-sizing:border-box;opacity:.9;transition:opacity .15s,transform .15s}
                    .nsx-inline-communication .nsx-communication-btn:hover{opacity:1;transform:translateY(-1px)}
                    .nsx-inline-communication .nsx-communication-btn:active{transform:translateY(0)}
                    .nsx-inline-communication .nsx-communication-btn img{display:block;width:14px;height:14px;object-fit:contain;flex:0 0 14px}
                    .nsx-inline-communication .nsx-btn-message{color:#00a884}
                    .nsx-inline-communication .nsx-btn-telegram{color:#229ed9}
                    .dark-layout .nsx-inline-communication .nsx-communication-btn{background:rgba(255,255,255,.04)}
                    .nsx-mobile .nsx-inline-communication{gap:3px;margin-left:4px}
                    .nsx-mobile .nsx-inline-communication .nsx-communication-btn{width:40px;min-width:40px;height:40px;min-height:40px;padding:0;flex:0 0 auto;position:static!important}
                    .nsx-mobile .nsx-inline-communication .nsx-communication-label{display:none}
                    .nsx-mobile .nsx-inline-communication .nsx-communication-icon-fallback{width:auto;padding:0 4px}
                    .nsx-mobile .nsx-inline-communication .nsx-communication-icon-fallback .nsx-communication-label{display:inline;font-size:10px}
                `);

                const calculateJoinDays = (createdAt) => {
                    if (!createdAt) return '未知';
                    const diffTime = Math.abs(new Date() - new Date(createdAt));
                    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                };

                const display = async (el) => {
                    const isCmt = el.closest('.comment-item, .comments > li') !== null;
                    if (isCmt && !showCmt) return;
                    if (!isCmt && !showOp) return;

                    if (el.dataset.nsxInfoLoaded) return;
                    el.dataset.nsxInfoLoaded = "1";

                    const metaInfo = el.closest('.nsk-content-meta-info');
                    if (!metaInfo) return;

                    const match = el.href.match(/\/space\/(\d+)/);
                    const userId = match ? match[1] : null;
                    const username = el.textContent.trim();

                    // --- A. 帖内信息扩展逻辑 ---
                    const showInfo = ctx.store.get("inline_user_info.enabled", true);
                    if (showInfo && userId) {
                        let userData = cache.get(userId);
                        if (!userData) {
                            if (!fetching.has(userId)) {
                                const p = fetchQueue.then(() => new Promise((resolve) => {
                                    setTimeout(async () => {
                                        try {
                                            const r = await ctx.net.get(`/api/account/getInfo/${userId}`);
                                            resolve(r?.success ? r.detail : null);
                                        } catch (e) { resolve(null); }
                                    }, 300);
                                }));
                                fetching.set(userId, p);
                                fetchQueue = p;
                            }
                            userData = await fetching.get(userId);
                            if (userData) cache.set(userId, userData);
                        }

                        if (userData && !metaInfo.querySelector('.nsx-user-info-display')) {
                            const createdAt = userData.created_at;
                            const joinDays = calculateJoinDays(createdAt);
                            const coins = userData.coin || 0;
                            const nPost = userData.nPost || 0;
                            const nComment = userData.nComment || 0;
                            const totalAct = nPost + nComment;
                            const dailyAct = totalAct / (joinDays || 1);
                            const coinPerDay = coins / (joinDays || 1);
                            const coinPerAct = totalAct > 0 ? (coins / totalAct) : 0;
                            const rank = Math.min(6, Math.floor(Math.sqrt(coins || 0) / 10));

                            // 🎯 核心算法 V2.0 - 精准建模与反干扰
                            // 30 天成熟基线：仅按注册天数计算，不依赖鸡腿数量
                            const MATURE_DAYS = 30;

                            // 1. 资历分平滑处理 (Smooth Seniority)
                            const alpha = Math.min(joinDays / MATURE_DAYS, 1); // 0-1 之间的权重系数
                            const baseSeniority = Math.min(25, joinDays / 25);
                            const lowSeniority = Math.min(5, joinDays / 100);
                            const seniorityScore = baseSeniority * alpha + lowSeniority * (1 - alpha);

                            // 2. 活跃分与灌水惩罚 (Spam Penalty)
                            const actVal = Math.max(Math.min(25, dailyAct * 15), Math.min(25, totalAct / 15));
                            const spamPenalty = dailyAct > 24 ? Math.max(0.5, 1 - (dailyAct - 24) / 40) : 1;
                            const actScore = actVal * spamPenalty;

                            // 3. 财富分 (Wealth)
                            const wealthScore = Math.max(Math.min(20, coinPerDay * 5), Math.min(20, coins / 80));

                            // 4. 内容质量分受控模型 (Confidence Control)
                            // 先估算系统可解释鸡腿，再用额外鸡腿衡量社区认可度，避免误伤高活跃用户
                            const baseSignupCoins = 90;
                            const baseReplyCoins = Math.min(nComment, joinDays * 20) * 1;
                            const basePostCoins = Math.min(nPost, joinDays * 4) * 5;
                            const baseSigninCoins = joinDays * 5;
                            const estimatedBaseCoins = baseSignupCoins + baseReplyCoins + basePostCoins + baseSigninCoins;
                            const extraCoins = Math.max(0, coins - estimatedBaseCoins);
                            const extraPerAct = extraCoins / Math.max(totalAct, 1);

                            // 引入[质量置信度]，发言数过少时，质量分影响力按比例压缩
                            const qualityConfidence = Math.min(totalAct / 10, 1);
                            const rawQualityScore = extraPerAct * 18;
                            const qualityScore = Math.min(30, rawQualityScore) * qualityConfidence;

                            // 5. 传奇贡献加成
                            const isLegend = rank >= 6 && nPost >= 500 && nComment >= 5000;
                            const isFamous = rank >= 6 && nPost >= 200 && nComment >= 2000;

                            let trustScore = seniorityScore + actScore + wealthScore + qualityScore;
                            if (isLegend) trustScore += 15;

                            let trustLevel = "正常用户", trustColor = "#8bc34a";

                            // --- V5.1 绝对门槛名望诊断矩阵 ---
                            const isAbandoned = joinDays > 100 && coinPerDay < (5 / 3);
                            const isNewbie = joinDays < MATURE_DAYS;

                            if (isAbandoned) {
                                trustScore *= 0.2;
                                trustLevel = "疑似小号";
                                trustColor = "#ff5252";
                            } else if (isNewbie) {
                                trustLevel = "新手上路";
                                trustColor = "linear-gradient(135deg, #89f7fe, #66a6ff)";
                                trustScore = Math.min(trustScore, 70);
                            } else {
                                // 灌水硬指标：
                                // tavgReplyPerDay = totalAct / joinDays
                                // 最终判定：tavgReplyPerDay >= 40 且额外鸡腿质量偏低
                                const tavgReplyPerDay = totalAct / Math.max(joinDays, 1);
                                const lowQuality = extraPerAct < 1.05;
                                const spamLikely = tavgReplyPerDay >= 40 && lowQuality;

                                if (spamLikely) {
                                    trustLevel = "灌水机器";
                                    trustColor = "#ff6d00";
                                    // 仅按额外质量分段惩罚
                                    if (extraPerAct < 0.35) trustScore *= 0.65;
                                    else if (extraPerAct < 0.7) trustScore *= 0.75;
                                    else trustScore *= 0.85;
                                } else if (totalAct < 5) {
                                    trustLevel = "潜水员";
                                    trustColor = "#90a4ae";
                                } else {
                                    // 判级优先级：硬指标优先
                                    if (trustScore >= 90 && isLegend) {
                                        trustLevel = "名震天下";
                                        trustColor = "linear-gradient(135deg, #FFF5C3, #FFD700, #B8860B)";
                                    } else if (trustScore >= 75 && isFamous) {
                                        trustLevel = "声名大噪";
                                        trustColor = "linear-gradient(135deg, #f093fb, #f5576c)";
                                    } else if (trustScore >= 60) {
                                        trustLevel = "活跃精英";
                                        trustColor = "linear-gradient(135deg, #00D2FF, #3A7BD5)";
                                    } else if (trustScore >= 40) {
                                        trustLevel = "初露锋芒";
                                        trustColor = "linear-gradient(135deg, #96C93D, #00B09B)";
                                    } else if (trustScore >= 20) {
                                        trustLevel = "籍籍无名";
                                        trustColor = "linear-gradient(135deg, #FAD0C4, #FF9A9E)";
                                    } else {
                                        trustLevel = "深度隐匿";
                                        trustColor = "linear-gradient(135deg, #BDC3C7, #2C3E50)";
                                    }
                                }
                            }

                            trustScore = Math.floor(Math.min(100, Math.max(0, trustScore)));

                            const levelNumber = Math.max(1, Math.min(6, Number(rank) || 1));
                            const configuredColor = ctx.store.get(`inline_user_info.level_colors.lv${levelNumber}`, levelColorDefaults[levelNumber - 1]);
                            const lvColor = /^#[0-9a-f]{6}$/i.test(String(configuredColor)) ? configuredColor : levelColorDefaults[levelNumber - 1];
                            const lvGradient = lvColor;
                            const opacity = Math.max(20, Math.min(100, Number(ctx.store.get(`inline_user_info.level_opacity.lv${levelNumber}`, 100)) || 100)) / 100;
                            const sizeMap = {
                                compact: { font: 10, padY: 1, padX: 5 },
                                standard: { font: 11, padY: 2, padX: 7 },
                                large: { font: 12, padY: 3, padX: 9 }
                            };
                            const size = sizeMap[labelSize] || sizeMap.standard;
                            const createdDate = createdAt ? new Date(createdAt) : null;
                            const registeredAt = createdDate && !Number.isNaN(createdDate.getTime()) ? createdDate.toLocaleDateString("zh-CN") : "";
                            const role = primitiveValue(userData.role_name, userData.role, userData.member_role, userData.group_name, userData.member_group);
                            const isAdmin = trueValue(firstValue(userData.is_admin, userData.admin, userData.isAdmin, userData.is_moderator));
                            const following = finiteValue(userData.nFollowing, userData.following_count, userData.following);
                            const followers = finiteValue(userData.nFollowers, userData.followers_count, userData.followers);
                            const favorites = finiteValue(userData.nFavorite, userData.nFavorites, userData.favorite_count, userData.favorites_count);
                            const isFollowed = trueValue(firstValue(userData.is_following, userData.followed, userData.isFollowed));

                            const infoSpanDiv = document.createElement('span');
                            infoSpanDiv.className = `nsx-user-info-display nsx-user-info-${labelSize}`;
                            infoSpanDiv.style.cssText = `display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px;user-select:text;margin-left:4px;cursor:help;vertical-align:middle;`;
                            const addLabel = (key, text, options = {}) => {
                                if (!labelEnabled(key) || text === "" || text === null || text === undefined) return;
                                const badge = options.href ? document.createElement("a") : document.createElement("span");
                                badge.className = `nsk-badge role-tag nsx-user-data-badge nsx-user-data-${key}`;
                                if (options.href) {
                                    badge.href = options.href;
                                    badge.target = "_blank";
                                    badge.rel = "noopener noreferrer";
                                }
                                badge.textContent = text;
                                const color = options.color || "#64748b";
                                badge.style.cssText = `font-size:${size.font}px;padding:${size.padY}px ${size.padX}px;border-radius:4px;vertical-align:middle;line-height:1.35;opacity:${options.opacity ?? 0.95};text-decoration:none;` + (options.level
                                    ? (simpleLvStyle
                                        ? `background:transparent;border:1px solid ${simpleLvColorCfg || color};color:${simpleLvColorCfg || color}!important;text-shadow:none;`
                                        : `background:${color};border:1px solid ${color};color:#fff!important;`)
                                    : `background:transparent;border:1px solid color-mix(in srgb, ${color} 55%, transparent);color:${color}!important;`);
                                infoSpanDiv.appendChild(badge);
                            };

                            addLabel("level", `Lv ${rank}`, { color: lvColor, opacity, level: true });
                            addLabel("chicken", `鸡腿 ${coins}`, { color: "#d97706" });
                            addLabel("join_days", `加入 ${joinDays}天`, { color: "#0284c7" });
                            addLabel("user_id", `ID ${userId}`);
                            addLabel("username", `用户 ${username}`);
                            addLabel("stardust", `星尘 ${userData.stardust || 0}`, { color: "#a21caf" });
                            addLabel("registered_at", registeredAt ? `注册 ${registeredAt}` : "");
                            addLabel("role", role ? `角色 ${role}` : "");
                            addLabel("admin", isAdmin ? "管理" : "", { color: "#dc2626" });
                            addLabel("topics", `主题 ${nPost}`, { href: `/space/${userId}#/discussions`, color: "#2563eb" });
                            addLabel("comments", `评论 ${nComment}`, { href: `/space/${userId}#/comments`, color: "#0891b2" });
                            addLabel("following", following === null ? "" : `关注 ${following}`);
                            addLabel("followers", followers === null ? "" : `粉丝 ${followers}`);
                            addLabel("favorites", favorites === null ? "" : `收藏 ${favorites}`);
                            addLabel("score", `评分 ${trustScore}`, { color: "#16a34a" });
                            addLabel("diagnosis", `诊断 ${trustLevel}`, { color: "#7c3aed" });
                            addLabel("followed", isFollowed ? "已关注" : "", { color: "#059669" });

                            if (!infoSpanDiv.childElementCount) return;

                            let hoverTimer;
                            infoSpanDiv.onmouseenter = () => {
                                clearTimeout(hoverTimer);
                                // 动态适配主题色（每次悬浮时重新检测）
                                // 修正：NodeSeek 的深色模式类通常在 body 上
                                const currentIsDark = document.body.classList.contains('dark-layout') || document.documentElement.classList.contains('dark');
                                const tipBg = currentIsDark ? '#2a2a2a' : '#fff';
                                const tipColor = currentIsDark ? '#e0e0e0' : '#1f1f1f';
                                const tipBorder = currentIsDark ? '#444' : '#e4e4e4';
                                const tipDiv = currentIsDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';

                                const hoverContent = `
                                    <div style="padding:10px;min-width:180px;color:${tipColor};background:${tipBg};border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15); border:1px solid ${tipBorder};">
                                        <div style="font-weight:bold;margin-bottom:8px;border-bottom:1px solid ${tipDiv};padding-bottom:5px;display:flex;justify-content:space-between;align-items:center;">
                                            <span style="font-size:14px;">${escapeInlineHtml(username)}</span>
                                            <span style="background:${lvGradient};-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-size:15px;font-weight:900;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.1));">Lv ${rank}</span>
                                        </div>
                                        <div style="text-align:center;margin-bottom:6px;font-size:13px;">注册 <span class="layui-badge layui-bg-blue" style="height:18px;line-height:18px;">${joinDays}</span> 天</div>
                                        <div style="display:grid;grid-template-columns:1fr auto 1fr;gap:4px 12px;align-items:center;font-size:12px;">
                                            <div style="text-align:right;">主题 <a href="/space/${userId}#/discussions" target="_blank" style="font-weight:bold;color:#4fc3f7;text-decoration:underline;">${userData.nPost || 0}</a></div>
                                            <div style="color:${tipDiv};font-size:11px;user-select:none;">|</div>
                                            <div style="text-align:left;">评论 <a href="/space/${userId}#/comments" target="_blank" style="font-weight:bold;color:#4fc3f7;text-decoration:underline;">${userData.nComment || 0}</a></div>

                                            <div style="text-align:right;">鸡腿 <b style="color:#ffb300;">${userData.coin || 0}</b></div>
                                            <div style="color:${tipDiv};font-size:11px;user-select:none;">|</div>
                                            <div style="text-align:left;">星尘 <b style="color:#e040fb;">${userData.stardust || 0}</b></div>

                                            <div style="text-align:right;">评分 <b style="background:${trustColor};-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:bold;filter:drop-shadow(0 0 1px rgba(0,0,0,0.3));">${trustScore}</b>/100</div>
                                            <div style="color:${tipDiv};font-size:11px;user-select:none;">|</div>
                                            <div style="text-align:left;">诊断 <b style="background:${trustColor};-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:bold;filter:drop-shadow(0 0 1px rgba(0,0,0,0.3));">${trustLevel}</b></div>
                                        </div>
                                    </div>
                                `;

                                ctx.ui.tips?.(hoverContent, infoSpanDiv, {
                                    tips: [3, tipBg],
                                    time: 0,
                                    success: (layero, index) => {
                                        if (layero && layero[0]) {
                                            // 移除 Layer 默认的外层背景、阴影和边框，只保留我们自定义的圆角容器
                                            layero.css({ 'background-color': 'transparent', 'box-shadow': 'none', 'border': 'none' });
                                            layero.find('.layui-layer-content').css({ 'padding': '0', 'overflow': 'visible' });
                                            layero.find('.layui-layer-TipsG').css('display', 'none'); // 隐藏那个小三角形，让界面更清爽

                                            layero[0].onmouseenter = () => clearTimeout(hoverTimer);
                                            layero[0].onmouseleave = () => hoverTimer = setTimeout(() => ctx.ui.layer?.close?.(index), 200);
                                        }
                                    }
                                });
                            };
                            infoSpanDiv.onmouseleave = () => {
                                hoverTimer = setTimeout(() => ctx.ui.layer?.closeAll?.('tips'), 250);
                            };
                            el.after(infoSpanDiv);
                        }
                    }

                    // --- B. 独立社交按钮逻辑 ---
                    const showFriend = ctx.store.get("relation.show_friend_btn", true);
                    const showBlock = ctx.store.get("relation.show_block_btn", true);
                    const communicationEnabled = ctx.store.get("communication_quick_links.enabled", true);
                    const showMessage = communicationEnabled && ctx.store.get("communication_quick_links.show_message", true);
                    const showTelegram = communicationEnabled && ctx.store.get("communication_quick_links.show_telegram", true);
                    if (showFriend || showBlock) {
                        const blacklist = JSON.parse(localStorage.getItem('nsx_advanced_blacklist') || '{}');
                        const friends = JSON.parse(localStorage.getItem('nsx_advanced_friends') || '{}');
                        let userGroups = new Map();
                        try {
                            const groups = JSON.parse(localStorage.getItem('nsx_content_rule_groups') || '{}')?.users;
                            userGroups = new Map((Array.isArray(groups) ? groups : []).map(item => [String(item?.id || ''), item || {}]));
                        } catch { }
                        const blacklistRule = blacklist[username];
                        const isBlocked = Boolean(blacklistRule) && blacklistRule.enabled !== false && (!blacklistRule.group || userGroups.get(String(blacklistRule.group))?.enabled !== false);
                        const isFriend = !!friends[username];
                        const normalizeInlineBlacklistMode = (mode, fallback = "fold") => {
                            const val = mode === "hide" ? "official" : mode;
                            return ["fold", "official", "mark"].includes(val) ? val : fallback;
                        };

                        const bindInlineAction = (btn, isTrue, key, map, msgOn, msgOff, targetUserId) => {
                            btn.onclick = () => {
                                if (isTrue) {
                                    delete map[username];
                                    localStorage.setItem(key, JSON.stringify(map));
                                    ctx.ui.toast(msgOff);
                                    setTimeout(() => location.reload(), 800);
                                } else {
                                    if (key === 'nsx_advanced_blacklist' && ctx.ui?.layer) {
                                        const defaultMode = normalizeInlineBlacklistMode(ctx.store.get("relation.blacklist_mode", "fold"));
                                        const isMb = document.documentElement.classList.contains('nsx-mobile');
                                        const html = `
                                            <div class="layui-form nsx-block-form" style="padding:20px 20px 0;">
                                                <div class="layui-form-item">
                                                    <label class="layui-form-label" style="width:72px;padding-left:0;">备注</label>
                                                    <div class="layui-input-block" style="margin-left:${isMb ? '0' : '92px'};">
                                                        <input type="text" id="nsx-blacklist-remark" class="layui-input" placeholder="可选备注">
                                                    </div>
                                                </div>
                                                <div class="layui-form-item">
                                                    <label class="layui-form-label" style="width:72px;padding-left:0;">模式</label>
                                                    <div class="layui-input-block" style="margin-left:${isMb ? '0' : '92px'};">
                                                        <select id="nsx-blacklist-mode">
                                                            <option value="fold" ${defaultMode === 'fold' ? 'selected' : ''}>优雅折叠</option>
                                                            <option value="official" ${defaultMode === 'official' ? 'selected' : ''}>官方屏蔽</option>
                                                            <option value="mark" ${defaultMode === 'mark' ? 'selected' : ''}>标记模式</option>
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>`;
                                        ctx.ui.layer.open({
                                            title: msgOn,
                                            content: html,
                                            area: ['min(460px,94vw)', 'auto'],
                                            skin: 'nsx-mode-layer',
                                            btn: ['确定', '取消'],
                                            success: (l) => {
                                                layui.use(['form'], function () {
                                                    layui.form.render('select');
                                                });
                                                l.find('#nsx-blacklist-remark').focus();
                                            },
                                            yes: async (pIndex, l) => {
                                                const val = l.find('#nsx-blacklist-remark').val().trim();
                                                const selectedMode = normalizeInlineBlacklistMode(l.find('#nsx-blacklist-mode').val(), defaultMode);
                                                if (selectedMode === 'official') {
                                                    try {
                                                        const r = await ctx.net.post("/api/block-list/add", { block_member_name: username });
                                                        if (!r?.success) {
                                                            ctx.ui.alert("同步失败", r?.message || "官方接口调用失败，仅保存本地备注");
                                                        }
                                                    } catch (e) {
                                                        env.error("Sync Official Block Failed", e);
                                                    }
                                                }
                                                map[username] = { remark: val, time: new Date().toLocaleString(), userId: targetUserId, mode: selectedMode };
                                                localStorage.setItem(key, JSON.stringify(map));
                                                ctx.ui.layer.close(pIndex);
                                                ctx.ui.toast("操作成功");
                                                setTimeout(() => location.reload(), 800);
                                            }
                                        });
                                        return;
                                    }
                                    ctx.ui.layer.prompt({ title: msgOn }, async (val, pIndex) => {
                                        map[username] = { remark: val, time: new Date().toLocaleString(), userId: targetUserId };
                                        localStorage.setItem(key, JSON.stringify(map));
                                        ctx.ui.layer.close(pIndex);
                                        ctx.ui.toast("操作成功");
                                        setTimeout(() => location.reload(), 800);
                                    });
                                }
                            };
                        };

                        const btnWrap = document.createElement('span');
                        btnWrap.className = 'nsx-relation-btn-wrap';
                        btnWrap.style.cssText = 'display:inline-flex;gap:4px;vertical-align:middle;margin-left:8px;';

                        if (showFriend) {
                            const frBtn = document.createElement('span');
                            frBtn.className = 'nsx-relation-btn nsx-btn-friend';
                            frBtn.innerHTML = document.documentElement.classList.contains('nsx-mobile')
                                ? (isFriend ? '✖' : '➕')
                                : (isFriend ? '✖ 好友' : '➕ 好友');
                            bindInlineAction(frBtn, isFriend, 'nsx_advanced_friends', friends, `添加 ${username} 为好友`, `已取消关注 ${username}`, userId);
                            btnWrap.appendChild(frBtn);
                        }
                        if (showBlock) {
                            const blBtn = document.createElement('span');
                            blBtn.className = 'nsx-relation-btn nsx-btn-block';
                            blBtn.innerHTML = document.documentElement.classList.contains('nsx-mobile')
                                ? (isBlocked ? '⭕' : '🚫')
                                : (isBlocked ? '⭕ 解除' : '🚫 屏蔽');
                            bindInlineAction(blBtn, isBlocked, 'nsx_advanced_blacklist', blacklist, `屏蔽 ${username}`, `已解除屏蔽 ${username}`, userId);
                            btnWrap.appendChild(blBtn);
                        }

                        const floorWrapper = metaInfo.querySelector('.floor-link-wrapper');
                        if (floorWrapper) floorWrapper.prepend(btnWrap);
                        else {
                            const anchor = metaInfo.querySelector('.floor-link, .post-info, .comment-info');
                            if (anchor) anchor.before(btnWrap);
                        }
                    }

                    const findTelegramLink = () => {
                        const postItem = metaInfo.closest('.nsk-post, .comments > li, li.comment-item, .comment-item, li');
                        const signature = postItem?.querySelector('.signature');
                        if (!signature) return '';
                        const isTelegramUrl = value => {
                            if (/^tg:\/\//i.test(value)) return true;
                            try {
                                const host = new URL(value, location.href).hostname.toLowerCase();
                                return ['t.me', 'telegram.me', 'telegram.dog', 'web.telegram.org'].includes(host);
                            } catch { return false; }
                        };
                        const linked = [...signature.querySelectorAll('a[href]')]
                            .map(link => link.href?.trim())
                            .find(isTelegramUrl);
                        if (linked) return linked;
                        const signatureText = signature.textContent || '';
                        const urlMatch = signatureText.match(/(?:https?:\/\/)?(?:t\.me|telegram\.me|telegram\.dog)\/([A-Za-z0-9_]{5,32})\b/i);
                        if (urlMatch) return `https://t.me/${urlMatch[1]}`;
                        const handleMatch = signatureText.match(/(?:^|[\s(（\[【])@([A-Za-z0-9_]{5,32})\b/);
                        return handleMatch ? `https://t.me/${handleMatch[1]}` : '';
                    };
                    const telegramLink = showTelegram ? findTelegramLink() : '';
                    if ((showMessage && userId) || telegramLink) {
                        const communicationWrap = document.createElement('span');
                        communicationWrap.className = 'nsx-inline-communication';
                        communicationWrap.dataset.username = username;
                        const getSiteLogo = () => {
                            const icon = [...document.querySelectorAll('link[rel~="icon"],link[rel="apple-touch-icon"]')]
                                .find(item => item.href);
                            try { return icon ? new URL(icon.href, location.href).href : `${location.origin}/favicon.ico`; }
                            catch { return `${location.origin}/favicon.ico`; }
                        };
                        const addCommunicationLink = ({ title, label, href, logo, className }) => {
                            const link = document.createElement('a');
                            link.className = `nsx-communication-btn ${className}`;
                            link.href = href;
                            link.target = '_blank';
                            link.rel = 'noopener noreferrer';
                            link.title = `${title} ${username}`;
                            link.setAttribute('aria-label', `${title} ${username}`);
                            const icon = document.createElement('img');
                            icon.src = logo;
                            icon.alt = '';
                            icon.setAttribute('aria-hidden', 'true');
                            icon.loading = 'lazy';
                            const text = document.createElement('span');
                            text.className = 'nsx-communication-label';
                            text.textContent = label;
                            icon.addEventListener('error', () => {
                                icon.remove();
                                link.classList.add('nsx-communication-icon-fallback');
                            }, { once: true });
                            link.append(icon, text);
                            communicationWrap.appendChild(link);
                        };
                        if (showMessage && userId) {
                            addCommunicationLink({
                                title: '站内私信',
                                label: 'PM',
                                href: new URL(`/notification#/message?mode=talk&to=${encodeURIComponent(userId)}`, location.origin).href,
                                logo: getSiteLogo(),
                                className: 'nsx-btn-message'
                            });
                        }
                        if (telegramLink) {
                            addCommunicationLink({
                                title: 'Telegram',
                                label: 'TG',
                                href: telegramLink,
                                logo: 'https://telegram.org/img/t_logo.svg',
                                className: 'nsx-btn-telegram'
                            });
                        }
                        const levelBadge = metaInfo.querySelector('.nsx-user-info-display');
                        (levelBadge || el).after(communicationWrap);
                    }
                };

                const processUsers = () => ctx.$$('.nsk-content-meta-info .author-info > a[href*="/space/"]').forEach(display);
                processUsers();
                ctx.watch('.nsk-content-meta-info .author-info > a[href*="/space/"]', processUsers, { debounce: 200 });
            }
        };
        define(inlineUserInfo);

        /* ==========================================================================
           [ 🤝 社交关系 ] - 用户关系管理 (关注/好友)
           ========================================================================== */
        const userRelation = {
            id: "userRelation",
            deps: ["ui"],
            order: 390,
            cfg: {
                relation: {
                    show_friend_btn: true,
                    friend_btn_color: "#00b894",
                    show_block_btn: true,
                    block_btn_color: "#d63031",
                    blacklist_enabled: true,
                    blacklist_mode: "fold", // fold | official | mark
                    friends_enabled: true,
                    friends_highlight: "#ff9800"
                }
            },
            meta: {
                relation: {
                    label: "社交关系设置",
                    group: "🤝 社交关系",
                    fields: {
                        show_friend_btn: { type: "SWITCH", label: "显示添加好友按钮" },
                        friend_btn_color: { type: "COLOR", label: "好友按钮颜色" },
                        show_block_btn: { type: "SWITCH", label: "显示屏蔽用户按钮" },
                        block_btn_color: { type: "COLOR", label: "屏蔽按钮颜色" },
                        blacklist_enabled: { type: "SWITCH", label: "开启高级黑名单" },
                        blacklist_mode: { type: "SELECT", label: "黑名单显示模式", options: { fold: "优雅折叠", official: "官方屏蔽", mark: "标记模式" } },
                        friends_enabled: { type: "SWITCH", label: "开启本地好友高亮" },
                        friends_highlight: { type: "COLOR", label: "好友高亮色" }
                    }
                }
            },
            match: ctx => ctx.isPost || ctx.isList || location.pathname === '/' || location.pathname.startsWith('/categories') || location.pathname.startsWith('/board'),
            init(ctx) {
                const blacklistKey = 'nsx_advanced_blacklist';
                const friendsKey = 'nsx_advanced_friends';
                const keywordsKey = 'nsx_advanced_keywords';
                const groupsKey = 'nsx_content_rule_groups';
                const BLACKLIST_MODE_LABELS = { fold: "优雅折叠", official: "官方屏蔽", mark: "标记模式", hide: "官方屏蔽" };

                const getMap = (key) => {
                    try { return JSON.parse(localStorage.getItem(key) || '{}'); }
                    catch { return {}; }
                };
                const saveMap = (key, map) => localStorage.setItem(key, JSON.stringify(map));
                const getUserGroupState = () => {
                    try {
                        const groups = JSON.parse(localStorage.getItem(groupsKey) || '{}')?.users;
                        return new Map((Array.isArray(groups) ? groups : []).map(group => [String(group?.id || ''), group || {}]));
                    } catch { return new Map(); }
                };
                const normalizeBlacklistMode = (mode, fallback = "fold") => {
                    const val = mode === "hide" ? "official" : mode;
                    return ["fold", "official", "mark"].includes(val) ? val : fallback;
                };

                const state = {
                    blacklist: getMap(blacklistKey),
                    friends: getMap(friendsKey),
                    keywords: getMap(keywordsKey),
                    userGroups: getUserGroupState(),
                    cfg: {
                        blEnabled: ctx.store.get("relation.blacklist_enabled", true),
                        blMode: ctx.store.get("relation.blacklist_mode", "fold"),
                        frEnabled: ctx.store.get("relation.friends_enabled", true),
                        frColor: ctx.store.get("relation.friends_highlight", "#ff9800"),
                        friendBtnColor: ctx.store.get("relation.friend_btn_color", "#00b894"),
                        blockBtnColor: ctx.store.get("relation.block_btn_color", "#d63031")
                    }
                };
                const getUserBlacklistMode = (info) => normalizeBlacklistMode(info?.mode, state.cfg.blMode);
                const getBlacklistModeLabel = (mode) => BLACKLIST_MODE_LABELS[normalizeBlacklistMode(mode)] || BLACKLIST_MODE_LABELS.fold;
                const isBlacklistRuleActive = info => Boolean(info) && info.enabled !== false && (!info.group || state.userGroups.get(String(info.group))?.enabled !== false);
                const getBlacklistRuleColor = info => state.userGroups.get(String(info?.group || ''))?.color || '#f44336';

                let processAll = () => { };
                let processList = () => { };

                // 添加全局样式
                addStyle("nsx-user-relation", `
                /* 屏蔽与好友按钮 */
                .nsx-relation-btn {
                    font-size: 10px; padding: 2px 8px; border-radius: 5px; border: 1px solid currentColor;
                    background: transparent; color: currentColor !important; cursor: pointer; margin-left: 4px; opacity: 0.9;
                    transition: all 0.2s; user-select: none; display: inline-block; line-height: 1.6;
                    font-weight: 600; text-shadow: none; box-shadow: none;
                }
                .nsx-relation-btn:hover { opacity: 1; transform: translateY(-1px); }
                .nsx-relation-btn:active { transform: translateY(0); }
                .nsx-btn-block { color: ${state.cfg.blockBtnColor}; border-color: ${state.cfg.blockBtnColor}; background: ${state.cfg.blockBtnColor}12; }
                .nsx-btn-friend { color: ${state.cfg.friendBtnColor}; border-color: ${state.cfg.friendBtnColor}; background: ${state.cfg.friendBtnColor}12; }
                .nsx-mobile .nsx-relation-btn-wrap { gap: 3px !important; margin-left: 4px !important; }
                .nsx-mobile .nsx-relation-btn {
                    min-width: 18px; height: 18px; padding: 0 4px; font-size: 11px; line-height: 18px;
                    display: inline-flex; align-items: center; justify-content: center;
                }

                /* 折叠模式 */
                .nsx-post-folded > *:not(.nsx-fold-notice) { display: none !important; }
                .nsx-post-folded { background-color: rgba(244, 67, 54, 0.05) !important; padding: 0 !important; }
                .nsx-fold-notice {
                    font-size: 12px; color: #f44336; padding: 10px; opacity: 0.8;
                    display: flex; justify-content: space-between; align-items: center;
                }
                .nsx-unfold-btn { cursor: pointer; text-decoration: underline; }

                /* 彻底隐藏模式 */
                .nsx-post-hidden { display: none !important; }

                /* 好友高亮 */
                .nsx-friend-badge {
                    font-size: 11px; padding: 1px 5px; border-radius: 4px; margin-left: 4px;
                    background-color: ${state.cfg.frColor}22; border: 1px solid ${state.cfg.frColor};
                    color: ${state.cfg.frColor}; font-weight: bold; cursor: help;
                }
                .nsx-blacklist-badge {
                    font-size: 11px; padding: 1px 5px; border-radius: 4px; margin-left: 4px;
                    background-color: rgba(244, 67, 54, 0.12); border: 1px solid #f44336;
                    color: #f44336; font-weight: bold; cursor: help;
                }
            `);

                // 帖子页处理逻辑
                if (ctx.isPost) {
                    const processPostItem = (authorLink) => {
                        const postEl = authorLink.closest('.nsk-post, .comments > li, li.comment-item, .comment-item, li');
                        if (!postEl) return;
                        if (postEl.dataset.nsxRelationProcessed) return;

                        const username = authorLink.textContent.trim();
                        if (!username) return;

                        postEl.dataset.nsxRelationProcessed = "1";

                        // --- 黑名单逻辑 ---
                        if (state.cfg.blEnabled && isBlacklistRuleActive(state.blacklist[username])) {
                            const blInfo = state.blacklist[username];
                            const effectiveBlMode = getUserBlacklistMode(blInfo);
                            if (effectiveBlMode === 'official') {
                                postEl.classList.add('nsx-post-hidden');
                            } else if (effectiveBlMode === 'mark') {
                                const markColor = getBlacklistRuleColor(blInfo);
                                const blBadge = document.createElement('span');
                                blBadge.className = 'nsx-blacklist-badge';
                                blBadge.style.cssText = `background-color:${markColor}18;border-color:${markColor};color:${markColor}`;
                                blBadge.title = `黑名单模式: ${getBlacklistModeLabel(effectiveBlMode)}\n黑名单备注: ${blInfo.remark || '无'}\n添加时间: ${blInfo.time || '未知'}`;
                                blBadge.innerHTML = '黑名单';
                                authorLink.after(blBadge);
                            } else {
                                // Fold mode
                                postEl.classList.add('nsx-post-folded');
                                const notice = document.createElement('div');
                                notice.className = 'nsx-fold-notice';
                                const _esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
                                notice.innerHTML = `
                                <span> 已折叠来自黑名单用户 [<b>${_esc(username)}</b>] 的言论。备注: ${_esc(blInfo.remark || '无')}</span>
                                <span class="nsx-unfold-btn">临时展开</span>
                            `;
                                notice.querySelector('.nsx-unfold-btn').onclick = (e) => {
                                    postEl.classList.remove('nsx-post-folded');
                                    notice.style.display = 'none';
                                };
                                postEl.prepend(notice);
                            }
                        }

                        // --- 好友逻辑 ---
                        if (state.cfg.frEnabled && state.friends[username]) {
                            const frInfo = state.friends[username];
                            const frBadge = document.createElement('span');
                            frBadge.className = 'nsx-friend-badge';
                            frBadge.title = `好友备注: ${frInfo.remark || '无'}\n添加时间: ${frInfo.time}`;
                            frBadge.innerHTML = '好友';
                            authorLink.after(frBadge);
                        }

                    };

                    processAll = () => ctx.$$('.nsk-content-meta-info .author-info > a[href^="/space/"]').forEach(processPostItem);
                    processAll();
                    ctx.watch('.nsk-content-meta-info', processAll, { debounce: 200 });
                }

                // 列表页处理逻辑 (讨论列表)
                if (ctx.isList || location.pathname === '/' || location.pathname.startsWith('/categories') || location.pathname.startsWith('/board')) {
                    const processListItem = (itemEl) => {
                        if (itemEl.dataset.nsxRelationListProcessed) return;
                        itemEl.dataset.nsxRelationListProcessed = "1";

                        const authorEl = itemEl.querySelector('.info-author, .post-author');
                        if (!authorEl) return;
                        const username = authorEl.textContent.trim();

                        if (state.cfg.blEnabled && isBlacklistRuleActive(state.blacklist[username])) {
                            const blInfo = state.blacklist[username];
                            const effectiveBlMode = getUserBlacklistMode(blInfo);
                            if (effectiveBlMode === 'official') {
                                itemEl.style.display = 'none';
                            } else if (effectiveBlMode === 'mark') {
                                const markColor = getBlacklistRuleColor(blInfo);
                                authorEl.style.color = markColor;
                                authorEl.style.fontWeight = 'bold';
                                const badge = document.createElement('span');
                                badge.className = 'nsx-blacklist-badge';
                                badge.style.cssText = `font-size:10px;padding:1px 4px;border-radius:3px;margin-left:4px;background-color:${markColor}18;border:1px solid ${markColor};color:${markColor};vertical-align:middle;line-height:1;font-weight:normal;`;
                                badge.title = `黑名单模式: ${getBlacklistModeLabel(effectiveBlMode)}\n黑名单备注: ${blInfo.remark || '无'}`;
                                badge.textContent = '黑名单';
                                authorEl.after(badge);
                            } else {
                                itemEl.classList.add('nsx-post-folded');
                                const notice = document.createElement('div');
                                notice.className = 'nsx-fold-notice';
                                notice.style.padding = '12px 15px';
                                const _esc2 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
                                notice.innerHTML = `
                                <span> 已折叠来自黑名单用户 [<b>${_esc2(username)}</b>] 的主题。备注: ${_esc2(blInfo.remark || '无')}</span>
                                <span class="nsx-unfold-btn">临时展开</span>
                            `;
                                notice.querySelector('.nsx-unfold-btn').onclick = (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    itemEl.classList.remove('nsx-post-folded');
                                    notice.style.display = 'none';
                                };
                                itemEl.prepend(notice);
                            }
                        }
                        if (state.cfg.frEnabled && state.friends[username]) {
                            const frInfo = state.friends[username];
                            authorEl.style.color = state.cfg.frColor;
                            authorEl.style.fontWeight = 'bold';
                            const badge = document.createElement('span');
                            badge.className = 'nsx-friend-badge';
                            badge.style.cssText = `font-size:10px;padding:1px 4px;border-radius:3px;margin-left:4px;background-color:${state.cfg.frColor}22;border:1px solid ${state.cfg.frColor};color:${state.cfg.frColor};vertical-align:middle;line-height:1;font-weight:normal;`;
                            badge.title = `好友备注: ${frInfo.remark || '无'}`;
                            badge.textContent = '好友';
                            authorEl.after(badge);
                        }
                    };

                    processList = () => ctx.$$('.post-list-item, .post-list .list-item').forEach(processListItem);
                    processList();
                    ctx.watch('.post-list, .post-list-item', processList, { debounce: 200 });
                }

                // === 构建社交关系管理大面板 (仿历史记录风格) ===
                const panelCss = `.nsx-rel-header{display:flex;align-items:center;justify-content:space-between;padding:12px 12px 6px}.nsx-rel-title{font-size:15px;font-weight:600}.nsx-rel-action{border:0;background:0;color:#666;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px}.nsx-rel-action:hover{background:#f2f3f5}.nsx-rel-search{display:flex;align-items:center;gap:6px;margin:0 12px 8px;border:1px solid #e1e1e1;border-radius:8px;padding:6px 8px}.nsx-rel-search input{border:0;background:0;outline:0;width:100%;font-size:13px}.nsx-rel-tabs{display:flex;gap:16px;padding:0 12px 6px;border-bottom:1px solid #f0f0f0}.nsx-rel-tab{border:0;background:0;cursor:pointer;color:#6b6b6b;font-size:12px;padding:6px 0;font-weight:600;border-bottom:2px solid transparent}.nsx-rel-tab.is-active{color:#0a62ff;border-bottom-color:#0a62ff}.nsx-rel-list{flex:1;overflow-y:auto;padding:6px 8px 12px}.nsx-rel-item{display:flex;align-items:center;gap:8px;padding:8px 6px;border-radius:8px}.nsx-rel-item:hover{background:#f5f7fb}.nsx-rel-link{display:flex;align-items:center;gap:10px;flex:1;min-width:0;text-decoration:none;color:inherit}.nsx-rel-icon{width:36px;height:36px;border-radius:50%;background:#f0f0f0;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;color:#999;font-weight:bold;font-size:18px}.nsx-rel-info{display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;}.nsx-rel-item-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:bold;font-size:14px;}.nsx-rel-remark{color:#888;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}.nsx-rel-time{color:#aaa;font-size:11px;}.nsx-rel-empty{padding:20px 6px;color:#999;font-size:13px;text-align:center;}.nsx-rel-close{border:0;background:0;cursor:pointer;font-size:12px;padding:4px 8px;border-radius:6px;color:#999;display:none}.nsx-rel-item:hover .nsx-rel-close{display:block}.nsx-rel-close:hover{color:#f44336;background:#fee}.dark-layout .nsx-rel-action{color:#999}.dark-layout .nsx-rel-action:hover{background:#2a2a2a}.dark-layout .nsx-rel-search{border-color:#3a3a3a}.dark-layout .nsx-rel-search input{color:#e0e0e0}.dark-layout .nsx-rel-tabs{border-bottom-color:#3a3a3a}.dark-layout .nsx-rel-tab{color:#999}.dark-layout .nsx-rel-item:hover{background:#2a2a2a}.dark-layout .nsx-rel-icon{background:#3a3a3a}`;
                addStyle("nsx-rel-panel-style", panelCss);

                let relPanel = null, relTrigger = null, pState = { open: false, tab: "bl", kw: "" };

                // 寻找吸顶栏作为挂靠点
                const head = ctx.$("#nsk-head");
                if (head) {
                    const grp = ensureIconGroup();
                    if (!grp) return;
                    relTrigger = document.createElement("div");
                    relTrigger.className = "relation-dropdown-on";
                    relTrigger.style.cssText = "";
                    relTrigger.title = "关系管理(黑名单/好友)";
                    relTrigger.innerHTML = `<svg viewBox="0 0 48 48" fill="none" class="iconpark-icon" style="width:17px;height:17px;color:currentColor;"><path d="M24 20C28.4183 20 32 16.4183 32 12C32 7.58172 28.4183 4 24 4C19.5817 4 16 7.58172 16 12C16 16.4183 19.5817 20 24 20Z" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M42 44C42 34.0589 33.9411 26 24 26C14.0589 26 6 34.0589 6 44" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
                    grp.appendChild(relTrigger);

                    const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

                    const openRel = () => {
                        closeOtherPanels("relation");
                        if (!relPanel) {
                            relPanel = document.createElement("div");
                            relPanel.id = "nsx-rel-panel";
                            relPanel.innerHTML = `<div class="nsx-rel-header"><div class="nsx-rel-title">社交关系名单</div><button class="nsx-rel-action" data-a="clear">清空列表</button></div><div class="nsx-rel-search"><input placeholder="搜索用户名或备注..."/></div><div class="nsx-rel-tabs"><button class="nsx-rel-tab is-active" data-t="bl">屏蔽黑名单</button><button class="nsx-rel-tab" data-t="fr">本地好友</button></div><div class="nsx-rel-list"></div>`;
                            document.body.appendChild(relPanel);

                            relPanel.querySelector("input").oninput = e => { pState.kw = e.target.value.toLowerCase(); renderRel(); };
                            relPanel.onclick = e => {
                                e.stopPropagation();
                                const modeBtn = e.target.closest("[data-a='edit-mode']");
                                if (modeBtn) {
                                    e.preventDefault();
                                    const un = modeBtn.dataset.un;
                                    const item = state.blacklist[un];
                                    if (!un || !item) return;
                                    const currentMode = getUserBlacklistMode(item);
                                    const html = `
                                        <div class="layui-form" style="padding:20px 20px 0;">
                                            <div class="layui-form-item">
                                                <label class="layui-form-label" style="width:72px;padding-left:0;">模式</label>
                                                <div class="layui-input-block" style="margin-left:92px;">
                                                    <select id="nsx-rel-blacklist-mode">
                                                        <option value="fold" ${currentMode === 'fold' ? 'selected' : ''}>优雅折叠</option>
                                                        <option value="official" ${currentMode === 'official' ? 'selected' : ''}>官方屏蔽</option>
                                                        <option value="mark" ${currentMode === 'mark' ? 'selected' : ''}>标记模式</option>
                                                    </select>
                                                </div>
                                            </div>
                                        </div>`;
                                    ctx.ui.layer.open({
                                        title: `设置 ${un} 的屏蔽模式`,
                                        content: html,
                                        area: ['min(420px,94vw)', 'auto'],
                                        skin: 'nsx-mode-layer',
                                        btn: ['保存', '取消'],
                                        success: () => {
                                            layui.use(['form'], function () {
                                                layui.form.render('select');
                                            });
                                        },
                                        yes: async (idx, l) => {
                                            const nextMode = normalizeBlacklistMode(l.find('#nsx-rel-blacklist-mode').val(), currentMode);
                                            item.mode = nextMode;
                                            saveMap(blacklistKey, state.blacklist);
                                            if (nextMode === 'official') {
                                                try {
                                                    const r = await ctx.net.post("/api/block-list/add", { block_member_name: un });
                                                    if (!r?.success) ctx.ui.alert("同步失败", r?.message || "官方接口调用失败，仅保存本地模式");
                                                } catch (err) {
                                                    env.error("Sync Official Block Failed", err);
                                                }
                                            }
                                            ctx.ui.layer.close(idx);
                                            renderRel();
                                            ctx.ui.toast("黑名单模式已更新，刷新贴子生效");
                                        }
                                    });
                                    return;
                                }
                                if (e.target.closest('.nsx-rel-remark')) {
                                    if (e.target.tagName !== 'INPUT') e.preventDefault();
                                    return;
                                }
                                const t = e.target.closest("[data-t]");
                                if (t) { pState.tab = t.dataset.t; renderRel(); return; }
                                const a = e.target.closest("[data-a]");
                                if (!a) return;
                                const act = a.dataset.a, un = a.dataset.un;
                                if (act === "clear") {
                                    const names = { bl: "黑名单", fr: "好友" };
                                    ctx.ui.confirm("确认清空?", `确定要清空所有${names[pState.tab]}吗？`, () => {
                                        if (pState.tab === 'bl') state.blacklist = {}; else state.friends = {};
                                        saveMap(pState.tab === 'bl' ? blacklistKey : friendsKey, pState.tab === 'bl' ? state.blacklist : state.friends);
                                        renderRel();
                                        ctx.ui.toast("已清空");
                                    });
                                }
                                if (act === "del") {
                                    if (pState.tab === 'bl') {
                                        const targetUserId = state.blacklist[un]?.userId;
                                        delete state.blacklist[un];
                                        if (targetUserId) {
                                            fetch('/api/block-list/del', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block_member_id: Number(targetUserId) }) }).catch(() => { });
                                        }
                                    } else {
                                        delete state.friends[un];
                                    }
                                    saveMap(pState.tab === 'bl' ? blacklistKey : friendsKey, pState.tab === 'bl' ? state.blacklist : state.friends);
                                    renderRel();
                                    ctx.ui.toast("已移除");
                                }
                            };
                            relPanel.ondblclick = e => {
                                const remarkSpan = e.target.closest('.nsx-rel-remark');
                                if (remarkSpan) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const un = remarkSpan.dataset.un;
                                    if (!un) return;
                                    let mapObj = pState.tab === "bl" ? state.blacklist : state.friends;
                                    const currentRemark = mapObj[un]?.remark || "";

                                    const input = document.createElement('input');
                                    input.type = 'text';
                                    input.value = currentRemark;
                                    input.style.cssText = "width:100%;font-size:12px;border:1px solid #0a62ff;border-radius:4px;padding:2px 4px;outline:none;background:#fff;color:#333;";

                                    input.onkeydown = (ke) => {
                                        if (ke.key === 'Enter') input.blur();
                                        if (ke.key === 'Escape') { input.value = currentRemark; input.blur(); }
                                    };
                                    input.onblur = () => {
                                        const newRemark = input.value.trim();
                                        if (mapObj[un]) {
                                            mapObj[un].remark = newRemark;
                                            saveMap(pState.tab === "bl" ? blacklistKey : friendsKey, mapObj);
                                        }
                                        renderRel();
                                        if (newRemark !== currentRemark) ctx.ui.toast("备注已更新，刷新贴子生效");
                                    };

                                    remarkSpan.innerHTML = '';
                                    remarkSpan.appendChild(input);
                                    input.focus();
                                    // 光标移到最后
                                    input.setSelectionRange(input.value.length, input.value.length);
                                }
                            };
                            document.addEventListener("click", e => {
                                const inLayer = !!e.target.closest('.layui-layer,.layui-layer-page,.layui-layer-dialog,.layui-layer-content,.layui-layer-btn,.layui-layer-shade,.layui-colorpicker,.layui-form-select');
                                if (inLayer) return;
                                const hasTopLayer = !!document.querySelector('.layui-layer[style*="z-index"]');
                                if (hasTopLayer) return;
                                if (pState.open && !relPanel.contains(e.target) && !relTrigger.contains(e.target)) closeRel();
                            });
                            document.addEventListener("keydown", e => { if (pState.open && e.key === "Escape") closeRel(); });
                        }
                        const r = relTrigger.getBoundingClientRect();
                        relPanel.style.top = `${r.bottom + 8}px`;
                        relPanel.style.height = `${innerHeight - r.bottom - 16}px`;
                        relPanel.style.right = ``;
                        renderRel();
                        relPanel.classList.add("show");
                        pState.open = true;
                    };

                    const closeRel = () => { relPanel?.classList.remove("show"); pState.open = false; };
                    window.__nsxPanelCtrl ||= {};
                    window.__nsxPanelCtrl.relation = { close: closeRel, isOpen: () => pState.open };
                    const toggleRel = () => pState.open ? closeRel() : openRel();

                    const renderRel = () => {
                        let mapObj = pState.tab === "bl" ? state.blacklist : state.friends;
                        let list = Object.entries(mapObj).map(([un, info]) => ({ username: un, remark: info.remark || "", time: info.time || "", userId: info.userId || "", mode: info.mode || "" }));

                        if (pState.kw) list = list.filter(i => i.username.toLowerCase().includes(pState.kw) || i.remark.toLowerCase().includes(pState.kw));
                        list.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

                        relPanel.querySelectorAll(".nsx-rel-tab").forEach(b => b.classList.toggle("is-active", b.dataset.t === pState.tab));

                        const lEl = relPanel.querySelector(".nsx-rel-list");
                        if (!list.length) { lEl.innerHTML = `<div class="nsx-rel-empty">该列表空空如也</div>`; return; }

                        lEl.innerHTML = list.map(i => {
                            const url = i.userId ? `/space/${i.userId}#/general` : `/space/${encodeURIComponent(i.username)}`;
                            const avatarLetter = i.username.charAt(0).toUpperCase();
                            const iconColor = pState.tab === "bl" ? "#f44336" : "#4caf50";

                            const avatarImgHtml = i.userId
                                ? `<img src="/avatar/${i.userId}.png" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null;this.style.display='none';this.nextElementSibling.style.display='inline';">`
                                : "";
                            const letterHtml = `<span style="${i.userId ? 'display:none;' : 'display:inline;'}">${avatarLetter}</span>`;

                            return `<div class="nsx-rel-item">
                                <a class="nsx-rel-link" href="${url}" target="_blank">
                                    <span class="nsx-rel-icon" style="color:white;background:${iconColor};opacity:0.8">${avatarImgHtml}${letterHtml}</span>
                                    <div class="nsx-rel-info">
                                        <span class="nsx-rel-item-title">${esc(i.username)}</span>
                                        <span class="nsx-rel-remark" data-un="${esc(i.username)}" title="双击可直接修改备注">${esc(i.remark ? '备注: ' + i.remark : '无备注 (双击添加)')}</span>
                                        ${pState.tab === "bl" ? `<span class="nsx-rel-remark"><button class="nsx-rel-action" data-a="edit-mode" data-un="${esc(i.username)}" style="padding:0 6px;font-size:11px;">模式: ${esc(getBlacklistModeLabel(i.mode || state.cfg.blMode))}</button></span>` : ``}
                                    </div>
                                </a>
                                <span class="nsx-rel-time">${i.time ? i.time.split(' ')[0] : ''}</span>
                                <button class="nsx-rel-close" data-a="del" data-un="${esc(i.username)}" title="移出列表">移除</button>
                            </div>`;
                        }).join("");
                    };

                    relTrigger.onclick = e => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleRel();
                    };
                }

                window.__nsxRuntime ||= {};
                window.__nsxRuntime.reapplyRelation = () => {
                    state.blacklist = getMap(blacklistKey);
                    state.friends = getMap(friendsKey);
                    state.userGroups = getUserGroupState();
                    state.cfg.blEnabled = ctx.store.get("relation.blacklist_enabled", true);
                    state.cfg.blMode = ctx.store.get("relation.blacklist_mode", "fold");
                    state.cfg.frEnabled = ctx.store.get("relation.friends_enabled", true);
                    state.cfg.frColor = ctx.store.get("relation.friends_highlight", "#ff9800");
                    state.cfg.friendBtnColor = ctx.store.get("relation.friend_btn_color", "#00b894");
                    state.cfg.blockBtnColor = ctx.store.get("relation.block_btn_color", "#d63031");

                    ctx.$$(".nsx-relation-btn-wrap,.nsx-friend-badge,.nsx-blacklist-badge,.nsx-fold-notice").forEach(el => el.remove());
                    ctx.$$(".nsx-post-folded,.nsx-post-hidden").forEach(el => {
                        el.classList.remove("nsx-post-folded", "nsx-post-hidden");
                        el.style.display = "";
                    });
                    ctx.$$(".nsk-content-meta-info .author-info > a[href^='/space/'], .post-list-item .info-author, .post-list-item .post-author").forEach(el => {
                        el.style.color = "";
                        el.style.fontWeight = "";
                    });
                    ctx.$$('[data-nsx-relation-processed],[data-nsx-relation-list-processed]').forEach(el => {
                        delete el.dataset.nsxRelationProcessed;
                        delete el.dataset.nsxRelationListProcessed;
                    });

                    processAll();
                    processList();
                    if (typeof renderRel === "function" && pState.open) renderRel();
                };
                document.addEventListener("NSPRO_FORUM_DATA_CHANGED", event => {
                    try {
                        const keys = JSON.parse(event.detail || "{}").keys || [];
                        if (keys.includes(blacklistKey) || keys.includes(groupsKey)) window.__nsxRuntime.reapplyRelation();
                    } catch { }
                });
            }
        };
        /* ==========================================================================
           [ 🎁 抽奖提醒 ] - 抽奖管理、开奖提醒与多通道通知
           ========================================================================== */
        const lotteryReminder = {
            id: "lotteryReminder",
            deps: ["ui"],
            order: 185,
            cfg: {
                lottery_reminder: {
                    enabled: true,
                    auto_detect: true,
                    joined_badge_color: "#16a34a",
                    unjoined_badge_color: "#d97706",
                    near_minutes: 1,
                    check_seconds: 30
                }
            },
            meta: {
                lottery_reminder: {
                    label: "抽奖提醒",
                    group: "🚀 基础功能",
                    cols: 2,
                    fields: {
                        auto_detect: { type: "SWITCH", label: "自动识别抽奖贴" },
                        joined_badge_color: { type: "COLOR", label: "首页抽奖已参加标签颜色" },
                        unjoined_badge_color: { type: "COLOR", label: "首页抽奖未参加标签颜色" },
                        near_minutes: { type: "NUMBER", label: "提前提醒（分钟）" },
                        check_seconds: { type: "NUMBER", label: "检查间隔（秒）" }
                    }
                }
            },
            match: ctx => ctx.site?.code === "ns",
            init(ctx) {
                const REMINDERS_KEY = "lottery_reminders";
                const PARTICIPATION_HISTORY_KEY = "lottery_participation_history";
                const PARTICIPATION_CLEARED_AT_KEY = "lottery_participation_cleared_at";
                const COMMENT_SUBMISSION_KEY = "nsx_lottery_pending_comment";
                const LOTTERY_LIST_CACHE_KEY = "nsx_lottery_list_validation_cache_v1";
                const NOTIFY_KEY = "notify_config";
                const STYLE_ID = "nsx-lottery-style";
                const PANEL_ID = "nsx-lottery-panel";
                const MODAL_ID = "nsx-lottery-notify-mask";
                const DEFAULT_NOTIFY = {
                    telegram: { enabled: false, botToken: "", chatId: "" },
                    email: {
                        enabled: false, provider: "resend", apiKey: "", from: "", to: "",
                        domain: "", serviceId: "", templateId: "", userId: ""
                    },
                    wechat: { enabled: false, provider: "serverchan3", sendKey: "", token: "" },
                    wecom: { enabled: false, webhook: "" },
                    dingtalk: { enabled: false, webhook: "", secret: "", atMobiles: "" },
                    feishu: { enabled: false, webhook: "", secret: "" },
                    autoResult: { enabled: true, username: "" }
                };

                let active = false;
                let timer = null;
                let triggerTimer = null;
                let panel = null;
                let trigger = null;
                let menuIds = [];
                let participationObserver = null;
                let participationClickHandler = null;
                const readPendingCommentSubmission = () => {
                    try {
                        const saved = JSON.parse(sessionStorage.getItem(COMMENT_SUBMISSION_KEY) || "null");
                        return saved && typeof saved === "object" ? saved : null;
                    } catch { return null; }
                };
                const savePendingCommentSubmission = value => {
                    pendingCommentSubmission = value;
                    if (value) sessionStorage.setItem(COMMENT_SUBMISSION_KEY, JSON.stringify(value));
                    else sessionStorage.removeItem(COMMENT_SUBMISSION_KEY);
                };
                let pendingCommentSubmission = readPendingCommentSubmission();
                let participationHistoryCache = null;
                const resultRequesting = new Set();
                const lotteryDetailRefreshes = new Set();
                const lotteryListValidationCache = new Map();
                const lotteryListValidationRequests = new Map();
                const lotteryListValidationQueue = [];
                let lotteryListValidationActive = 0;
                const LOTTERY_LIST_VALIDATION_CONCURRENCY = 6;
                const refreshParticipationSoon = debounce(() => {
                    if (active) refreshLotteryIndicators();
                }, 260);

                const clone = value => JSON.parse(JSON.stringify(value));
                const getPathValue = (obj, path) => path.split(".").reduce((value, key) => value?.[key], obj);
                const setPathValue = (obj, path, value) => {
                    const keys = path.split(".");
                    const last = keys.pop();
                    keys.reduce((target, key) => target[key] ??= {}, obj)[last] = value;
                };
                const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
                    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
                })[char]);

                const readLotteryListCache = () => {
                    const saved = GM_getValue(LOTTERY_LIST_CACHE_KEY, {});
                    const now = Date.now();
                    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
                    Object.entries(saved).forEach(([postId, entry]) => {
                        if (!entry || Number(entry.expiresAt) <= now) return;
                        lotteryListValidationCache.set(String(postId), {
                            details: entry.details || null,
                            expiresAt: Number(entry.expiresAt)
                        });
                    });
                };
                const writeLotteryListCache = () => {
                    const now = Date.now();
                    const entries = [...lotteryListValidationCache.entries()]
                        .filter(([, entry]) => Number(entry?.expiresAt) > now)
                        .sort((left, right) => Number(right[1].expiresAt) - Number(left[1].expiresAt))
                        .slice(0, 240);
                    GM_setValue(LOTTERY_LIST_CACHE_KEY, Object.fromEntries(entries));
                };
                readLotteryListCache();

                /* LOTTERY_NOTIFICATION_STATE_START */
                function notificationRetryDelay(attempts) {
                    const count = Math.max(1, Number.parseInt(attempts, 10) || 1);
                    return Math.min(15 * 60 * 1000, 60 * 1000 * (2 ** Math.min(count - 1, 8)));
                }

                function canAttemptNotification(reminder, stateKey, now = Date.now()) {
                    if (!reminder || reminder[stateKey + "Notified"]) return false;
                    const attempts = Math.max(0, Number.parseInt(reminder[stateKey + "NotifyAttempts"], 10) || 0);
                    const lastAttemptAt = Number(reminder[stateKey + "NotifyLastAttemptAt"]) || 0;
                    if (!attempts || !lastAttemptAt) return true;
                    return Number(now) - lastAttemptAt >= notificationRetryDelay(attempts);
                }

                function summarizeNotificationDelivery(channelNames, results) {
                    const names = Array.isArray(channelNames) ? channelNames : [];
                    const values = Array.isArray(results) ? results : [];
                    const succeeded = [];
                    const failed = [];
                    names.forEach((channel, index) => {
                        const result = values[index];
                        if (result?.status === "fulfilled") {
                            succeeded.push(channel);
                            return;
                        }
                        const reason = result?.reason;
                        failed.push({
                            channel,
                            message: String(reason?.message || reason || "发送失败")
                        });
                    });
                    return {
                        ok: failed.length === 0,
                        attempted: names.length,
                        succeeded,
                        failed
                    };
                }

                function recordNotificationDelivery(reminder, stateKey, delivery, now = Date.now()) {
                    const attemptsKey = stateKey + "NotifyAttempts";
                    const lastAttemptKey = stateKey + "NotifyLastAttemptAt";
                    const lastErrorKey = stateKey + "NotifyLastError";
                    const notifiedKey = stateKey + "Notified";
                    const skippedKey = stateKey + "NotifySkippedAt";
                    reminder[attemptsKey] = Math.max(0, Number.parseInt(reminder[attemptsKey], 10) || 0) + 1;
                    reminder[lastAttemptKey] = Number(now);
                    if (delivery?.skipped) {
                        reminder[notifiedKey] = false;
                        reminder[skippedKey] = Number(now);
                        delete reminder[lastErrorKey];
                        return false;
                    }
                    delete reminder[skippedKey];
                    reminder[notifiedKey] = !!delivery?.ok;
                    if (delivery?.ok) {
                        delete reminder[lastErrorKey];
                    } else {
                        reminder[lastErrorKey] = (delivery?.failed || [])
                            .map(item => item.channel + ": " + item.message)
                            .join("；") || "通知发送失败";
                    }
                    return reminder[notifiedKey];
                }
                /* LOTTERY_NOTIFICATION_STATE_END */

                const postIdFromUrl = value => String(value || "").match(/\/post-(\d+)/)?.[1] || null;
                const canonicalPostUrl = value => {
                    const postId = postIdFromUrl(value);
                    return postId ? location.origin + "/post-" + postId + "-1" : String(value || "");
                };
                const postUrlFromLucky = value => {
                    try {
                        const parsed = new URL(value, location.origin);
                        if (!/(^|\.)nodeseek\.com$/i.test(parsed.hostname)) return null;
                        const postId = parsed.searchParams.get("post");
                        return /^\d+$/.test(String(postId || ""))
                            ? location.origin + "/post-" + postId + "-1"
                            : null;
                    } catch {
                        return null;
                    }
                };
                const normalizeReminder = reminder => {
                    if (!reminder || typeof reminder !== "object") return reminder;
                    const currentPostUrl = postIdFromUrl(reminder.postUrl)
                        ? canonicalPostUrl(reminder.postUrl)
                        : postUrlFromLucky(reminder.luckyUrl);
                    if (!currentPostUrl || currentPostUrl === reminder.postUrl) return reminder;
                    return { ...reminder, postUrl: currentPostUrl };
                };
                const getReminders = () => {
                    const saved = GM_getValue(REMINDERS_KEY, []);
                    if (!Array.isArray(saved)) return [];
                    const normalized = saved.map(normalizeReminder);
                    if (normalized.some((value, index) => value !== saved[index])) GM_setValue(REMINDERS_KEY, normalized);
                    return normalized;
                };
                const saveReminders = reminders => GM_setValue(REMINDERS_KEY, reminders);
                const getNotifyConfig = () => {
                    const saved = GM_getValue(NOTIFY_KEY, {});
                    const result = clone(DEFAULT_NOTIFY);
                    Object.keys(result).forEach(key => {
                        if (saved?.[key] && typeof saved[key] === "object") Object.assign(result[key], saved[key]);
                    });
                    if (saved?.bark || saved?.discord) GM_setValue(NOTIFY_KEY, result);
                    return result;
                };
                const saveNotifyConfig = config => GM_setValue(NOTIFY_KEY, config);
                const currentUserIdentity = () => {
                    const user = ctx.user || {};
                    return {
                        userId: String(ctx.uid || "").trim(),
                        username: String(user.username || user.user_name || user.member_name || user.nickname || user.name || "").trim()
                    };
                };
                const emptyParticipationHistory = () => ({ version: 1, lastKnownUserId: "", users: {} });
                const normalizeParticipationHistory = saved => {
                    const history = saved && typeof saved === "object" && !Array.isArray(saved)
                        ? saved
                        : emptyParticipationHistory();
                    history.version = 1;
                    history.lastKnownUserId = String(history.lastKnownUserId || "");
                    if (!history.users || typeof history.users !== "object" || Array.isArray(history.users)) history.users = {};
                    return history;
                };
                const getParticipationHistory = () => {
                    if (!participationHistoryCache) {
                        participationHistoryCache = normalizeParticipationHistory(GM_getValue(PARTICIPATION_HISTORY_KEY, null));
                    }
                    return participationHistoryCache;
                };
                const saveParticipationHistory = history => {
                    participationHistoryCache = normalizeParticipationHistory(history);
                    GM_setValue(PARTICIPATION_HISTORY_KEY, participationHistoryCache);
                };
                document.addEventListener("NSPRO_STORAGE_UPDATED", event => {
                    try {
                        const storage = JSON.parse(event.detail || "{}");
                        participationHistoryCache = normalizeParticipationHistory(storage?.[PARTICIPATION_HISTORY_KEY]);
                        if (active) refreshParticipationSoon();
                    } catch { }
                });
                const participationProfile = (history, create = false) => {
                    const identity = currentUserIdentity();
                    const userId = identity.userId || history.lastKnownUserId;
                    if (!userId) return null;
                    if (identity.userId) history.lastKnownUserId = identity.userId;
                    if (!history.users[userId] && create) {
                        history.users[userId] = { username: identity.username, records: {}, sync: {} };
                    }
                    const profile = history.users[userId] || null;
                    if (!profile) return null;
                    if (!profile.records || typeof profile.records !== "object" || Array.isArray(profile.records)) profile.records = {};
                    if (!profile.sync || typeof profile.sync !== "object" || Array.isArray(profile.sync)) profile.sync = {};
                    if (identity.username) profile.username = identity.username;
                    return { userId, identity, profile };
                };
                const getParticipationRecord = postId => {
                    const history = getParticipationHistory();
                    const selected = participationProfile(history, false);
                    return selected?.profile.records?.[String(postId)] || null;
                };
                const hasCommentEvidence = record => record?.status === "joined"
                    && Array.isArray(record.evidence)
                    && record.evidence.includes("comment");
                const commentBackedReminders = (prune = false) => {
                    const history = getParticipationHistory();
                    const selected = participationProfile(history, false);
                    if (!selected) return [];
                    const reminders = getReminders();
                    const eligible = reminders.filter(reminder => {
                        const postId = postIdFromUrl(reminder?.postUrl);
                        return postId && hasCommentEvidence(selected.profile.records?.[postId]);
                    });
                    if (prune && eligible.length !== reminders.length) saveReminders(eligible);
                    return eligible;
                };
                const pruneUncommentedParticipation = () => {
                    const history = getParticipationHistory();
                    let changed = false;
                    Object.values(history.users || {}).forEach(profile => {
                        if (!profile?.records || typeof profile.records !== "object") return;
                        Object.entries(profile.records).forEach(([postId, record]) => {
                            if (hasCommentEvidence(record)) return;
                            delete profile.records[postId];
                            changed = true;
                        });
                    });
                    if (changed) saveParticipationHistory(history);
                    commentBackedReminders(true);
                    return changed;
                };
                const sameStringArray = (left, right) => left.length === right.length && left.every((value, index) => value === right[index]);
                function confirmParticipation(details, evidence, source = "page") {
                    const postId = String(details?.postId || postIdFromUrl(details?.postUrl) || "");
                    const confirmedEvidence = [...new Set((Array.isArray(evidence) ? evidence : [evidence])
                        .map(value => String(value || "").trim()).filter(value => PARTICIPATION_LABELS[value]))].sort();
                    if (!postId || !confirmedEvidence.includes("comment")) return null;
                    const history = getParticipationHistory();
                    const selected = participationProfile(history, true);
                    if (!selected) return null;
                    const current = selected.profile.records[postId] || null;
                    const mergedEvidence = [...new Set([...(current?.evidence || []), ...confirmedEvidence])].sort();
                    const postUrl = details?.postUrl ? canonicalPostUrl(details.postUrl) : location.origin + "/post-" + postId + "-1";
                    const title = String(details?.title || current?.title || "抽奖活动").trim();
                    const next = {
                        postId,
                        postUrl,
                        title,
                        status: "joined",
                        confirmedAt: current?.confirmedAt || Date.now(),
                        evidence: mergedEvidence,
                        userId: selected.userId,
                        username: selected.identity.username || selected.profile.username || current?.username || "",
                        source: current?.source || source
                    };
                    const unchanged = current
                        && current.status === next.status
                        && current.postUrl === next.postUrl
                        && current.title === next.title
                        && current.username === next.username
                        && sameStringArray(current.evidence || [], next.evidence);
                    if (unchanged) {
                        if (!findReminder(postId)) saveLotteryDetails({ ...details, participatedAt: current.confirmedAt });
                        refreshLotteryDetails({ ...details, participatedAt: current.confirmedAt });
                        return current;
                    }
                    selected.profile.records[postId] = next;
                    saveParticipationHistory(history);
                    if (!findReminder(postId)) saveLotteryDetails({ ...details, participatedAt: next.confirmedAt });
                    refreshLotteryDetails({ ...details, participatedAt: next.confirmedAt });
                    return next;
                }
                const statusMessage = (type, text) => {
                    if (ctx.ui?.[type]) ctx.ui[type](text);
                    else window.alert(text);
                };
                const gmRequest = options => new Promise((resolve, reject) => {
                    GM_xmlhttpRequest({
                        timeout: 15000,
                        ...options,
                        onload: response => {
                            if (response.status >= 200 && response.status < 300) resolve(response);
                            else reject(new Error("HTTP " + response.status));
                        },
                        onerror: reject,
                        ontimeout: () => reject(new Error("请求超时"))
                    });
                });
                const postJson = (url, data, headers = {}) => gmRequest({
                    method: "POST",
                    url,
                    headers: { "Content-Type": "application/json", ...headers },
                    data: JSON.stringify(data)
                });
                const requireHttpsUrl = (raw, hosts) => {
                    const parsed = new URL(raw);
                    if (parsed.protocol !== "https:") throw new Error("通知地址必须使用 HTTPS");
                    if (hosts?.length && !hosts.includes(parsed.hostname.toLowerCase())) {
                        throw new Error("通知地址域名不受支持");
                    }
                    return parsed.href;
                };

                async function sendTelegram(config, subject, text, url) {
                    if (!config.enabled || !config.botToken || !config.chatId) return;
                    if (!/^[A-Za-z0-9_:-]+$/.test(config.botToken)) throw new Error("Telegram Bot Token 格式无效");
                    let content = "<b>" + escapeHtml(subject) + "</b>\n" + escapeHtml(text);
                    if (url) content += '\n\n<a href="' + escapeHtml(url) + '">查看抽奖</a>';
                    await postJson("https://api.telegram.org/bot" + config.botToken + "/sendMessage", {
                        chat_id: config.chatId,
                        text: content,
                        parse_mode: "HTML",
                        disable_web_page_preview: false
                    });
                }

                async function sendEmail(config, subject, text, url) {
                    if (!config.enabled) return;
                    const content = text + (url ? "\n\n链接: " + url : "");
                    const recipients = String(config.to || "").split(",").map(value => value.trim()).filter(Boolean);
                    if (!recipients.length) return;

                    if (config.provider === "resend") {
                        if (!config.apiKey || !config.from) return;
                        return postJson("https://api.resend.com/emails", {
                            from: config.from, to: recipients, subject, text: content
                        }, { Authorization: "Bearer " + config.apiKey });
                    }
                    if (config.provider === "mailgun") {
                        if (!config.apiKey || !config.domain || !config.from) return;
                        const form = new URLSearchParams();
                        form.append("from", config.from);
                        recipients.forEach(address => form.append("to", address));
                        form.append("subject", subject);
                        form.append("text", content);
                        return gmRequest({
                            method: "POST",
                            url: "https://api.mailgun.net/v3/" + encodeURIComponent(config.domain) + "/messages",
                            headers: {
                                Authorization: "Basic " + btoa("api:" + config.apiKey),
                                "Content-Type": "application/x-www-form-urlencoded"
                            },
                            data: form.toString()
                        });
                    }
                    if (config.provider === "sendgrid") {
                        if (!config.apiKey || !config.from) return;
                        return postJson("https://api.sendgrid.com/v3/mail/send", {
                            personalizations: [{ to: recipients.map(email => ({ email })) }],
                            from: { email: config.from },
                            subject,
                            content: [{ type: "text/plain", value: content }]
                        }, { Authorization: "Bearer " + config.apiKey });
                    }
                    if (config.provider === "emailjs") {
                        if (!config.serviceId || !config.templateId || !config.userId) return;
                        return postJson("https://api.emailjs.com/api/v1.0/email/send", {
                            service_id: config.serviceId,
                            template_id: config.templateId,
                            user_id: config.userId,
                            template_params: { to_email: recipients.join(","), subject, message: content }
                        });
                    }
                }

                async function sendWechat(config, subject, text, url) {
                    if (!config.enabled) return;
                    const content = text + (url ? "\n\n[点击查看](" + url + ")" : "");
                    if (config.provider === "serverchan3" && config.sendKey) {
                        return gmRequest({
                            method: "POST",
                            url: "https://sctapi.ftqq.com/" + encodeURIComponent(config.sendKey) + ".send",
                            headers: { "Content-Type": "application/x-www-form-urlencoded" },
                            data: "title=" + encodeURIComponent(subject) + "&desp=" + encodeURIComponent(content)
                        });
                    }
                    if (config.provider === "serverchan" && config.sendKey) {
                        return gmRequest({
                            method: "POST",
                            url: "https://sc.ftqq.com/" + encodeURIComponent(config.sendKey) + ".send",
                            headers: { "Content-Type": "application/x-www-form-urlencoded" },
                            data: "text=" + encodeURIComponent(subject) + "&desp=" + encodeURIComponent(content)
                        });
                    }
                    if (config.provider === "pushplus" && config.token) {
                        return postJson("https://www.pushplus.plus/send", {
                            token: config.token, title: subject, content, template: "markdown"
                        });
                    }
                }

                async function hmacBase64(keyText, message) {
                    const encoder = new TextEncoder();
                    const key = await crypto.subtle.importKey(
                        "raw", encoder.encode(keyText), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
                    );
                    const result = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
                    return btoa(String.fromCharCode(...new Uint8Array(result)));
                }

                async function sendDingtalk(config, subject, text, url) {
                    if (!config.enabled || !config.webhook) return;
                    let webhook = requireHttpsUrl(config.webhook, ["oapi.dingtalk.com"]);
                    if (config.secret) {
                        const timestamp = Date.now();
                        const sign = await hmacBase64(config.secret, timestamp + "\n" + config.secret);
                        const parsed = new URL(webhook);
                        parsed.searchParams.set("timestamp", String(timestamp));
                        parsed.searchParams.set("sign", sign);
                        webhook = parsed.href;
                    }
                    const content = text + (url ? "\n\n[点击查看](" + url + ")" : "");
                    const mobiles = String(config.atMobiles || "").split(",").map(value => value.trim()).filter(Boolean);
                    return postJson(webhook, {
                        msgtype: "markdown",
                        markdown: { title: subject, text: "#### " + subject + "\n" + content },
                        at: { atMobiles: mobiles, isAtAll: false }
                    });
                }

                async function sendFeishu(config, subject, text, url) {
                    if (!config.enabled || !config.webhook) return;
                    const webhook = requireHttpsUrl(config.webhook, ["open.feishu.cn"]);
                    const payload = {
                        msg_type: "text",
                        content: { text: subject + "\n" + text + (url ? "\n" + url : "") }
                    };
                    if (config.secret) {
                        const timestamp = Math.floor(Date.now() / 1000);
                        const signText = timestamp + "\n" + config.secret;
                        payload.timestamp = String(timestamp);
                        payload.sign = await hmacBase64(signText, "");
                    }
                    return postJson(webhook, payload);
                }

                async function sendWecom(config, subject, text, url) {
                    if (!config.enabled || !config.webhook) return;
                    const webhook = requireHttpsUrl(config.webhook, ["qyapi.weixin.qq.com"]);
                    const content = "**" + subject + "**\n" + text + (url ? "\n[查看详情](" + url + ")" : "");
                    return postJson(webhook, { msgtype: "markdown", markdown: { content } });
                }

                async function sendAllNotifications(subject, text, url, eventType = "result") {
                    if (typeof globalThis.__NSPRO_SEND_LOTTERY_NOTIFICATION === "function") {
                        const response = await globalThis.__NSPRO_SEND_LOTTERY_NOTIFICATION({
                            subject,
                            body: text,
                            url,
                            eventType
                        });
                        if (!response?.ok && !response?.skipped && !response?.failed) {
                            throw new Error(response?.error || "抽奖通知发送失败");
                        }
                        return response;
                    }
                    GM_notification({
                        title: subject,
                        text,
                        timeout: 0,
                        onclick: () => url && GM_openInTab(url, { active: true, insert: true })
                    });
                    const config = getNotifyConfig();
                    const recipients = String(config.email.to || "").split(",").map(value => value.trim()).filter(Boolean);
                    const emailReady = recipients.length > 0 && (
                        config.email.provider === "resend" && config.email.apiKey && config.email.from
                        || config.email.provider === "mailgun" && config.email.apiKey && config.email.domain && config.email.from
                        || config.email.provider === "sendgrid" && config.email.apiKey && config.email.from
                        || config.email.provider === "emailjs" && config.email.serviceId && config.email.templateId && config.email.userId
                    );
                    const wechatReady = config.wechat.provider === "pushplus"
                        ? !!config.wechat.token
                        : !!config.wechat.sendKey;
                    const jobs = [
                        { label: "Telegram", enabled: !!config.telegram.enabled, ready: !!config.telegram.botToken && !!config.telegram.chatId, run: () => sendTelegram(config.telegram, subject, text, url) },
                        { label: "邮件", enabled: !!config.email.enabled, ready: !!emailReady, run: () => sendEmail(config.email, subject, text, url) },
                        { label: "微信", enabled: !!config.wechat.enabled, ready: wechatReady, run: () => sendWechat(config.wechat, subject, text, url) },
                        { label: "企业微信", enabled: !!config.wecom.enabled, ready: !!config.wecom.webhook, run: () => sendWecom(config.wecom, subject, text, url) },
                        { label: "钉钉", enabled: !!config.dingtalk.enabled, ready: !!config.dingtalk.webhook, run: () => sendDingtalk(config.dingtalk, subject, text, url) },
                        { label: "飞书", enabled: !!config.feishu.enabled, ready: !!config.feishu.webhook, run: () => sendFeishu(config.feishu, subject, text, url) }
                    ];
                    const activeJobs = jobs.filter(job => job.enabled);
                    const results = await Promise.allSettled(activeJobs.map(job => job.ready
                        ? job.run()
                        : Promise.reject(new Error(job.label + " 配置不完整"))));
                    results.forEach((result, index) => {
                        if (result.status === "rejected") ctx.env.warn(activeJobs[index].label + " 通知失败", result.reason);
                    });
                    return summarizeNotificationDelivery(activeJobs.map(job => job.label), results);
                }

                function extractLuckyUrl(html, expectedPostId = null) {
                    const expected = String(expectedPostId || "");
                    const doc = new DOMParser().parseFromString(html, "text/html");
                    const normalizeLuckyUrl = value => {
                        try {
                            const url = new URL(String(value || "").replace(/&amp;/gi, "&"), location.origin);
                            if (/(^|\.)nodeseek\.com$/i.test(url.hostname) && /^\/lucky\/?$/i.test(url.pathname)) {
                                const linkedPostId = String(url.searchParams.get("post") || "");
                                if (!/^\d+$/.test(linkedPostId)) return null;
                                if (expected && linkedPostId !== expected) return null;
                                return url.href;
                            }
                            for (const key of ["to", "url", "target", "redirect"]) {
                                const nested = url.searchParams.get(key);
                                if (nested && nested !== value) {
                                    const lucky = normalizeLuckyUrl(nested);
                                    if (lucky) return lucky;
                                }
                            }
                        } catch { }
                        return null;
                    };
                    for (const link of doc.querySelectorAll("a[href],a[data-href]")) {
                        const lucky = normalizeLuckyUrl(link.getAttribute("href") || link.getAttribute("data-href"));
                        if (lucky) return lucky;
                    }
                    const source = `${doc.body?.textContent || ""}\n${String(html || "")}`;
                    const matches = source.match(/(?:https?:\/\/(?:www\.)?nodeseek\.com)?\/lucky\?[^\s"'<>)]*/ig) || [];
                    for (const match of matches) {
                        const lucky = normalizeLuckyUrl(match);
                        if (lucky) return lucky;
                    }
                    return null;
                }

                function getDrawTime(luckyUrl) {
                    try {
                        const raw = Number(new URL(luckyUrl).searchParams.get("time"));
                        if (!Number.isFinite(raw) || raw <= 0) return null;
                        const timestamp = raw < 1000000000000 ? raw * 1000 : raw;
                        return timestamp >= Date.UTC(2020, 0, 1) && timestamp < Date.UTC(2101, 0, 1)
                            ? timestamp
                            : null;
                    } catch {
                        return null;
                    }
                }

                const normalizeLotteryText = value => String(value || "")
                    .replace(/\u00a0/g, " ")
                    .replace(/[ \t]+/g, " ")
                    .replace(/\r/g, "");

                /* LOTTERY_TIME_PARSER_START */
                function parseLotteryDrawTime(value, now = Date.now()) {
                    const text = String(value || "")
                        .replace(/\u00a0/g, " ")
                        .replace(/(\d)[．。](?=\d)/g, "$1.")
                        .replace(/[ \t]+/g, " ")
                        .replace(/\r/g, "");
                    if (!text) return null;

                    const SHANGHAI_OFFSET = 8 * 60 * 60 * 1000;
                    const DAY = 24 * 60 * 60 * 1000;
                    const nowValue = Number.isFinite(Number(now)) ? Number(now) : Date.now();
                    const shanghaiNow = new Date(nowValue + SHANGHAI_OFFSET);
                    const currentYear = shanghaiNow.getUTCFullYear();
                    const currentMonth = shanghaiNow.getUTCMonth() + 1;
                    const currentDay = shanghaiNow.getUTCDate();
                    const candidates = [];

                    const buildTimestamp = (year, month, day, hour, minute, second = 0) => {
                        if (![year, month, day, hour, minute, second].every(Number.isInteger)) return null;
                        if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
                            return null;
                        }
                        const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute, second);
                        const checked = new Date(timestamp + SHANGHAI_OFFSET);
                        return checked.getUTCFullYear() === year
                            && checked.getUTCMonth() + 1 === month
                            && checked.getUTCDate() === day
                            && checked.getUTCHours() === hour
                            && checked.getUTCMinutes() === minute
                            && checked.getUTCSeconds() === second
                            ? timestamp
                            : null;
                    };

                    const parseClock = fragment => {
                        const match = String(fragment || "").match(
                            /(凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|晚间|晚)?\s*(\d{1,2})\s*(?:(?:[:：])\s*(\d{1,2})(?:(?:[:：])\s*(\d{1,2}))?|(?:点|时)\s*(半|(?:\d{1,2})\s*分?)?)/
                        );
                        if (!match) return null;
                        const period = match[1] || "";
                        let hour = Number(match[2]);
                        let minute = match[3] === undefined
                            ? (match[5] === "半" ? 30 : Number.parseInt(match[5], 10) || 0)
                            : Number(match[3]);
                        const second = match[4] === undefined ? 0 : Number(match[4]);
                        if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
                        if (/^(?:下午|傍晚|晚上|晚间|晚)$/.test(period) && hour < 12) hour += 12;
                        else if (period === "中午" && hour < 11) hour += 12;
                        else if (/^(?:凌晨|清晨|早上|上午)$/.test(period) && hour === 12) hour = 0;
                        return { hour, minute, second, index: match.index || 0 };
                    };

                    const scoreContext = (index, length) => {
                        const nearby = text.slice(Math.max(0, index - 18), Math.min(text.length, index + length + 32));
                        const wider = text.slice(Math.max(0, index - 36), Math.min(text.length, index + length + 56));
                        let score = 0;
                        if (/(?:开奖|开出|公布)(?:时间|日期)|(?:时间|日期)[^。；;！？!?\n]{0,8}(?:开奖|开出|公布)/.test(nearby)) score += 8;
                        if (/(?:开奖|开出|公布)/.test(nearby)) score += 4;
                        if (/(?:抽奖|截止|结束)(?:时间|日期)?/.test(wider)) score += 2;
                        if (/(?:不是|并非|非|不(?:是|做|参与)?)[^。；;！？!?\n]{0,4}抽奖/.test(wider)) score = 0;
                        return score;
                    };

                    const relativePattern = /(今天|今日|今晚|今夜|明天|明晚|后天)/g;
                    let match;
                    while ((match = relativePattern.exec(text))) {
                        const clock = parseClock(text.slice(match.index, match.index + 32));
                        const score = scoreContext(match.index, match[0].length);
                        if (!clock || !score) continue;
                        const dayOffset = /^(?:明天|明晚)$/.test(match[1]) ? 1 : match[1] === "后天" ? 2 : 0;
                        const base = new Date(Date.UTC(currentYear, currentMonth - 1, currentDay + dayOffset));
                        const timestamp = buildTimestamp(
                            base.getUTCFullYear(),
                            base.getUTCMonth() + 1,
                            base.getUTCDate(),
                            clock.hour,
                            clock.minute,
                            clock.second
                        );
                        if (timestamp !== null) candidates.push({ timestamp, score: score + 1, index: match.index });
                    }

                    const datePattern = /(?:(20\d{2})\s*(?:年|[./-])\s*)?(\d{1,2})\s*(?:月|[./-])\s*(\d{1,2})\s*(?:日|号)?/g;
                    while ((match = datePattern.exec(text))) {
                        const before = text.slice(Math.max(0, match.index - 20), match.index);
                        const after = text.slice(match.index + match[0].length, match.index + match[0].length + 36);
                        const clock = parseClock(after) || parseClock(before);
                        const score = scoreContext(match.index, match[0].length);
                        if (!clock || !score) continue;
                        const explicitYear = !!match[1];
                        let year = explicitYear ? Number(match[1]) : currentYear;
                        const month = Number(match[2]);
                        const day = Number(match[3]);
                        let timestamp = buildTimestamp(year, month, day, clock.hour, clock.minute, clock.second);
                        if (timestamp === null) continue;
                        if (!explicitYear && timestamp < nowValue - 45 * DAY) {
                            year += 1;
                            timestamp = buildTimestamp(year, month, day, clock.hour, clock.minute, clock.second);
                        }
                        if (timestamp !== null) candidates.push({ timestamp, score, index: match.index });
                    }

                    candidates.sort((left, right) => right.score - left.score || left.index - right.index);
                    return candidates[0]?.timestamp ?? null;
                }
                /* LOTTERY_TIME_PARSER_END */

                function compareLotteryDrawTimes(linkTime, luckyPageTime, postTime) {
                    const candidates = {
                        link: Number(linkTime) > 0 ? Number(linkTime) : null,
                        luckyPage: Number(luckyPageTime) > 0 ? Number(luckyPageTime) : null,
                        post: Number(postTime) > 0 ? Number(postTime) : null
                    };
                    const selected = ["link", "luckyPage", "post"].find(source => candidates[source]) || null;
                    const values = Object.values(candidates).filter(Boolean);
                    const conflict = values.length > 1 && Math.max(...values) - Math.min(...values) >= 60000;
                    return {
                        drawTime: selected ? candidates[selected] : null,
                        drawTimeSource: selected,
                        drawTimeCandidates: candidates,
                        drawTimeConflict: conflict
                    };
                }

                function resolveLotteryDrawTime(luckyUrl, text) {
                    return compareLotteryDrawTimes(
                        luckyUrl ? getDrawTime(luckyUrl) : null,
                        null,
                        parseLotteryDrawTime(text)
                    );
                }

                async function fetchLuckyPageDrawTime(luckyUrl) {
                    if (!luckyUrl) return null;
                    const response = await gmRequest({ method: "GET", url: luckyUrl });
                    const html = String(response.responseText || response.response || "");
                    if (!html) return null;
                    const doc = new DOMParser().parseFromString(html, "text/html");
                    return parseLotteryDrawTime(normalizeLotteryText(doc.body?.textContent || html));
                }

                async function compareLotteryDrawTimeSources(luckyUrl, postText) {
                    const linkTime = luckyUrl ? getDrawTime(luckyUrl) : null;
                    const postTime = parseLotteryDrawTime(postText);
                    let luckyPageTime = null;
                    if (luckyUrl) {
                        try {
                            luckyPageTime = await fetchLuckyPageDrawTime(luckyUrl);
                        } catch (error) {
                            ctx.env.warn("获取开奖页面时间失败，继续使用链接参数和帖子正文", error);
                        }
                    }
                    return compareLotteryDrawTimes(linkTime, luckyPageTime, postTime);
                }

                async function fetchFirstPageLotteryDetails(postUrl, compareLuckyPage = true) {
                    const firstPageUrl = canonicalPostUrl(postUrl);
                    const postId = postIdFromUrl(firstPageUrl);
                    if (!postId) return null;
                    const response = await gmRequest({ method: "GET", url: firstPageUrl });
                    const html = String(response.responseText || response.response || "");
                    if (!html) throw new Error("帖子第一页内容为空");
                    const doc = new DOMParser().parseFromString(html, "text/html");
                    const root = doc.querySelector(".nsk-post") || doc.querySelector("article.post-content") || doc.body;
                    const title = root?.querySelector("h1,.post-content-title,.post-title>a,.post-title")?.textContent?.trim()
                        || doc.title.replace(/\s*[-|]\s*NodeSeek.*$/i, "").trim()
                        || "未命名帖子";
                    const contentNode = lotteryContentNode(root);
                    const luckyUrl = extractLuckyUrl(contentNode?.outerHTML || "");
                    if (!lotteryTitleMatches(title) || !luckyUrl) return null;
                    const text = lotteryTextFromRoot(root);
                    const comparison = compareLuckyPage
                        ? await compareLotteryDrawTimeSources(luckyUrl, text)
                        : resolveLotteryDrawTime(luckyUrl, text);
                    return {
                        postId,
                        postUrl: firstPageUrl,
                        title,
                        luckyUrl,
                        ...comparison,
                        drawTimeCheckedAt: Date.now(),
                        ...extractParticipationRequirements(text)
                    };
                }

                function runLotteryListValidationQueue() {
                    while (lotteryListValidationActive < LOTTERY_LIST_VALIDATION_CONCURRENCY && lotteryListValidationQueue.length) {
                        const job = lotteryListValidationQueue.shift();
                        lotteryListValidationActive += 1;
                        Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => {
                            lotteryListValidationActive -= 1;
                            runLotteryListValidationQueue();
                        });
                    }
                }

                function enqueueLotteryListValidation(run, priority = 0) {
                    return new Promise((resolve, reject) => {
                        const job = { run, resolve, reject, priority };
                        const index = lotteryListValidationQueue.findIndex(queued => queued.priority < priority);
                        if (index < 0) lotteryListValidationQueue.push(job);
                        else lotteryListValidationQueue.splice(index, 0, job);
                        runLotteryListValidationQueue();
                    });
                }

                function cachedLotteryListDetails(postId) {
                    const key = String(postId);
                    let cached = lotteryListValidationCache.get(key);
                    if (!cached) {
                        const reminder = findReminder(key);
                        if (reminder?.luckyUrl && lotteryTitleMatches(reminder.title)) {
                            cached = {
                                details: { ...reminder, postId: key, postUrl: canonicalPostUrl(reminder.postUrl) },
                                expiresAt: Date.now() + 10 * 60 * 1000
                            };
                            lotteryListValidationCache.set(key, cached);
                            writeLotteryListCache();
                        }
                    }
                    if (!cached) return undefined;
                    if (cached.expiresAt <= Date.now()) {
                        lotteryListValidationCache.delete(key);
                        return undefined;
                    }
                    return cached.details;
                }

                function validateLotteryListPost(postUrl, postId, priority = 0) {
                    const key = String(postId || "");
                    if (!key || lotteryListValidationRequests.has(key)) return lotteryListValidationRequests.get(key) || null;
                    const request = enqueueLotteryListValidation(() => fetchFirstPageLotteryDetails(postUrl, false), priority).then(details => {
                        lotteryListValidationCache.set(key, {
                            details: details || null,
                            expiresAt: Date.now() + (details ? 10 * 60 * 1000 : 2 * 60 * 1000)
                        });
                        writeLotteryListCache();
                        return details;
                    }).catch(error => {
                        ctx.env.warn("首页抽奖帖验证失败", error);
                        lotteryListValidationCache.set(key, { details: null, expiresAt: Date.now() + 30 * 1000 });
                        writeLotteryListCache();
                        return null;
                    }).finally(() => {
                        lotteryListValidationRequests.delete(key);
                        if (active) refreshParticipationSoon();
                    });
                    lotteryListValidationRequests.set(key, request);
                    return request;
                }

                function extractCommentRequirement(value) {
                    const text = normalizeLotteryText(value);
                    const explicitlyNoComment = /(?:无需|无须|不需|不需要|不用|不必)(?:评论|留言|回复)/i.test(text);
                    const commentRequired = !explicitlyNoComment && [
                        /(?:必须|需要|需|请|参与方式.{0,8})?(?:评论|留言|回复)[^。；;！？!?\n]{0,36}(?:参加|参与|抽奖|资格)/i,
                        /(?:参加|参与|抽奖|资格)[^。；;！？!?\n]{0,36}(?:评论|留言|回复)/i
                    ].some(pattern => pattern.test(text));
                    return { commentRequired };
                }

                const PARTICIPATION_LABELS = {
                    comment: "评论",
                    like: "点赞",
                    coin: "加鸡腿",
                    favorite: "收藏"
                };

                function extractParticipationRequirements(value) {
                    const text = normalizeLotteryText(value);
                    const comment = extractCommentRequirement(text);
                    const context = /(?:必须|需要|要求|条件|参与方式|参加方法|参加条件|完成|请先|即可|方可|才能|后可|后即可|资格)/i.test(text);
                    const nearLottery = token => new RegExp(
                        `(?:${token})[^。；;！？!?\\n]{0,20}(?:参加|参与|抽奖|资格)|(?:参加|参与|抽奖|资格)[^。；;！？!?\\n]{0,20}(?:${token})`,
                        "i"
                    ).test(text);
                    const requirements = {
                        comment: !!comment.commentRequired,
                        like: (context || nearLottery("点赞|点个赞|赞一下")) && /点赞|点个赞|赞一下/i.test(text),
                        coin: (context || nearLottery("加鸡腿|投鸡腿|赠鸡腿|打赏鸡腿|送鸡腿")) && /(?:加|投|赠|打赏|送(?!出))[^。；;！？!?\n]{0,6}鸡腿|鸡腿(?:后|即可|才能|方可)/i.test(text),
                        favorite: (context || nearLottery("收藏|收藏本帖")) && /收藏|收藏本帖/i.test(text)
                    };
                    const keys = Object.keys(requirements).filter(key => requirements[key]);
                    const requirementMode = keys.length > 1 && /(?:评论|留言|回复|点赞|鸡腿|收藏)[^。；;！？!?\\n]{0,16}或[^。；;！？!?\\n]{0,16}(?:评论|留言|回复|点赞|鸡腿|收藏)/i.test(text)
                        ? "any"
                        : "all";
                    return {
                        ...comment,
                        requirements,
                        requirementMode
                    };
                }

                function titleFromRoot(root) {
                    const titleNode = root?.querySelector?.("h1,.post-content-title,.post-title>a") || root?.querySelector?.(".post-title");
                    const title = titleNode?.textContent?.trim();
                    return title || document.title.replace(/\s*[-|]\s*NodeSeek.*$/i, "").trim() || "未命名帖子";
                }

                function lotteryTitleMatches(value) {
                    return /(?:抽奖|giveaway|raffle)/i.test(String(value || ""));
                }

                function lotteryContentNode(root) {
                    return root?.matches?.(".post-content,article.post-content")
                        ? root
                        : root?.querySelector?.(":scope > .post-content,.post-content");
                }

                function lotteryTextFromRoot(root) {
                    const contentNode = lotteryContentNode(root);
                    const content = contentNode?.textContent || (ctx.isPost ? "" : root?.textContent || "");
                    return normalizeLotteryText(`${titleFromRoot(root)}\n${content}`);
                }

                function postUrlFromRoot(root) {
                    const link = root?.matches?.('a[href*="/post-"]')
                        ? root
                        : root?.querySelector?.('a[href*="/post-"]');
                    const source = link?.href || (ctx.isPost ? location.href : "");
                    return postIdFromUrl(source) ? canonicalPostUrl(source) : null;
                }

                function detectLottery(root, explicitPostUrl) {
                    if (!root) return null;
                    const postUrl = explicitPostUrl || postUrlFromRoot(root);
                    const postId = postIdFromUrl(postUrl);
                    if (!postId) return null;
                    const title = titleFromRoot(root);
                    if (!lotteryTitleMatches(title)) return null;
                    const contentNode = lotteryContentNode(root);
                    const luckyUrl = extractLuckyUrl(contentNode?.outerHTML || "");
                    if (!luckyUrl) return null;
                    const text = lotteryTextFromRoot(root);
                    const requirement = extractParticipationRequirements(text);
                    return {
                        postId,
                        postUrl,
                        title,
                        luckyUrl,
                        ...resolveLotteryDrawTime(luckyUrl, text),
                        ...requirement
                    };
                }

                const findReminder = postId => getReminders().find(value => postIdFromUrl(value.postUrl) === String(postId));
                const currentUserNames = () => {
                    const user = ctx.user || {};
                    return new Set([
                        user.username, user.user_name, user.member_name, user.nickname, user.name,
                        getNotifyConfig().autoResult.username
                    ].map(value => String(value || "").trim().toLowerCase()).filter(Boolean));
                };

                function matchingUserComments(details) {
                    if (!ctx.isPost || postIdFromUrl(location.href) !== details.postId) return [];
                    const names = currentUserNames();
                    return [...document.querySelectorAll(".comments .content-item,.comments .comment-item")].filter(comment => {
                        const authorLink = comment.querySelector('.author-info a[href*="/space/"],.author-name');
                        const author = authorLink?.textContent?.trim().toLowerCase();
                        const href = authorLink?.getAttribute?.("href") || "";
                        const sameUid = ctx.uid && new RegExp("/space/" + String(ctx.uid) + "(?:/|$|#)").test(href);
                        if (!sameUid && (!author || !names.has(author))) return false;
                        return true;
                    });
                }

                function matchingUserCommentCount(details) {
                    return matchingUserComments(details).length;
                }

                function parseCommentTimeValue(value, now = Date.now()) {
                    const text = normalizeLotteryText(value);
                    if (!text) return 0;
                    if (/^(?:刚刚|片刻前|现在)$/.test(text)) return now;
                    const relative = text.match(/((?:\d+\s*(?:天|小时|分钟|秒))+?)前/);
                    if (relative) {
                        const units = { 秒: 1000, 分钟: 60000, 小时: 3600000, 天: 86400000 };
                        const elapsed = [...relative[1].matchAll(/(\d+)\s*(天|小时|分钟|秒)/g)]
                            .reduce((total, match) => total + Number(match[1]) * units[match[2]], 0);
                        if (elapsed > 0) return now - elapsed;
                    }
                    const clock = text.match(/^(今天|昨天)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
                    if (clock) {
                        const date = new Date(now);
                        date.setHours(Number(clock[2]), Number(clock[3]), Number(clock[4] || 0), 0);
                        if (clock[1] === "昨天") date.setDate(date.getDate() - 1);
                        return date.getTime();
                    }
                    if (/^\d{10,13}$/.test(text)) {
                        const numeric = Number(text);
                        return text.length === 10 ? numeric * 1000 : numeric;
                    }
                    const parsed = Date.parse(text);
                    return Number.isFinite(parsed) ? parsed : 0;
                }

                function commentTimestamp(comment, now = Date.now()) {
                    const candidates = [];
                    comment.querySelectorAll("time,[datetime],[data-time],[data-timestamp],[class*='time'],[class*='date'],.nsk-content-meta-info,.author-info").forEach(element => {
                        ["datetime", "data-time", "data-timestamp", "title"].forEach(name => {
                            const value = element.getAttribute?.(name);
                            if (value) candidates.push(value);
                        });
                        if (element.textContent) candidates.push(element.textContent);
                    });
                    comment.querySelectorAll("*").forEach(element => {
                        if (!element.children.length && /(?:刚刚|片刻前|现在|\d+\s*(?:秒|分钟|小时|天)前|(?:今天|昨天)\s*\d{1,2}:\d{2})/.test(element.textContent || "")) {
                            candidates.push(element.textContent);
                        }
                    });
                    if (comment.textContent) candidates.push(comment.textContent);
                    for (const candidate of candidates) {
                        const timestamp = parseCommentTimeValue(candidate, now);
                        if (timestamp > 0 && timestamp <= now + 60000) return timestamp;
                    }
                    return 0;
                }

                function hasUserCommentAfter(details, boundary) {
                    const clearedAt = Number(boundary || 0);
                    const now = Date.now();
                    const earliestAccepted = clearedAt > 0 ? clearedAt : now - 10 * 60 * 1000;
                    return matchingUserComments(details).some(comment => commentTimestamp(comment, now) > earliestAccepted);
                }

                function hasMatchingUserComment(details) {
                    return matchingUserCommentCount(details) > 0;
                }

                function actionControlLabel(element) {
                    if (!element) return "";
                    const className = typeof element.className === "string" ? element.className : "";
                    return normalizeLotteryText([
                        element.textContent,
                        element.getAttribute?.("aria-label"),
                        element.getAttribute?.("title"),
                        element.getAttribute?.("data-action"),
                        element.getAttribute?.("data-testid"),
                        className,
                        element.getAttribute?.("href"),
                        element.outerHTML?.slice(0, 600)
                    ].filter(Boolean).join(" ")).toLowerCase();
                }

                function actionControlActive(element, action) {
                    const label = actionControlLabel(element);
                    const aliases = {
                        like: /点赞|点个赞|赞一下|upvote|like/,
                        coin: /鸡腿|投币|加鸡腿|coin|reward|donat/,
                        favorite: /收藏|收藏本帖|favorite|bookmark|collect/
                    }[action];
                    if (!aliases?.test(label)) return false;
                    const pressed = element.getAttribute?.("aria-pressed");
                    const checked = element.getAttribute?.("aria-checked");
                    const dataState = ["data-active", "data-liked", "data-collected", "data-favorited", "data-selected"]
                        .map(name => element.getAttribute?.(name)).filter(Boolean).join(" ");
                    const className = typeof element.className === "string" ? element.className : "";
                    return pressed === "true"
                        || checked === "true"
                        || dataState.split(/\s+/).some(value => /^(?:true|1|yes)$/i.test(value))
                        || /(?:已点赞|已赞|取消点赞|已收藏|取消收藏|已加鸡腿|已投币|已赠送|已打赏)/i.test(label)
                        || /(?:liked|collected|favorited|is-active|is-selected|is-checked|is-on)/i.test(className);
                }

                function configActionFlag(action) {
                    const source = ctx.uw?.__config__?.postData || ctx.uw?.__config__ || {};
                    const aliases = {
                        like: /(?:is|has|user|my|self|current).*(?:liked?|upvoted?|zan)|(?:liked|upvoted|votedbyme)$/i,
                        coin: /(?:is|has|user|my|self|current).*(?:coin|chicken|jiletui|reward|donat)|(?:rewarded|donated|coined|rewardedbyme)$/i,
                        favorite: /(?:is|has|user|my|self|current).*(?:favorite|bookmark|collect)|(?:favorited|bookmarked|collected|collectedbyme)$/i
                    }[action];
                    const seen = new Set();
                    let visited = 0;
                    const scan = (value, depth) => {
                        if (!value || typeof value !== "object" || depth > 4 || seen.has(value) || visited > 1500) return false;
                        seen.add(value);
                        for (const [key, child] of Object.entries(value)) {
                            visited += 1;
                            if (aliases?.test(key) && (child === true || child === 1 || /^(?:true|1|yes)$/i.test(String(child)))) return true;
                            if (child && typeof child === "object" && scan(child, depth + 1)) return true;
                        }
                        return false;
                    };
                    return scan(source, 0);
                }

                function hasMatchingUserAction(details, action) {
                    if (!ctx.isPost || postIdFromUrl(location.href) !== details.postId) return false;
                    const root = document.querySelector(".nsk-post") || document.querySelector("article.post-content") || document.body;
                    const selectors = "button,a,[role='button'],[aria-label],[title],[data-action],[class*='like'],[class*='collect'],[class*='favorite'],[class*='coin']";
                    if ([...root.querySelectorAll(selectors)].some(element => actionControlActive(element, action))) return true;
                    return configActionFlag(action);
                }

                function getRequirementInfo(details) {
                    const fallback = {
                        comment: !!details?.commentRequired,
                        like: !!details?.likeRequired,
                        coin: !!details?.coinRequired,
                        favorite: !!details?.favoriteRequired
                    };
                    const requirements = details?.requirements && typeof details.requirements === "object"
                        ? { ...fallback, ...details.requirements }
                        : fallback;
                    const keys = Object.keys(PARTICIPATION_LABELS).filter(key => !!requirements[key]);
                    const checks = {
                        comment: hasMatchingUserComment(details),
                        like: hasMatchingUserAction(details, "like"),
                        coin: hasMatchingUserAction(details, "coin"),
                        favorite: hasMatchingUserAction(details, "favorite")
                    };
                    const mode = details?.requirementMode === "any" ? "any" : "all";
                    const satisfied = keys.length > 0 && (mode === "any" ? keys.some(key => checks[key]) : keys.every(key => checks[key]));
                    return { requirements, keys, checks, mode, satisfied };
                }

                function getParticipationState(details) {
                    const historyRecord = getParticipationRecord(details.postId);
                    if (hasCommentEvidence(historyRecord)) {
                        return { kind: "joined", reminder: findReminder(details.postId) || null, historyRecord };
                    }
                    const reminder = findReminder(details.postId);
                    const mergedDetails = {
                        ...(reminder || {}),
                        ...details,
                        requirements: {
                            ...Object.keys(PARTICIPATION_LABELS).reduce((result, key) => {
                                result[key] = !!reminder?.requirements?.[key] || !!details.requirements?.[key];
                                return result;
                            }, {})
                        }
                    };
                    const info = getRequirementInfo(mergedDetails);
                    const evidence = Object.keys(info.checks).filter(key => info.checks[key]);
                    const clearedAt = Number(GM_getValue(PARTICIPATION_CLEARED_AT_KEY, 0) || 0);
                    const submittedComment = pendingCommentSubmission
                        && pendingCommentSubmission.postId === details.postId
                        && Date.now() - pendingCommentSubmission.at < 120000
                        && pendingCommentSubmission.at > clearedAt
                        && matchingUserCommentCount(details) > pendingCommentSubmission.commentCount;
                    const freshComment = hasUserCommentAfter(details, clearedAt);
                    if (submittedComment || freshComment) {
                        savePendingCommentSubmission(null);
                        const record = confirmParticipation(mergedDetails, evidence, submittedComment ? "comment-submit" : "comment-after-clear");
                        return { kind: "joined", reminder, info, historyRecord: record };
                    }
                    return { kind: "unjoined", reminder, info };
                }

                /* LOTTERY_RESULT_RESOLVER_START */
                function parseOfficialLotteryInfo(luckyUrl) {
                    const url = new URL(String(luckyUrl || ""), "https://www.nodeseek.com/");
                    if (!/(^|\.)nodeseek\.com$/i.test(url.hostname) || url.pathname !== "/lucky") {
                        throw new Error("无效的 NodeSeek 开奖链接");
                    }
                    const postId = Number.parseInt(url.searchParams.get("post"), 10);
                    const revealTime = Number.parseInt(url.searchParams.get("time"), 10);
                    const giftCount = Number.parseInt(url.searchParams.get("count"), 10);
                    const firstFloor = Number.parseInt(url.searchParams.get("start"), 10);
                    if (!Number.isSafeInteger(postId) || postId <= 0
                        || !Number.isSafeInteger(revealTime) || revealTime <= 0
                        || !Number.isSafeInteger(giftCount) || giftCount <= 0
                        || !Number.isSafeInteger(firstFloor) || firstFloor < 0) {
                        throw new Error("开奖链接参数不完整");
                    }
                    return {
                        postId,
                        revealTime,
                        giftCount,
                        firstFloor,
                        removeDuplicated: url.searchParams.get("duplicate") === "false"
                    };
                }

                function officialLotterySeed(value) {
                    let code;
                    let a = 1779033703;
                    let b = 3144134277;
                    let c = 1013904242;
                    let d = 2773480762;
                    for (let index = 0; index < value.length; index += 1) {
                        code = value.charCodeAt(index);
                        a = b ^ Math.imul(a ^ code, 597399067);
                        b = c ^ Math.imul(b ^ code, 2869860233);
                        c = d ^ Math.imul(c ^ code, 951274213);
                        d = a ^ Math.imul(d ^ code, 2716044179);
                    }
                    a = Math.imul(c ^ a >>> 18, 597399067);
                    b = Math.imul(d ^ b >>> 22, 2869860233);
                    c = Math.imul(a ^ c >>> 17, 951274213);
                    d = Math.imul(b ^ d >>> 19, 2716044179);
                    return [(a ^ b ^ c ^ d) >>> 0, (b ^ a) >>> 0, (c ^ a) >>> 0, (d ^ a) >>> 0];
                }

                function officialLotteryIndices(randomness, floorCount) {
                    let [a, b, c, d] = officialLotterySeed(String(randomness || ""));
                    const random = () => {
                        let value = (a >>>= 0) + (b >>>= 0) | 0;
                        a = b ^ b >>> 9;
                        b = (c >>>= 0) + (c << 3) | 0;
                        c = (c << 21 | c >>> 11) + (value = value + (d = 1 + (d >>>= 0) | 0) | 0) | 0;
                        return (value >>> 0) / 4294967296;
                    };
                    return Array.from({ length: floorCount }, (_, index) => ({ value: random(), index }))
                        .sort((left, right) => left.value - right.value)
                        .map(item => item.index);
                }

                function selectOfficialLotteryWinners(floors, drawInfo, randomness) {
                    const data = (Array.isArray(floors) ? floors : []).map(item => ({ ...item }));
                    const seenMembers = new Set();
                    data.forEach((item, index) => {
                        if (index < drawInfo.firstFloor) {
                            item.duplicate = false;
                        } else if (seenMembers.has(item.member_id)) {
                            item.duplicate = true;
                        } else {
                            item.duplicate = false;
                            seenMembers.add(item.member_id);
                        }
                    });
                    const winners = [];
                    for (const index of officialLotteryIndices(randomness, data.length)) {
                        if (winners.length >= drawInfo.giftCount) break;
                        const item = data[index];
                        if (!item || Number(item.floor_id) < drawInfo.firstFloor) continue;
                        if (item.duplicate && drawInfo.removeDuplicated) continue;
                        winners.push({
                            memberId: Number(item.member_id) || 0,
                            username: String(item.member_name || "").trim(),
                            floor: Number(item.floor_id) || 0
                        });
                    }
                    return winners.sort((left, right) => left.floor - right.floor);
                }

                function identifyOfficialLotteryResult(winners, identity) {
                    const memberId = Number(identity?.memberId) || 0;
                    const username = String(identity?.username || "").trim().toLowerCase();
                    if (!memberId && !username) return "unknown";
                    return winners.some(winner => memberId && winner.memberId === memberId
                        || username && winner.username.toLowerCase() === username) ? "won" : "lost";
                }
                /* LOTTERY_RESULT_RESOLVER_END */

                function resolveAutoResultIdentity(config) {
                    const identity = currentUserIdentity();
                    const configured = String(config?.username || "").trim();
                    return {
                        memberId: Number(identity.userId) || 0,
                        username: configured || identity.username
                    };
                }

                async function fetchOfficialLotteryResult(luckyUrl, identity) {
                    const drawInfo = parseOfficialLotteryInfo(luckyUrl);
                    if (Date.now() <= drawInfo.revealTime) return { ready: false };
                    const floorUrl = "https://www.nodeseek.com/api/content/floor-data?postId="
                        + drawInfo.postId + "&time=" + drawInfo.revealTime;
                    const floorResponse = await gmRequest({ method: "GET", url: floorUrl });
                    const floorPayload = JSON.parse(String(floorResponse.responseText || "{}"));
                    if (!floorPayload.success || !Array.isArray(floorPayload.data)) {
                        throw new Error(String(floorPayload.message || "获取抽奖楼层失败"));
                    }
                    const round = Math.floor((drawInfo.revealTime / 1000 - 1595431050) / 30);
                    if (!Number.isSafeInteger(round) || round <= 0) throw new Error("无法计算开奖随机数轮次");
                    const drandUrl = "https://api.drand.sh/8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce/public/" + round;
                    const drandResponse = await gmRequest({ method: "GET", url: drandUrl, anonymous: true });
                    const drandPayload = JSON.parse(String(drandResponse.responseText || "{}"));
                    if (!drandPayload.randomness) throw new Error("获取开奖随机数失败");
                    const winners = selectOfficialLotteryWinners(floorPayload.data, drawInfo, drandPayload.randomness);
                    return {
                        ready: true,
                        winners,
                        myStatus: identifyOfficialLotteryResult(winners, identity),
                        round,
                        participantCount: floorPayload.data.length
                    };
                }

                function formatLotteryWinner(winner) {
                    if (typeof winner === "string") return winner;
                    return winner.username + (Number.isFinite(Number(winner.floor)) ? "（" + winner.floor + " 楼）" : "");
                }

                async function notifyLotteryResult(reminder, config) {
                    const unchanged = { changed: false, notified: false };
                    const needsResultBackfill = !reminder?.resultCheckedAt || !Array.isArray(reminder?.winners);
                    if (!config?.enabled || !reminder?.luckyUrl || reminder.resultNotified && !needsResultBackfill) return unchanged;
                    const key = reminder.postUrl || reminder.luckyUrl;
                    if (resultRequesting.has(key)) return unchanged;
                    resultRequesting.add(key);
                    try {
                        const identity = resolveAutoResultIdentity(config);
                        const result = reminder.resultCheckedAt && Array.isArray(reminder.winners)
                            ? { ready: true, winners: reminder.winners, myStatus: reminder.resultStatus || "unknown" }
                            : await fetchOfficialLotteryResult(reminder.luckyUrl, identity);
                        if (!result.ready) return unchanged;
                        const newlyResolved = !reminder.resultCheckedAt;
                        reminder.winners = result.winners;
                        reminder.resultStatus = result.myStatus;
                        reminder.resultCheckedAt = reminder.resultCheckedAt || Date.now();
                        if (result.round) reminder.resultRandomRound = result.round;
                        if (Number.isFinite(result.participantCount)) reminder.resultParticipantCount = result.participantCount;
                        delete reminder.resultCheckLastError;
                        delete reminder.resultCheckFailedAt;
                        if (reminder.resultNotified) {
                            return { changed: newlyResolved || needsResultBackfill, notified: true, result };
                        }
                        if (!canAttemptNotification(reminder, "result")) {
                            return { changed: newlyResolved, notified: false, result };
                        }
                        const subject = result.myStatus === "won"
                            ? "恭喜中奖！"
                            : result.myStatus === "lost" ? "未中奖" : "抽奖已开奖";
                        const statusText = result.myStatus === "won"
                            ? "结果：已中奖"
                            : result.myStatus === "lost"
                                ? "结果：未中奖"
                                : "结果：已开奖（请在通知配置中填写用户名）";
                        try {
                            const delivery = await sendAllNotifications(
                                subject,
                                reminder.title + "\n" + statusText + "\n\n中奖名单：\n"
                                    + (result.winners.length ? result.winners.map(formatLotteryWinner).join("\n") : "没有有效中奖者"),
                                reminder.postUrl || reminder.luckyUrl,
                                "result"
                            );
                            const notified = recordNotificationDelivery(reminder, "result", delivery);
                            return { changed: true, notified, delivery, result };
                        } catch (error) {
                            const delivery = {
                                ok: false,
                                attempted: 1,
                                succeeded: [],
                                failed: [{ channel: "通知服务", message: String(error?.message || error || "发送失败") }]
                            };
                            recordNotificationDelivery(reminder, "result", delivery);
                            ctx.env.warn("开奖结果通知失败", error);
                            return { changed: true, notified: false, delivery, result };
                        }
                    } catch (error) {
                        reminder.resultCheckLastError = String(error?.message || error || "开奖结果识别失败");
                        reminder.resultCheckFailedAt = Date.now();
                        ctx.env.warn("自动识别抽奖结果失败", error);
                        return { changed: true, notified: false, error };
                    } finally {
                        resultRequesting.delete(key);
                    }
                }

                async function processCurrentLuckyPage() {
                    if (!active || location.pathname !== "/lucky") return;
                    const auto = getNotifyConfig().autoResult;
                    if (!auto.enabled) return;
                    const current = new URL(location.href);
                    const reminders = commentBackedReminders();
                    const reminder = reminders.find(value => {
                        if (!value.luckyUrl || value.resultNotified && value.resultCheckedAt && Array.isArray(value.winners)) return false;
                        try {
                            const target = new URL(value.luckyUrl);
                            return target.pathname === current.pathname && target.search === current.search;
                        } catch {
                            return false;
                        }
                    });
                    if (!reminder || Number(reminder.drawTime) > Date.now()) return;
                    const outcome = await notifyLotteryResult(reminder, auto);
                    if (outcome.changed) {
                        saveReminders(reminders);
                        renderList();
                    }
                }

                async function checkReminders() {
                    if (!active) return;
                    const reminders = commentBackedReminders();
                    const auto = getNotifyConfig().autoResult;
                    const now = Date.now();
                    const nearMs = Math.max(0, Number(ctx.store.get("lottery_reminder.near_minutes", 1)) || 1) * 60000;
                    let changed = false;
                    const resultJobs = [];

                    reminders.forEach(reminder => {
                        const drawTime = Number(reminder.drawTime);
                        if (!Number.isFinite(drawTime) || drawTime <= 0) return;
                        const remaining = drawTime - now;
                        if (remaining > 0 && remaining <= nearMs && canAttemptNotification(reminder, "nearDraw", now)) {
                            resultJobs.push(sendAllNotifications(
                                "抽奖即将开奖",
                                reminder.title + "\n将在 " + Math.max(1, Math.ceil(remaining / 60000)) + " 分钟内开奖",
                                reminder.postUrl || reminder.luckyUrl,
                                "nearDraw"
                            ).then(delivery => {
                                recordNotificationDelivery(reminder, "nearDraw", delivery);
                                changed = true;
                            }));
                        }
                        if (remaining <= 0 && (!auto.enabled || !reminder.luckyUrl)
                            && canAttemptNotification(reminder, "draw", now)) {
                            resultJobs.push(sendAllNotifications(
                                "抽奖已开奖",
                                reminder.title + "\n已经开奖，请打开抽奖页查看结果",
                                reminder.postUrl || reminder.luckyUrl,
                                "result"
                            ).then(delivery => {
                                recordNotificationDelivery(reminder, "draw", delivery);
                                changed = true;
                            }));
                        }
                        const needsResultBackfill = !reminder.resultCheckedAt || !Array.isArray(reminder.winners);
                        if (remaining <= 0 && auto.enabled && reminder.luckyUrl && (!reminder.resultNotified || needsResultBackfill)) {
                            resultJobs.push(notifyLotteryResult(reminder, auto).then(outcome => {
                                if (outcome.changed) changed = true;
                            }));
                        }
                    });
                    await Promise.allSettled(resultJobs);
                    if (changed) {
                        saveReminders(reminders);
                        renderList();
                    }
                }

                function countdownText(target) {
                    const diff = Number(target) - Date.now();
                    if (diff <= 0) return "已开奖";
                    const days = Math.floor(diff / 86400000);
                    const hours = Math.floor(diff % 86400000 / 3600000);
                    const minutes = Math.max(1, Math.floor(diff % 3600000 / 60000));
                    return (days ? days + "天" : "") + (hours ? hours + "小时" : "") + minutes + "分钟";
                }

                function updateCountdowns() {
                    panel?.querySelectorAll("[data-draw-time]").forEach(element => {
                        element.textContent = countdownText(element.dataset.drawTime);
                    });
                }

                function linkElement(label, href) {
                    const row = document.createElement("div");
                    row.className = "nsx-lottery-link";
                    row.append(document.createTextNode(label + ": "));
                    const link = document.createElement("a");
                    link.href = href;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.textContent = href;
                    row.appendChild(link);
                    return row;
                }

                function renderList() {
                    const list = panel?.querySelector(".nsx-lottery-list");
                    if (!list) return;
                    list.replaceChildren();
                    const reminders = commentBackedReminders().sort((a, b) => {
                        const left = Number(a.drawTime) || Number.MAX_SAFE_INTEGER;
                        const right = Number(b.drawTime) || Number.MAX_SAFE_INTEGER;
                        return left - right;
                    });
                    if (!reminders.length) {
                        const empty = document.createElement("div");
                        empty.className = "nsx-lottery-empty";
                        empty.textContent = "暂无已保存的抽奖";
                        list.appendChild(empty);
                        return;
                    }
                    reminders.forEach(reminder => {
                        const item = document.createElement("article");
                        item.className = "nsx-lottery-item";
                        const header = document.createElement("div");
                        header.className = "nsx-lottery-item-header";
                        const title = document.createElement("strong");
                        title.textContent = reminder.title || "抽奖活动";
                        const remove = document.createElement("button");
                        remove.type = "button";
                        remove.className = "nsx-lottery-icon-btn";
                        remove.title = "删除";
                        remove.setAttribute("aria-label", "删除抽奖");
                        remove.textContent = "×";
                        remove.addEventListener("click", () => {
                            saveReminders(getReminders().filter(value => value.postUrl !== reminder.postUrl));
                            renderList();
                            markParticipated();
                        });
                        header.append(title, remove);
                        item.appendChild(header);
                        item.appendChild(linkElement("帖子", reminder.postUrl));
                        if (reminder.luckyUrl) item.appendChild(linkElement("抽奖", reminder.luckyUrl));
                        const savedRequirements = reminder.requirements || {
                            comment: !!reminder.commentRequired,
                            like: !!reminder.likeRequired,
                            coin: !!reminder.coinRequired,
                            favorite: !!reminder.favoriteRequired
                        };
                        const savedKeys = Object.keys(PARTICIPATION_LABELS).filter(key => savedRequirements[key]);
                        if (savedKeys.length) {
                            const requirement = document.createElement("div");
                            requirement.className = "nsx-lottery-requirement";
                            const labels = savedKeys.map(key => PARTICIPATION_LABELS[key]);
                            requirement.textContent = "参与要求：" + labels.join(reminder.requirementMode === "any" ? " 或 " : " + ");
                            item.appendChild(requirement);
                        }
                        const time = document.createElement("div");
                        time.className = "nsx-lottery-time";
                        if (reminder.drawTime) {
                            const absolute = document.createElement("span");
                            absolute.textContent = new Date(reminder.drawTime).toLocaleString("zh-CN") + " · ";
                            const countdown = document.createElement("b");
                            countdown.dataset.drawTime = String(reminder.drawTime);
                            countdown.textContent = countdownText(reminder.drawTime);
                            time.append(absolute, countdown);
                            const sourceLabels = { link: "链接参数", luckyPage: "开奖页", post: "帖子正文" };
                            if (reminder.drawTimeSource) {
                                const source = document.createElement("span");
                                source.textContent = " · 来源：" + (sourceLabels[reminder.drawTimeSource] || reminder.drawTimeSource)
                                    + (reminder.drawTimeConflict ? "（三处时间不一致）" : "");
                                time.appendChild(source);
                            }
                        } else {
                            time.textContent = "未识别到开奖时间";
                        }
                        item.appendChild(time);
                        if (reminder.resultCheckedAt) {
                            const resultStatus = document.createElement("div");
                            const statusLabels = { won: "已中奖", lost: "未中奖", unknown: "已开奖" };
                            resultStatus.className = "nsx-lottery-result-status "
                                + (reminder.resultStatus === "won" ? "is-won" : reminder.resultStatus === "lost" ? "is-lost" : "");
                            resultStatus.textContent = "开奖结果：" + (statusLabels[reminder.resultStatus] || "已开奖");
                            item.appendChild(resultStatus);
                            const winners = Array.isArray(reminder.winners) ? reminder.winners : [];
                            const winnerList = document.createElement("div");
                            winnerList.className = "nsx-lottery-winners";
                            winnerList.textContent = "中奖者：" + (winners.length
                                ? winners.map(winner => typeof winner === "string" ? winner : formatLotteryWinner(winner)).join("、")
                                : "没有有效中奖者");
                            item.appendChild(winnerList);
                        } else if (reminder.resultCheckLastError) {
                            const resultStatus = document.createElement("div");
                            resultStatus.className = "nsx-lottery-delivery-status is-error";
                            resultStatus.textContent = "开奖结果识别失败，将自动重试";
                            resultStatus.title = reminder.resultCheckLastError;
                            item.appendChild(resultStatus);
                        }
                        if (reminder.resultNotified) {
                            const deliveryStatus = document.createElement("div");
                            deliveryStatus.className = "nsx-lottery-delivery-status is-success";
                            const statusLabels = { won: "已中奖", lost: "未中奖", unknown: "已开奖" };
                            deliveryStatus.textContent = "开奖结果通知：已发送（" + (statusLabels[reminder.resultStatus] || "已开奖") + "）";
                            item.appendChild(deliveryStatus);
                        } else if (reminder.resultNotifyLastError) {
                            const deliveryStatus = document.createElement("div");
                            deliveryStatus.className = "nsx-lottery-delivery-status is-error";
                            deliveryStatus.textContent = "开奖结果通知失败，将自动重试";
                            deliveryStatus.title = reminder.resultNotifyLastError;
                            item.appendChild(deliveryStatus);
                        } else if (reminder.resultCheckedAt && reminder.resultNotifySkippedAt) {
                            const deliveryStatus = document.createElement("div");
                            deliveryStatus.className = "nsx-lottery-delivery-status";
                            deliveryStatus.textContent = "结果已识别，通知未启用或没有可用渠道";
                            item.appendChild(deliveryStatus);
                        } else if (reminder.resultCheckedAt) {
                            const deliveryStatus = document.createElement("div");
                            deliveryStatus.className = "nsx-lottery-delivery-status";
                            deliveryStatus.textContent = "结果已识别，等待发送通知";
                            item.appendChild(deliveryStatus);
                        }
                        list.appendChild(item);
                    });
                }

                function saveLotteryDetails(details) {
                    const postId = String(details?.postId || postIdFromUrl(details?.postUrl) || "");
                    if (!postId || !hasCommentEvidence(getParticipationRecord(postId))) return null;
                    const reminders = getReminders();
                    const index = reminders.findIndex(value => postIdFromUrl(value.postUrl) === postId);
                    const current = index >= 0 ? reminders[index] : null;
                    const incomingCandidates = details.drawTimeCandidates && typeof details.drawTimeCandidates === "object"
                        ? details.drawTimeCandidates
                        : null;
                    const mergedCandidates = {
                        link: Number(current?.drawTimeCandidates?.link) > 0 ? Number(current.drawTimeCandidates.link) : null,
                        luckyPage: Number(current?.drawTimeCandidates?.luckyPage) > 0 ? Number(current.drawTimeCandidates.luckyPage) : null,
                        post: Number(current?.drawTimeCandidates?.post) > 0 ? Number(current.drawTimeCandidates.post) : null
                    };
                    if (incomingCandidates) {
                        Object.keys(mergedCandidates).forEach(source => {
                            if (Number(incomingCandidates[source]) > 0) mergedCandidates[source] = Number(incomingCandidates[source]);
                        });
                    }
                    if (details.drawTimeSource && Number(details.drawTime) > 0) {
                        mergedCandidates[details.drawTimeSource] = Number(details.drawTime);
                    }
                    const mergedComparison = compareLotteryDrawTimes(
                        mergedCandidates.link,
                        mergedCandidates.luckyPage,
                        mergedCandidates.post
                    );
                    const reminder = {
                        postUrl: details.postUrl,
                        luckyUrl: details.luckyUrl || current?.luckyUrl || null,
                        title: details.title || current?.title || "抽奖活动",
                        drawTime: mergedComparison.drawTime || details.drawTime || current?.drawTime || null,
                        drawTimeSource: mergedComparison.drawTimeSource || details.drawTimeSource || current?.drawTimeSource || null,
                        drawTimeCandidates: mergedComparison.drawTime ? mergedComparison.drawTimeCandidates : (current?.drawTimeCandidates || null),
                        drawTimeConflict: mergedComparison.drawTime ? mergedComparison.drawTimeConflict : !!current?.drawTimeConflict,
                        drawTimeCheckedAt: details.drawTimeCheckedAt || current?.drawTimeCheckedAt || null,
                        commentRequired: !!details.commentRequired || !!current?.commentRequired,
                        requirements: Object.keys(PARTICIPATION_LABELS).reduce((result, key) => {
                            result[key] = !!details.requirements?.[key]
                                || !!current?.requirements?.[key]
                                || !!details[key + "Required"]
                                || !!current?.[key + "Required"]
                                || (key === "comment" && (!!details.commentRequired || !!current?.commentRequired));
                            return result;
                        }, {}),
                        requirementMode: details.requirementMode === "any" || current?.requirementMode === "any" ? "any" : "all",
                        added: current?.added || Date.now(),
                        participatedAt: details.participatedAt || current?.participatedAt || null,
                        nearDrawNotified: current?.nearDrawNotified || false,
                        drawNotified: current?.drawNotified || false,
                        commentSubmittedAt: current?.commentSubmittedAt || null,
                        commentPendingAt: current?.commentPendingAt || null
                    };
                    if (index >= 0) reminders[index] = { ...current, ...reminder };
                    else reminders.push(reminder);
                    saveReminders(reminders);
                    renderList();
                    refreshLotteryIndicators();
                    return index >= 0 ? reminders[index] : reminder;
                }

                function detailsForCurrentPost() {
                    const root = document.querySelector(".nsk-post") || document.querySelector("article.post-content") || document.body;
                    return detectLottery(root, canonicalPostUrl(location.href));
                }

                async function refreshLotteryDetails(details, force = false) {
                    const postId = String(details?.postId || postIdFromUrl(details?.postUrl) || "");
                    if (!postId || !hasCommentEvidence(getParticipationRecord(postId)) || lotteryDetailRefreshes.has(postId)) return null;
                    const current = findReminder(postId);
                    if (!force && current?.drawTimeCheckedAt && current?.drawTime && current?.luckyUrl) return current;
                    lotteryDetailRefreshes.add(postId);
                    try {
                        const fetched = await fetchFirstPageLotteryDetails(details.postUrl || current?.postUrl);
                        if (!fetched) return current;
                        return saveLotteryDetails({
                            ...details,
                            ...fetched,
                            participatedAt: details.participatedAt || current?.participatedAt || null
                        });
                    } catch (error) {
                        ctx.env.warn("刷新抽奖时间对比失败", error);
                        return current;
                    } finally {
                        lotteryDetailRefreshes.delete(postId);
                    }
                }

                function refreshStoredLotteryDetails() {
                    commentBackedReminders()
                        .filter(reminder => !reminder.drawTimeCheckedAt || !reminder.luckyUrl || !reminder.drawTime)
                        .forEach(reminder => refreshLotteryDetails(reminder));
                }

                async function addCurrentLottery() {
                    if (!ctx.isPost) return statusMessage("warning", "请先打开一个帖子");
                    let details = detailsForCurrentPost();
                    if (!details?.postId) return statusMessage("warning", "当前帖子未识别为抽奖帖");
                    try {
                        const fetched = await fetchFirstPageLotteryDetails(details.postUrl);
                        if (fetched) {
                            details = {
                                ...details,
                                ...fetched,
                                commentRequired: !!details.commentRequired || !!fetched.commentRequired,
                                requirements: Object.keys(PARTICIPATION_LABELS).reduce((result, key) => {
                                    result[key] = !!details.requirements?.[key] || !!fetched.requirements?.[key];
                                    return result;
                                }, {}),
                                requirementMode: details.requirementMode === "any" || fetched.requirementMode === "any" ? "any" : "all"
                            };
                        }
                    } catch (error) {
                        ctx.env.warn("获取抽奖帖第一页失败，使用当前页面信息", error);
                    }
                    const state = getParticipationState(details);
                    if (state.kind !== "joined") return statusMessage("warning", "请先评论参加抽奖，评论成功后会自动记录并在临近开奖时通知");
                    saveLotteryDetails(details);
                    if (!details.luckyUrl) statusMessage("warning", "已记录评论参与，但未找到抽奖链接");
                    else if (!details.drawTime) statusMessage("warning", "已记录评论参与，但未识别到开奖时间");
                    else statusMessage("success", "已记录评论参与的抽奖");
                }

                function findPostRoot(element) {
                    return element?.closest?.(".post-list-item,.post-item,.nsk-post,li") || element?.closest?.("article.post-content");
                }

                function lotteryRoots() {
                    if (ctx.isPost) return [document.querySelector(".nsk-post") || document.querySelector("article.post-content")].filter(Boolean);
                    const roots = new Set();
                    document.querySelectorAll('a[href*="/post-"]').forEach(link => {
                        if (link.closest("#" + PANEL_ID) || link.href.includes("#")) return;
                        const root = findPostRoot(link);
                        if (root) roots.add(root);
                    });
                    return [...roots];
                }

                function lotteryRootPriority(root) {
                    const rect = root?.getBoundingClientRect?.();
                    if (!rect) return 0;
                    if (rect.bottom >= 0 && rect.top <= window.innerHeight) return 2;
                    return rect.top > window.innerHeight ? 1 : 0;
                }

                function handleLotteryAction(details) {
                    const state = getParticipationState(details);
                    openPanel();
                    if (state.kind !== "joined") statusMessage("warning", "评论参加后才会加入我的抽奖记录");
                }

                function lotteryStatusColor(state) {
                    const joined = state?.kind === "joined";
                    const path = joined ? "lottery_reminder.joined_badge_color" : "lottery_reminder.unjoined_badge_color";
                    const fallback = joined ? "#16a34a" : "#d97706";
                    return normalizeStatusColor(ctx.store.get(path, fallback), fallback);
                }

                function ensureCurrentLotteryAction(details) {
                    if (!ctx.isPost || !details) return;
                    const root = document.querySelector(".nsk-post") || document.querySelector("article.post-content");
                    const metaInfo = root?.querySelector(".nsk-content-meta-info");
                    const mount = metaInfo?.querySelector(".floor-link-wrapper") || metaInfo;
                    if (!mount) return;
                    const state = getParticipationState(details);
                    let button = mount.querySelector(".nsx-lottery-post-action");
                    if (!button) {
                        button = document.createElement("button");
                        button.type = "button";
                        button.className = "nsx-relation-btn nsx-lottery-post-action";
                        mount.prepend(button);
                    }
                    if (button.dataset.state !== state.kind) button.dataset.state = state.kind;
                    button.style.setProperty("--nsx-status-color", lotteryStatusColor(state));
                    button.title = "打开抽奖提醒";
                    button.textContent = "抽奖提醒";
                    button.onclick = () => handleLotteryAction(details);
                }

                function renderLotteryStateTag(root, state, existingTags) {
                    const oldTag = root?.querySelector(".nsx-lottery-state-tag");
                    const titleNode = ctx.isPost
                        ? root?.querySelector("h1,.post-content-title,.post-title")
                        : root?.querySelector('.post-title a[href*="/post-"],a[href*="/post-"]');
                    if (!titleNode) {
                        oldTag?.remove();
                        existingTags?.delete(oldTag);
                        return;
                    }
                    const tag = oldTag || document.createElement("span");
                    if (!oldTag) {
                        tag.className = "nsx-forum-status-tag nsx-lottery-state-tag";
                        titleNode.insertAdjacentElement("afterend", tag);
                    }
                    tag.classList.add("nsx-forum-status-tag");
                    existingTags?.delete(tag);
                    tag.dataset.state = state.kind;
                    tag.style.setProperty("--nsx-status-color", lotteryStatusColor(state));
                    const tagText = state.kind === "joined" ? "抽奖已参加" : "抽奖未参加";
                    tag.textContent = tagText;
                    tag.title = tagText;
                }

                function refreshLotteryIndicators() {
                    const existingTags = new Set(document.querySelectorAll(".nsx-lottery-state-tag"));
                    if (!active) {
                        existingTags.forEach(element => element.remove());
                        document.querySelectorAll(".nsx-lottery-post-action").forEach(element => element.remove());
                        return;
                    }
                    const autoDetect = ctx.store.get("lottery_reminder.auto_detect", true);
                    if (ctx.isPost) {
                        const root = document.querySelector(".nsk-post") || document.querySelector("article.post-content") || document.body;
                        const details = autoDetect ? detectLottery(root, canonicalPostUrl(location.href)) : null;
                        if (details) {
                            const state = getParticipationState(details);
                            renderLotteryStateTag(root, state, existingTags);
                            ensureCurrentLotteryAction(details);
                            if (state.kind === "joined") refreshLotteryDetails(details);
                        } else {
                            existingTags.forEach(element => element.remove());
                            document.querySelectorAll(".nsx-lottery-post-action").forEach(element => element.remove());
                        }
                        existingTags.forEach(element => element.remove());
                        return;
                    }
                    document.querySelectorAll(".nsx-lottery-post-action").forEach(element => element.remove());
                    if (!autoDetect) {
                        existingTags.forEach(element => element.remove());
                        return;
                    }
                    lotteryRoots().forEach(root => {
                        const postUrl = postUrlFromRoot(root);
                        const postId = postIdFromUrl(postUrl);
                        const title = titleFromRoot(root);
                        if (!postId || !lotteryTitleMatches(title)) {
                            const oldTag = root.querySelector(".nsx-lottery-state-tag");
                            oldTag?.remove();
                            existingTags.delete(oldTag);
                            return;
                        }
                        const details = cachedLotteryListDetails(postId);
                        if (details === undefined) {
                            const oldTag = root.querySelector(".nsx-lottery-state-tag");
                            oldTag?.remove();
                            existingTags.delete(oldTag);
                            validateLotteryListPost(postUrl, postId, lotteryRootPriority(root));
                            return;
                        }
                        if (!details) {
                            const oldTag = root.querySelector(".nsx-lottery-state-tag");
                            oldTag?.remove();
                            existingTags.delete(oldTag);
                            return;
                        }
                        const state = getParticipationState(details);
                        renderLotteryStateTag(root, state, existingTags);
                    });
                    existingTags.forEach(element => element.remove());
                }

                function startParticipationMonitor() {
                    if (!ctx.isPost) return;
                    const root = document.querySelector(".nsk-post") || document.querySelector("article.post-content");
                    const targets = [...new Set([root, document.querySelector(".comments")].filter(Boolean))];
                    if (targets.length) {
                        participationObserver?.disconnect();
                        participationObserver = new MutationObserver(() => refreshParticipationSoon());
                        targets.forEach(target => participationObserver.observe(target, { childList: true, subtree: true, attributes: true }));
                    }
                    if (!participationClickHandler) {
                        participationClickHandler = event => {
                            if (!active || !ctx.isPost) return;
                            const target = event.target?.closest?.("button,a,[role='button'],[aria-label],[title]");
                            if (!target || target.classList.contains("nsx-lottery-post-action")) return;
                            if (target.matches?.(".md-editor button.submit.btn") || actionControlLabel(target).match(/^(?:发布|回复|评论|提交)(?:\s|$)/i)) {
                                const details = detailsForCurrentPost();
                                if (details?.postId) {
                                    savePendingCommentSubmission({
                                        postId: details.postId,
                                        commentCount: matchingUserCommentCount(details),
                                        at: Date.now()
                                    });
                                    setTimeout(refreshParticipationSoon, 500);
                                }
                                return;
                            }
                            if (actionControlLabel(target).match(/点赞|鸡腿|投币|收藏|favorite|bookmark|like|coin|collect/i)) {
                                setTimeout(refreshParticipationSoon, 350);
                            }
                        };
                        document.addEventListener("click", participationClickHandler, true);
                    }
                }

                function stopParticipationMonitor() {
                    participationObserver?.disconnect();
                    participationObserver = null;
                    if (participationClickHandler) {
                        document.removeEventListener("click", participationClickHandler, true);
                        participationClickHandler = null;
                    }
                }

                const markParticipated = refreshLotteryIndicators;

                function openLotterySettings() {
                    if (typeof globalThis.__NSPRO_OPEN_OPTIONS === "function") {
                        globalThis.__NSPRO_OPEN_OPTIONS("lottery");
                        return;
                    }
                    openNotifyConfig();
                }

                function openNotifyConfig() {
                    document.getElementById(MODAL_ID)?.remove();
                    const config = getNotifyConfig();
                    const mask = document.createElement("div");
                    mask.id = MODAL_ID;
                    mask.className = "nsx-lottery-modal-mask";
                    const modal = document.createElement("section");
                    modal.className = "nsx-lottery-modal";
                    const heading = document.createElement("div");
                    heading.className = "nsx-lottery-modal-header";
                    const title = document.createElement("h3");
                    title.textContent = "抽奖通知配置";
                    const close = document.createElement("button");
                    close.type = "button";
                    close.className = "nsx-lottery-icon-btn";
                    close.title = "关闭";
                    close.textContent = "×";
                    heading.append(title, close);
                    modal.appendChild(heading);

                    const sections = [
                        {
                            title: "开奖结果",
                            fields: [
                                { path: "autoResult.enabled", label: "开奖后自动识别并通知", type: "checkbox" },
                                { path: "autoResult.username", label: "我的用户名", placeholder: "用于判断是否中奖" }
                            ]
                        },
                        {
                            title: "Telegram Bot",
                            fields: [
                                { path: "telegram.enabled", label: "启用", type: "checkbox" },
                                { path: "telegram.botToken", label: "Bot Token", type: "password" },
                                { path: "telegram.chatId", label: "Chat ID" }
                            ]
                        },
                        {
                            title: "邮件",
                            fields: [
                                { path: "email.enabled", label: "启用", type: "checkbox" },
                                { path: "email.provider", label: "服务商", type: "select", options: { resend: "Resend", mailgun: "Mailgun", sendgrid: "SendGrid", emailjs: "EmailJS" } },
                                { path: "email.apiKey", label: "API Key", type: "password", when: value => value.email.provider !== "emailjs" },
                                { path: "email.domain", label: "Mailgun Domain", when: value => value.email.provider === "mailgun" },
                                { path: "email.from", label: "发件人", when: value => value.email.provider !== "emailjs" },
                                { path: "email.to", label: "收件人", placeholder: "多个地址用逗号分隔" },
                                { path: "email.serviceId", label: "Service ID", when: value => value.email.provider === "emailjs" },
                                { path: "email.templateId", label: "Template ID", when: value => value.email.provider === "emailjs" },
                                { path: "email.userId", label: "Public Key", type: "password", when: value => value.email.provider === "emailjs" }
                            ]
                        },
                        {
                            title: "微信推送",
                            fields: [
                                { path: "wechat.enabled", label: "启用", type: "checkbox" },
                                { path: "wechat.provider", label: "服务商", type: "select", options: { serverchan3: "Server酱³", serverchan: "Server酱旧版", pushplus: "PushPlus" } },
                                { path: "wechat.sendKey", label: "SendKey", type: "password", when: value => value.wechat.provider !== "pushplus" },
                                { path: "wechat.token", label: "Token", type: "password", when: value => value.wechat.provider === "pushplus" }
                            ]
                        },
                        {
                            title: "企业微信",
                            fields: [
                                { path: "wecom.enabled", label: "启用", type: "checkbox" },
                                { path: "wecom.webhook", label: "Webhook", type: "password" }
                            ]
                        },
                        {
                            title: "钉钉",
                            fields: [
                                { path: "dingtalk.enabled", label: "启用", type: "checkbox" },
                                { path: "dingtalk.webhook", label: "Webhook", type: "password" },
                                { path: "dingtalk.secret", label: "加签 Secret", type: "password" },
                                { path: "dingtalk.atMobiles", label: "@手机号", placeholder: "多个号码用逗号分隔" }
                            ]
                        },
                        {
                            title: "飞书",
                            fields: [
                                { path: "feishu.enabled", label: "启用", type: "checkbox" },
                                { path: "feishu.webhook", label: "Webhook", type: "password" },
                                { path: "feishu.secret", label: "加签 Secret", type: "password" }
                            ]
                        }
                    ];
                    const controls = new Map();
                    const descriptors = [];
                    sections.forEach(section => {
                        const fieldset = document.createElement("fieldset");
                        const legend = document.createElement("legend");
                        legend.textContent = section.title;
                        fieldset.appendChild(legend);
                        section.fields.forEach(field => {
                            const row = document.createElement("label");
                            row.className = "nsx-lottery-form-row";
                            const label = document.createElement("span");
                            label.textContent = field.label;
                            let control;
                            if (field.type === "select") {
                                control = document.createElement("select");
                                Object.entries(field.options).forEach(([value, text]) => {
                                    const option = document.createElement("option");
                                    option.value = value;
                                    option.textContent = text;
                                    control.appendChild(option);
                                });
                            } else {
                                control = document.createElement("input");
                                control.type = field.type || "text";
                                if (control.type === "password") control.autocomplete = "off";
                            }
                            const value = getPathValue(config, field.path);
                            if (control.type === "checkbox") control.checked = !!value;
                            else control.value = value ?? "";
                            if (field.placeholder) control.placeholder = field.placeholder;
                            controls.set(field.path, control);
                            descriptors.push({ field, row });
                            row.append(label, control);
                            fieldset.appendChild(row);
                        });
                        modal.appendChild(fieldset);
                    });

                    const collect = () => {
                        const value = clone(DEFAULT_NOTIFY);
                        controls.forEach((control, path) => {
                            setPathValue(value, path, control.type === "checkbox" ? control.checked : control.value.trim());
                        });
                        return value;
                    };
                    const refreshVisibility = () => {
                        const value = collect();
                        descriptors.forEach(({ field, row }) => {
                            row.hidden = field.when ? !field.when(value) : false;
                        });
                    };
                    controls.forEach(control => {
                        if (control.tagName === "SELECT") control.addEventListener("change", refreshVisibility);
                    });
                    refreshVisibility();

                    const actions = document.createElement("div");
                    actions.className = "nsx-lottery-modal-actions";
                    const test = document.createElement("button");
                    test.type = "button";
                    test.textContent = "测试通知";
                    const cancel = document.createElement("button");
                    cancel.type = "button";
                    cancel.textContent = "取消";
                    const save = document.createElement("button");
                    save.type = "button";
                    save.className = "is-primary";
                    save.textContent = "保存";
                    actions.append(test, cancel, save);
                    modal.appendChild(actions);
                    mask.appendChild(modal);
                    document.body.appendChild(mask);

                    const closeModal = () => mask.remove();
                    close.addEventListener("click", closeModal);
                    cancel.addEventListener("click", closeModal);
                    mask.addEventListener("click", event => event.target === mask && closeModal());
                    save.addEventListener("click", () => {
                        saveNotifyConfig(collect());
                        statusMessage("success", "通知配置已保存");
                        closeModal();
                    });
                    test.addEventListener("click", async () => {
                        saveNotifyConfig(collect());
                        test.disabled = true;
                        const testReminder = getReminders().find(value => value.postUrl);
                        const testUrl = (ctx.isPost ? canonicalPostUrl(location.href) : null)
                            || testReminder?.postUrl
                            || location.origin + "/";
                        try {
                            const delivery = await sendAllNotifications(
                                "NodeSeek 抽奖提醒测试",
                                "通知通道测试\n时间: " + new Date().toLocaleString("zh-CN"),
                                testUrl
                            );
                            if (delivery.ok) statusMessage("success", "测试通知已发送");
                            else statusMessage("error", "测试通知失败：" + delivery.failed.map(item => item.channel + " - " + item.message).join("；"));
                        } catch (error) {
                            statusMessage("error", "测试通知失败：" + String(error?.message || error));
                        } finally {
                            test.disabled = false;
                        }
                    });
                }

                function createPanel() {
                    panel = document.getElementById(PANEL_ID);
                    if (panel) return panel;
                    panel = document.createElement("section");
                    panel.id = PANEL_ID;
                    panel.setAttribute("aria-label", "抽奖提醒");
                    panel.innerHTML =
                        '<div class="nsx-lottery-panel-header">' +
                            '<strong>抽奖提醒管理器</strong>' +
                            '<button type="button" class="nsx-lottery-icon-btn" data-action="close" title="关闭" aria-label="关闭">×</button>' +
                        '</div>' +
                        '<div class="nsx-lottery-toolbar">' +
                            '<button type="button" data-action="notify">通知设置</button>' +
                            '<button type="button" class="nsx-lottery-icon-btn" data-action="refresh" title="刷新" aria-label="刷新">↻</button>' +
                        '</div>' +
                        '<div class="nsx-lottery-list"></div>';
                    document.body.appendChild(panel);
                    panel.querySelector('[data-action="close"]').addEventListener("click", closePanel);
                    panel.querySelector('[data-action="notify"]').addEventListener("click", openLotterySettings);
                    panel.querySelector('[data-action="refresh"]').addEventListener("click", () => {
                        renderList();
                        checkReminders();
                    });
                    renderList();
                    return panel;
                }

                function createTrigger() {
                    if (!active) return false;
                    const group = ensureIconGroup();
                    if (!group) return false;
                    trigger = document.getElementById("nsx-lottery-trigger");
                    if (trigger) return true;
                    trigger = document.createElement("a");
                    trigger.id = "nsx-lottery-trigger";
                    trigger.className = "lottery-dropdown-on";
                    trigger.href = "javascript:void(0);";
                    trigger.title = "抽奖提醒";
                    trigger.setAttribute("aria-label", "打开抽奖提醒");
                    trigger.innerHTML = '<svg aria-hidden="true"><use href="#remind-6nce9p47"></use></svg>';
                    trigger.addEventListener("click", event => {
                        event.preventDefault();
                        event.stopPropagation();
                        togglePanel();
                    });
                    group.appendChild(trigger);
                    return true;
                }

                function openPanel() {
                    createPanel();
                    closeOtherPanels("lottery");
                    panel.classList.add("show");
                }
                function closePanel() {
                    panel?.classList.remove("show");
                }
                function togglePanel() {
                    panel?.classList.contains("show") ? closePanel() : openPanel();
                }

                function addStyles() {
                    ctx.addStyle(STYLE_ID,
                        '#nsx-icon-group>.lottery-dropdown-on{cursor:pointer;display:flex!important;align-items:center;justify-content:center;height:30px!important;padding:0 6px!important;min-width:auto!important;color:inherit;text-decoration:none}' +
                        '#nsx-icon-group>.lottery-dropdown-on svg{display:block!important;width:16px!important;height:16px!important}' +
                        '#nsx-icon-group>.lottery-dropdown-on:hover{opacity:.6}' +
                        '#nsx-lottery-panel{position:fixed;right:12px;top:60px;width:min(390px,94vw);height:min(720px,80vh);background:#fff;border:1px solid #e4e4e4;border-radius:8px;box-shadow:0 16px 32px rgba(0,0,0,.12);z-index:99999;display:none;flex-direction:column;overflow:hidden;color:#333}' +
                        '#nsx-lottery-panel.show{display:flex}' +
                        '.nsx-lottery-panel-header{height:46px;padding:0 12px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #eee}' +
                        '.nsx-lottery-toolbar{display:flex;gap:8px;padding:10px 12px;border-bottom:1px solid #eee}' +
                        '.nsx-lottery-toolbar button,.nsx-lottery-modal-actions button{border:1px solid #d8d8d8;background:#fff;color:#333;border-radius:4px;padding:6px 10px;cursor:pointer}' +
                        '.nsx-lottery-toolbar button:first-child,.nsx-lottery-modal-actions .is-primary{background:#1677ff;border-color:#1677ff;color:#fff}' +
                        '.nsx-lottery-toolbar button:disabled{opacity:.5;cursor:not-allowed}' +
                        '.nsx-lottery-icon-btn{border:0!important;background:transparent!important;color:inherit!important;width:28px;height:28px;padding:0!important;font-size:20px;line-height:28px;cursor:pointer}' +
                        '.nsx-lottery-list{padding:10px 12px;overflow:auto;flex:1}' +
                        '.nsx-lottery-item{padding:10px 0;border-bottom:1px solid #eee}' +
                        '.nsx-lottery-item:last-child{border-bottom:0}' +
                        '.nsx-lottery-item-header{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:5px}' +
                        '.nsx-lottery-item-header strong{font-size:14px;line-height:1.4}' +
                        '.nsx-lottery-link{font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:3px 0}' +
                        '.nsx-lottery-link a{color:#1677ff}' +
                        '.nsx-lottery-time{font-size:12px;color:#777;margin-top:6px}' +
                        '.nsx-lottery-time b{color:#d4380d}' +
                        '.nsx-lottery-requirement{font-size:12px;color:#8c6d1f;margin-top:6px;line-height:1.45;overflow-wrap:anywhere}' +
                        '.nsx-lottery-result-status,.nsx-lottery-winners,.nsx-lottery-delivery-status{font-size:12px;line-height:1.55;margin-top:6px;overflow-wrap:anywhere}' +
                        '.nsx-lottery-result-status{font-weight:700;color:#1677ff}' +
                        '.nsx-lottery-result-status.is-won{color:#2e7d32}' +
                        '.nsx-lottery-result-status.is-lost,.nsx-lottery-winners,.nsx-lottery-delivery-status{color:#777}' +
                        '.nsx-lottery-delivery-status.is-success{color:#2e7d32}' +
                        '.nsx-lottery-delivery-status.is-error{color:#d4380d}' +
                        '.nsx-lottery-empty{padding:32px 8px;text-align:center;color:#999}' +
                        '.nsx-lottery-participated{display:inline-block;margin-left:6px;padding:1px 5px;border-radius:4px;background:#e8f5e9;color:#2e7d32;font-size:11px;font-weight:600}' +
                        '.nsx-lottery-post-action{font-size:10px!important;padding:2px 8px!important;border-radius:5px!important;cursor:pointer;line-height:1.6;font-weight:600;white-space:nowrap}' +
                        '.nsx-lottery-participation-body{font-size:14px;line-height:1.7;color:inherit;padding:4px 0}' +
                        '.nsx-lottery-participation-body code{display:block;margin:10px 0;padding:10px 12px;border:1px solid #d9e2f3;border-radius:6px;background:#f5f8ff;color:#165dce;font-size:16px;word-break:break-word;white-space:pre-wrap}' +
                        '.nsx-lottery-modal-mask{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px}' +
                        '.nsx-lottery-modal{width:min(560px,96vw);max-height:90vh;overflow:auto;background:#fff;color:#333;border-radius:8px;padding:18px}' +
                        '.nsx-lottery-modal-header{position:sticky;top:-18px;background:#fff;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:4px 0 10px;border-bottom:1px solid #eee}' +
                        '.nsx-lottery-modal-header h3{margin:0;font-size:17px}' +
                        '.nsx-lottery-modal fieldset{border:0;border-top:1px solid #eee;margin:16px 0 0;padding:12px 0 0}' +
                        '.nsx-lottery-modal legend{padding-right:8px;font-weight:600;color:#1677ff}' +
                        '.nsx-lottery-form-row{display:grid;grid-template-columns:140px minmax(0,1fr);align-items:center;gap:10px;margin:8px 0;font-size:13px}' +
                        '.nsx-lottery-form-row input:not([type=checkbox]),.nsx-lottery-form-row select{width:100%;min-width:0;box-sizing:border-box;border:1px solid #d8d8d8;border-radius:4px;padding:6px 8px;background:#fff;color:#333}' +
                        '.nsx-lottery-form-row input[type=checkbox]{justify-self:start}' +
                        '.nsx-lottery-modal-actions{position:sticky;bottom:-18px;background:#fff;display:flex;justify-content:flex-end;gap:8px;padding:12px 0 2px;border-top:1px solid #eee}' +
                        '.dark-layout #nsx-lottery-panel,.dark-layout .nsx-lottery-modal{background:#1e1e1e;border-color:#3a3a3a;color:#e0e0e0}' +
                        '.dark-layout .nsx-lottery-panel-header,.dark-layout .nsx-lottery-toolbar,.dark-layout .nsx-lottery-item,.dark-layout .nsx-lottery-modal-header,.dark-layout .nsx-lottery-modal-actions{border-color:#3a3a3a;background:#1e1e1e}' +
                        '.dark-layout .nsx-lottery-toolbar button,.dark-layout .nsx-lottery-modal-actions button,.dark-layout .nsx-lottery-form-row input:not([type=checkbox]),.dark-layout .nsx-lottery-form-row select{background:#292929;border-color:#555;color:#e0e0e0}' +
                        '@media(max-width:600px){#nsx-lottery-panel{right:3vw;top:52px;height:calc(100vh - 64px)}.nsx-lottery-form-row{grid-template-columns:1fr;gap:4px}.nsx-lottery-post-action{min-height:30px!important;padding:4px 8px!important}.nsx-lottery-state-tag{max-width:42vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}'
                    );
                }

                function startTimer() {
                    clearInterval(timer);
                    const seconds = Math.max(10, Number(ctx.store.get("lottery_reminder.check_seconds", 30)) || 30);
                    timer = setInterval(() => {
                        checkReminders();
                        updateCountdowns();
                    }, seconds * 1000);
                }

                function registerMenus() {
                    menuIds = [
                        GM_registerMenuCommand("🎁 抽奖提醒", openPanel),
                        GM_registerMenuCommand("🔔 抽奖通知设置", openLotterySettings)
                    ].filter(Boolean);
                }

                function activate() {
                    if (active) return;
                    active = true;
                    addStyles();
                    createPanel();
                    if (!createTrigger()) {
                        let attempts = 0;
                        triggerTimer = setInterval(() => {
                            attempts += 1;
                            if (createTrigger() || attempts >= 20) clearInterval(triggerTimer);
                        }, 500);
                    }
                    registerMenus();
                    pruneUncommentedParticipation();
                    refreshStoredLotteryDetails();
                    markParticipated();
                    startParticipationMonitor();
                    checkReminders();
                    processCurrentLuckyPage();
                    startTimer();
                }

                function deactivate() {
                    active = false;
                    clearInterval(timer);
                    clearInterval(triggerTimer);
                    timer = null;
                    triggerTimer = null;
                    menuIds.forEach(id => {
                        try { GM_unregisterMenuCommand(id); } catch { }
                    });
                    menuIds = [];
                    stopParticipationMonitor();
                    lotteryListValidationCache.clear();
                    lotteryListValidationRequests.clear();
                    lotteryListValidationQueue.length = 0;
                    document.getElementById(MODAL_ID)?.remove();
                    document.querySelectorAll(".nsx-lottery-participated,.nsx-lottery-state-tag,.nsx-lottery-post-action").forEach(element => element.remove());
                    trigger?.remove();
                    panel?.remove();
                    trigger = null;
                    panel = null;
                }

                window.__nsxPanelCtrl ||= {};
                window.__nsxPanelCtrl.lottery = { close: closePanel, isOpen: () => !!panel?.classList.contains("show") };
                window.__nsxRuntime ||= {};
                window.__nsxRuntime.reapplyLotteryReminder = () => {
                    const shouldEnable = ctx.store.get("lottery_reminder.enabled", true);
                    deactivate();
                    if (shouldEnable) activate();
                };
                ctx.watch('a[href*="/post-"]', () => {
                    if (!active) return;
                    markParticipated();
                    startParticipationMonitor();
                });
                if (ctx.store.get("lottery_reminder.enabled", true)) activate();
            }
        };

        const nestedReplies = {
            id: "nestedReplies",
            order: 186,
            cfg: {
                nested_replies: {
                    enabled: true,
                    max_depth: 4,
                    collapse_depth: 3
                }
            },
            meta: {
                nested_replies: {
                    label: "楼中楼",
                    group: "📖 帖子阅读",
                    cols: 2,
                    fields: {
                        max_depth: { type: "NUMBER", label: "最大嵌套层级" },
                        collapse_depth: { type: "NUMBER", label: "默认折叠层级" }
                    }
                }
            },
            match: ctx => ctx.isPost,
            init(ctx) {
                const STYLE_ID = "nsx-nested-replies-style";
                let scheduled = null;
                let applying = false;

                const topicId = () => location.pathname.match(/^\/post-(\d+)(?:-\d+)?\/?$/)?.[1] || null;
                const rootList = () => ctx.$(".comment-container .comments") || ctx.$("ul.comments");
                const floorOf = comment => {
                    const value = comment?.id || "";
                    return /^\d+$/.test(value) ? Number(value) : null;
                };
                const comments = () => {
                    const root = rootList();
                    if (!root) return [];
                    return [...root.querySelectorAll(".content-item[id]")].filter(comment => floorOf(comment) !== null);
                };
                const referencedFloor = (link, currentTopic) => {
                    try {
                        const url = new URL(link.getAttribute("href") || "", location.href);
                        const match = url.pathname.match(/^\/post-(\d+)(?:-\d+)?\/?$/);
                        const floor = Number(url.hash.match(/^#(\d+)$/)?.[1]);
                        if (url.origin !== location.origin || match?.[1] !== currentTopic || !Number.isInteger(floor)) return null;
                        return floor;
                    } catch {
                        return null;
                    }
                };
                const parentFloorOf = (comment, currentTopic) => {
                    const self = floorOf(comment);
                    const content = [...comment.children].find(element => element.classList?.contains("post-content"));
                    if (!content || self === null) return null;
                    const floors = [...content.querySelectorAll("a[href]")]
                        .map(link => referencedFloor(link, currentTopic))
                        .filter(floor => Number.isInteger(floor) && floor >= 1 && floor < self);
                    return floors.length ? Math.max(...floors) : null;
                };
                const depthOf = comment => {
                    let depth = 0;
                    let cursor = comment?.parentElement;
                    while (cursor) {
                        if (cursor.classList?.contains("nsx-nested-children")) depth += 1;
                        cursor = cursor.parentElement;
                    }
                    return depth;
                };
                const updateToggle = children => {
                    const toggle = children?.previousElementSibling;
                    if (!toggle?.classList.contains("nsx-nested-toggle")) return;
                    const count = children.querySelectorAll(".content-item[id]").length;
                    const collapsed = children.dataset.collapsed === "true";
                    toggle.textContent = (collapsed ? "展开" : "收起") + "楼中楼 (" + count + ")";
                    toggle.setAttribute("aria-expanded", String(!collapsed));
                };
                const getChildren = parent => {
                    let children = [...parent.children].find(element => element.classList?.contains("nsx-nested-children"));
                    if (children) return children;
                    const nextDepth = depthOf(parent) + 1;
                    children = document.createElement("ol");
                    children.className = "nsx-nested-children";
                    children.dataset.depth = String(nextDepth);
                    children.dataset.collapsed = String(nextDepth >= Math.max(1, Number(ctx.store.get("nested_replies.collapse_depth", 3)) || 3));
                    const toggle = document.createElement("button");
                    toggle.type = "button";
                    toggle.className = "nsx-nested-toggle";
                    toggle.addEventListener("click", () => {
                        children.dataset.collapsed = String(children.dataset.collapsed !== "true");
                        updateToggle(children);
                    });
                    parent.append(toggle, children);
                    updateToggle(children);
                    return children;
                };
                const moveUnderParent = (comment, parent, parentFloor) => {
                    if (!parent || parent === comment || comment.contains(parent)) return false;
                    const maxDepth = Math.max(1, Math.min(8, Number(ctx.store.get("nested_replies.max_depth", 4)) || 4));
                    if (depthOf(parent) >= maxDepth) return false;
                    const children = getChildren(parent);
                    if (comment.parentElement === children) return false;
                    comment.classList.add("nsx-nested-item");
                    comment.dataset.nsxNestedParent = String(parentFloor);
                    children.appendChild(comment);
                    parent.classList.add("nsx-nested-parent");
                    updateToggle(children);
                    return true;
                };

                function restoreFlat() {
                    const root = rootList();
                    if (!root) return;
                    const all = comments().sort((left, right) => floorOf(left) - floorOf(right));
                    all.forEach(comment => root.appendChild(comment));
                    root.querySelectorAll(".nsx-nested-toggle,.nsx-nested-children").forEach(element => element.remove());
                    all.forEach(comment => {
                        comment.classList.remove("nsx-nested-item", "nsx-nested-parent");
                        delete comment.dataset.nsxNestedParent;
                    });
                    document.documentElement.classList.remove("nsx-nested-ready");
                }

                function applyNesting() {
                    if (applying || !ctx.store.get("nested_replies.enabled", true)) return;
                    const currentTopic = topicId();
                    if (!currentTopic || !rootList()) return;
                    applying = true;
                    try {
                        const all = comments().sort((left, right) => floorOf(left) - floorOf(right));
                        const byFloor = new Map(all.map(comment => [floorOf(comment), comment]));
                        all.forEach(comment => {
                            const parentFloor = parentFloorOf(comment, currentTopic);
                            if (parentFloor) moveUnderParent(comment, byFloor.get(parentFloor), parentFloor);
                        });
                        rootList().querySelectorAll(".nsx-nested-children").forEach(updateToggle);
                        document.documentElement.classList.toggle("nsx-nested-ready", !!rootList().querySelector(".nsx-nested-item"));
                    } finally {
                        applying = false;
                    }
                }

                const schedule = () => {
                    clearTimeout(scheduled);
                    scheduled = setTimeout(applyNesting, 120);
                };
                const addStyles = () => ctx.addStyle(STYLE_ID,
                    '.nsx-nested-toggle{display:inline-flex;align-items:center;margin:7px 0 0 54px;padding:2px 0;border:0;background:transparent;color:#667085;font-size:11px;font-weight:600;cursor:pointer}' +
                    '.nsx-nested-toggle::before{content:"−";display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-right:5px;border:1px solid rgba(102,112,133,.28);border-radius:50%;line-height:1}' +
                    '.nsx-nested-toggle[aria-expanded="false"]::before{content:"+"}' +
                    '.nsx-nested-children{position:relative;margin:7px 0 0 42px;padding:0 0 0 14px;list-style:none;border-left:2px solid rgba(102,112,133,.14)}' +
                    '.nsx-nested-children[data-collapsed="true"]{display:none}' +
                    '.nsx-nested-children>.content-item{position:relative;width:auto!important;margin:0!important;padding:9px 0!important;border:0!important;border-bottom:1px solid rgba(102,112,133,.12)!important;background:transparent!important}' +
                    '.nsx-nested-children>.content-item:last-child{border-bottom:0!important}' +
                    '.nsx-nested-children>.content-item::before{content:"";position:absolute;left:-16px;top:24px;width:13px;height:12px;border-bottom:2px solid rgba(102,112,133,.14)}' +
                    '.nsx-nested-children>.content-item>.nsk-content-meta-info{display:flex!important;align-items:center;min-height:34px;margin-bottom:4px!important}' +
                    '.nsx-nested-children>.content-item .avatar-wrapper{display:block!important;width:34px!important;min-width:34px!important;margin-right:8px!important}' +
                    '.nsx-nested-children>.content-item .avatar-normal{width:32px!important;height:32px!important;border-radius:50%!important}' +
                    '.nsx-nested-children>.content-item>.post-content{margin-left:42px!important;padding:0!important;overflow-wrap:anywhere}' +
                    '.nsx-nested-children>.content-item>.comment-menu{display:flex!important;margin:6px 0 0 42px!important;opacity:.62;flex-wrap:wrap}' +
                    '.nsx-nested-children>.content-item>.signature{margin-left:42px!important}' +
                    '.nsx-nested-children .nsx-nested-children{margin-left:10px;padding-left:10px}' +
                    '.nsx-nested-parent>.floor-link-wrapper .floor-link::after{content:" · 楼中楼";font-weight:400;opacity:.65}' +
                    '.dark-layout .nsx-nested-toggle{color:#aab4c3}' +
                    '.dark-layout .nsx-nested-children{border-left-color:rgba(205,214,226,.16)}' +
                    '.dark-layout .nsx-nested-children>.content-item{border-bottom-color:rgba(205,214,226,.12)!important}' +
                    '.dark-layout .nsx-nested-children>.content-item::before{border-bottom-color:rgba(205,214,226,.16)}' +
                    '@media(max-width:720px){.nsx-nested-toggle{margin-left:8px;min-height:32px}.nsx-nested-children{margin-left:6px;padding-left:9px}.nsx-nested-children>.content-item::before{left:-11px;width:8px}.nsx-nested-children>.content-item>.post-content,.nsx-nested-children>.content-item>.comment-menu,.nsx-nested-children>.content-item>.signature{margin-left:38px!important}.nsx-nested-children .nsx-nested-children{margin-left:4px;padding-left:7px}.nsx-nested-children>.content-item .comment-menu .menu-item{min-height:36px;display:flex;align-items:center}}'
                );

                window.__nsxRuntime ||= {};
                window.__nsxRuntime.reapplyNestedReplies = () => {
                    restoreFlat();
                    if (ctx.store.get("nested_replies.enabled", true)) {
                        addStyles();
                        schedule();
                    }
                };
                ctx.watch(".comments .content-item[id]", schedule);
                addStyles();
                schedule();
            }
        };

        const FRONT_UI_THEME_CSS = `
:root{
  --nsx-ui-background:#fff;--nsx-ui-foreground:#09090b;--nsx-ui-muted:#f4f4f5;--nsx-ui-muted-foreground:#71717a;
  --nsx-ui-border:#e4e4e7;--nsx-ui-input:#e4e4e7;--nsx-ui-primary:#18181b;--nsx-ui-primary-foreground:#fafafa;
  --nsx-ui-accent:#f4f4f5;--nsx-ui-accent-foreground:#18181b;--nsx-ui-destructive:#dc2626;--nsx-ui-ring:#a1a1aa;
  --nsx-ui-success:#15803d;--nsx-ui-success-soft:#f0fdf4;--nsx-ui-warning:#a16207;--nsx-ui-warning-soft:#fefce8;
  --nsx-ui-radius:6px;--nsx-ui-shadow:0 16px 40px rgba(9,9,11,.14)
}
body.dark-layout{
  --nsx-ui-background:#09090b;--nsx-ui-foreground:#fafafa;--nsx-ui-muted:#18181b;--nsx-ui-muted-foreground:#a1a1aa;
  --nsx-ui-border:#27272a;--nsx-ui-input:#27272a;--nsx-ui-primary:#fafafa;--nsx-ui-primary-foreground:#18181b;
  --nsx-ui-accent:#27272a;--nsx-ui-accent-foreground:#fafafa;--nsx-ui-destructive:#ef4444;--nsx-ui-ring:#52525b;
  --nsx-ui-success:#86efac;--nsx-ui-success-soft:#102418;--nsx-ui-warning:#fde047;--nsx-ui-warning-soft:#29240e;
  --nsx-ui-shadow:0 18px 46px rgba(0,0,0,.5)
}
.nsx-forum-status-tag{
  --nsx-status-color:var(--nsx-status-color-light,#71717a);display:inline-flex!important;align-items:center;justify-content:center;min-height:22px;
  margin:0;padding:1px 7px;border:1px solid color-mix(in srgb,var(--nsx-status-color) 48%,var(--nsx-ui-border))!important;
  border-radius:4px!important;background:color-mix(in srgb,var(--nsx-status-color) 9%,var(--nsx-ui-background))!important;
  color:var(--nsx-status-color)!important;font-size:11px!important;font-weight:600!important;line-height:18px!important;
  letter-spacing:0;text-decoration:none!important;white-space:nowrap;vertical-align:middle;box-shadow:none!important;text-shadow:none!important
}
body.dark-layout .nsx-forum-status-tag{--nsx-status-color:var(--nsx-status-color-dark,var(--nsx-status-color-light,#a1a1aa))}
.nsx-forum-status-tag:hover{border-color:var(--nsx-status-color)!important;background:color-mix(in srgb,var(--nsx-status-color) 14%,var(--nsx-ui-background))!important;color:var(--nsx-status-color)!important;text-decoration:none!important}
#nsx-filter-panel,#nsx-history-panel,#nsx-rel-panel,#nsx-lottery-panel{
  border:1px solid var(--nsx-ui-border)!important;border-radius:var(--nsx-ui-radius)!important;
  background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;box-shadow:var(--nsx-ui-shadow)!important
}
.nsx-rel-header,.nsx-history-header,.nsx-lottery-panel-header{
  min-height:48px!important;padding:0 12px!important;border-bottom:1px solid var(--nsx-ui-border)!important;background:var(--nsx-ui-background)!important
}
.nsx-rel-title,.nsx-history-title,.nsx-lottery-panel-header strong{color:var(--nsx-ui-foreground)!important;font-size:14px!important;font-weight:650!important}
.nsx-rel-action,.nsx-history-action,.nsx-history-close,.nsx-history-restore,.nsx-rel-close,.nsx-lottery-icon-btn{
  min-height:28px;border:0!important;border-radius:4px!important;background:transparent!important;color:var(--nsx-ui-muted-foreground)!important;font-size:12px!important
}
.nsx-rel-action:hover,.nsx-history-action:hover,.nsx-history-close:hover,.nsx-history-restore:hover,.nsx-rel-close:hover,.nsx-lottery-icon-btn:hover{
  background:var(--nsx-ui-accent)!important;color:var(--nsx-ui-accent-foreground)!important
}
.nsx-rel-close:hover,.nsx-history-close:hover{color:var(--nsx-ui-destructive)!important}
.nsx-rel-search,.nsx-history-search{
  min-height:36px;margin:10px 12px 8px!important;padding:0 9px!important;border:1px solid var(--nsx-ui-input)!important;
  border-radius:var(--nsx-ui-radius)!important;background:var(--nsx-ui-background)!important
}
.nsx-rel-search:focus-within,.nsx-history-search:focus-within{border-color:var(--nsx-ui-ring)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--nsx-ui-ring) 24%,transparent)}
.nsx-rel-search input,.nsx-history-search input{
  width:100%;height:34px;border:0!important;outline:0!important;background:transparent!important;color:var(--nsx-ui-foreground)!important;font-size:13px!important
}
.nsx-rel-search input::placeholder,.nsx-history-search input::placeholder{color:var(--nsx-ui-muted-foreground)!important}
.nsx-rel-tabs,.nsx-history-tabs{
  display:flex!important;gap:2px!important;margin:0 12px 8px!important;padding:3px!important;border:0!important;border-radius:var(--nsx-ui-radius)!important;background:var(--nsx-ui-muted)!important
}
.nsx-rel-tab,.nsx-history-tab{
  flex:1;min-height:28px;padding:0 8px!important;border:0!important;border-radius:4px!important;background:transparent!important;
  color:var(--nsx-ui-muted-foreground)!important;font-size:12px!important;font-weight:500!important
}
.nsx-rel-tab.is-active,.nsx-history-tab.is-active{
  background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;box-shadow:0 1px 2px rgba(0,0,0,.08)!important
}
.nsx-rel-list,.nsx-history-list{padding:0 8px 10px!important}
.nsx-rel-item,.nsx-history-item{min-height:48px;padding:7px 6px!important;border-bottom:1px solid var(--nsx-ui-border);border-radius:0!important;color:var(--nsx-ui-foreground)!important}
.nsx-rel-item:last-child,.nsx-history-item:last-child{border-bottom:0}
.nsx-rel-item:hover,.nsx-history-item:hover{background:var(--nsx-ui-muted)!important}
.nsx-rel-item-title,.nsx-history-item-title{color:var(--nsx-ui-foreground)!important;font-size:13px!important;font-weight:600!important}
.nsx-rel-remark,.nsx-rel-time,.nsx-history-time,.nsx-history-group-title{color:var(--nsx-ui-muted-foreground)!important}
.nsx-rel-empty,.nsx-history-empty,.nsx-lottery-empty,.nsx-quick-reply-empty{color:var(--nsx-ui-muted-foreground)!important}
.nsx-rel-icon,.nsx-history-icon{border:1px solid var(--nsx-ui-border);background:var(--nsx-ui-muted)!important;color:var(--nsx-ui-muted-foreground)!important}
.nsx-quick-reply-menu{
  padding:8px!important;border:1px solid var(--nsx-ui-border)!important;border-radius:var(--nsx-ui-radius)!important;
  background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;box-shadow:var(--nsx-ui-shadow)!important
}
.nsx-quick-reply-btn:hover{color:var(--nsx-ui-foreground)!important}
.nsx-quick-reply-tabs-wrap,.nsx-quick-reply-foot{border-color:var(--nsx-ui-border)!important}
.nsx-quick-reply-tab,.nsx-quick-reply-tab-add-fixed,.nsx-quick-reply-op,.nsx-quick-reply-add{
  min-height:28px;border:1px solid var(--nsx-ui-border)!important;border-radius:4px!important;background:var(--nsx-ui-background)!important;
  color:var(--nsx-ui-foreground)!important;font-size:12px!important;box-shadow:none!important
}
.nsx-quick-reply-tab.active,.nsx-quick-reply-add{
  border-color:var(--nsx-ui-primary)!important;background:var(--nsx-ui-primary)!important;color:var(--nsx-ui-primary-foreground)!important
}
.nsx-quick-reply-tab-add-fixed{border-style:dashed!important;color:var(--nsx-ui-muted-foreground)!important}
.nsx-quick-reply-tab:hover,.nsx-quick-reply-tab-add-fixed:hover,.nsx-quick-reply-op:hover{background:var(--nsx-ui-accent)!important;color:var(--nsx-ui-accent-foreground)!important}
.nsx-quick-reply-item{border-radius:4px!important;color:var(--nsx-ui-foreground)!important}
.nsx-quick-reply-item:hover{background:var(--nsx-ui-accent)!important}
.nsx-quick-reply-item-del,.nsx-quick-reply-tab-del,.nsx-quick-reply-autosend-wrap{color:var(--nsx-ui-muted-foreground)!important}
.nsx-quick-reply-item-del:hover,.nsx-quick-reply-tab-del:hover{background:color-mix(in srgb,var(--nsx-ui-destructive) 10%,transparent)!important;color:var(--nsx-ui-destructive)!important}
.nsx-quick-reply-autosend-check{accent-color:var(--nsx-ui-primary)!important}
.nsx-lottery-toolbar{padding:10px 12px!important;border-bottom:1px solid var(--nsx-ui-border)!important;background:var(--nsx-ui-background)!important}
.nsx-lottery-toolbar button,.nsx-lottery-modal-actions button{
  min-height:32px;padding:0 10px!important;border:1px solid var(--nsx-ui-border)!important;border-radius:4px!important;
  background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;box-shadow:none!important
}
.nsx-lottery-toolbar button:hover,.nsx-lottery-modal-actions button:hover{background:var(--nsx-ui-accent)!important;color:var(--nsx-ui-accent-foreground)!important}
.nsx-lottery-toolbar button:first-child,.nsx-lottery-modal-actions .is-primary{
  border-color:var(--nsx-ui-primary)!important;background:var(--nsx-ui-primary)!important;color:var(--nsx-ui-primary-foreground)!important
}
.nsx-lottery-list{padding:0 12px 10px!important}
.nsx-lottery-item{padding:12px 0!important;border-bottom:1px solid var(--nsx-ui-border)!important}
.nsx-lottery-link a,.nsx-lottery-result-status{color:var(--nsx-ui-foreground)!important}
.nsx-lottery-time,.nsx-lottery-winners,.nsx-lottery-delivery-status{color:var(--nsx-ui-muted-foreground)!important}
.nsx-lottery-time b,.nsx-lottery-delivery-status.is-error{color:var(--nsx-ui-destructive)!important}
.nsx-lottery-requirement{color:var(--nsx-ui-warning)!important}
.nsx-lottery-result-status.is-won,.nsx-lottery-delivery-status.is-success{color:var(--nsx-ui-success)!important}
.nsx-lottery-participated{background:var(--nsx-ui-success-soft)!important;color:var(--nsx-ui-success)!important}
.nsx-lottery-state-tag{margin-left:7px!important}
.nsx-relation-btn.nsx-lottery-post-action{
  border-color:color-mix(in srgb,var(--nsx-status-color) 48%,var(--nsx-ui-border))!important;border-radius:4px!important;
  background:color-mix(in srgb,var(--nsx-status-color) 9%,var(--nsx-ui-background))!important;color:var(--nsx-status-color)!important
}
.nsx-relation-btn.nsx-lottery-post-action:hover{border-color:var(--nsx-status-color)!important;background:color-mix(in srgb,var(--nsx-status-color) 14%,var(--nsx-ui-background))!important;color:var(--nsx-status-color)!important}
.nsx-lottery-modal-mask,.nsx-lottery-notify-mask{background:rgba(0,0,0,.48)!important;backdrop-filter:blur(2px)}
.nsx-lottery-modal{
  border:1px solid var(--nsx-ui-border)!important;border-radius:8px!important;background:var(--nsx-ui-background)!important;
  color:var(--nsx-ui-foreground)!important;box-shadow:var(--nsx-ui-shadow)!important
}
.nsx-lottery-modal-header,.nsx-lottery-modal-actions{border-color:var(--nsx-ui-border)!important;background:var(--nsx-ui-background)!important}
.nsx-lottery-modal fieldset{border-color:var(--nsx-ui-border)!important}.nsx-lottery-modal legend{color:var(--nsx-ui-foreground)!important}
.nsx-lottery-form-row input:not([type=checkbox]),.nsx-lottery-form-row select{
  min-height:36px;border:1px solid var(--nsx-ui-input)!important;border-radius:var(--nsx-ui-radius)!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;outline:0
}
.nsx-lottery-form-row input:focus,.nsx-lottery-form-row select:focus{border-color:var(--nsx-ui-ring)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--nsx-ui-ring) 24%,transparent)}
.nsx-lottery-participation-body code{border-color:var(--nsx-ui-border)!important;border-radius:var(--nsx-ui-radius)!important;background:var(--nsx-ui-muted)!important;color:var(--nsx-ui-foreground)!important}
.layui-layer.nsx-mode-layer,.layui-layer:has(.nsx-kw-form),.layui-layer:has(.nsx-qr-form),.layui-layer:has(.nsx-block-form){
  overflow:hidden;border:1px solid var(--nsx-ui-border)!important;border-radius:8px!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;box-shadow:var(--nsx-ui-shadow)!important
}
.layui-layer.nsx-mode-layer .layui-layer-title,.layui-layer:has(.nsx-kw-form) .layui-layer-title,.layui-layer:has(.nsx-qr-form) .layui-layer-title,.layui-layer:has(.nsx-block-form) .layui-layer-title{
  height:50px;line-height:50px;border-bottom:1px solid var(--nsx-ui-border)!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;font-size:14px;font-weight:650
}
.layui-layer.nsx-mode-layer .layui-layer-content,.layui-layer:has(.nsx-kw-form) .layui-layer-content,.layui-layer:has(.nsx-qr-form) .layui-layer-content,.layui-layer:has(.nsx-block-form) .layui-layer-content{background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important}
.nsx-kw-form,.nsx-qr-form,.nsx-block-form{background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important}
.nsx-kw-form .layui-form-label,.nsx-qr-form .layui-form-label,.nsx-block-form .layui-form-label{color:var(--nsx-ui-foreground)!important}
.nsx-kw-form .layui-input,.nsx-kw-form .layui-textarea,.nsx-qr-form .layui-input,.nsx-qr-form .layui-textarea,.nsx-block-form .layui-input,.nsx-block-form .layui-textarea,.nsx-mode-layer .layui-input,.nsx-mode-layer .layui-textarea{
  border:1px solid var(--nsx-ui-input)!important;border-radius:var(--nsx-ui-radius)!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;outline:0
}
.nsx-kw-form .layui-input:focus,.nsx-qr-form .layui-input:focus,.nsx-qr-form .layui-textarea:focus,.nsx-block-form .layui-input:focus,.nsx-mode-layer .layui-input:focus{border-color:var(--nsx-ui-ring)!important;box-shadow:0 0 0 2px color-mix(in srgb,var(--nsx-ui-ring) 24%,transparent)}
.nsx-kw-form .layui-form-select dl,.nsx-qr-form .layui-form-select dl,.nsx-block-form .layui-form-select dl,.nsx-mode-layer .layui-form-select dl{border-color:var(--nsx-ui-border)!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important}
.nsx-kw-form .layui-form-select dl dd:hover,.nsx-qr-form .layui-form-select dl dd:hover,.nsx-block-form .layui-form-select dl dd:hover,.nsx-mode-layer .layui-form-select dl dd:hover{background:var(--nsx-ui-accent)!important}
.layui-layer.nsx-mode-layer .layui-layer-btn,.layui-layer:has(.nsx-kw-form) .layui-layer-btn,.layui-layer:has(.nsx-qr-form) .layui-layer-btn,.layui-layer:has(.nsx-block-form) .layui-layer-btn{border-top:1px solid var(--nsx-ui-border)!important;background:var(--nsx-ui-muted)!important}
.layui-layer.nsx-mode-layer .layui-layer-btn a,.layui-layer:has(.nsx-kw-form) .layui-layer-btn a,.layui-layer:has(.nsx-qr-form) .layui-layer-btn a,.layui-layer:has(.nsx-block-form) .layui-layer-btn a{
  min-height:32px;line-height:30px;border:1px solid var(--nsx-ui-border)!important;border-radius:4px!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important
}
.layui-layer.nsx-mode-layer .layui-layer-btn .layui-layer-btn0,.layui-layer:has(.nsx-kw-form) .layui-layer-btn .layui-layer-btn0,.layui-layer:has(.nsx-qr-form) .layui-layer-btn .layui-layer-btn0,.layui-layer:has(.nsx-block-form) .layui-layer-btn .layui-layer-btn0{border-color:var(--nsx-ui-primary)!important;background:var(--nsx-ui-primary)!important;color:var(--nsx-ui-primary-foreground)!important}
.callout-inserter-dropdown{
  overflow:hidden;border:1px solid var(--nsx-ui-border)!important;border-radius:var(--nsx-ui-radius)!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important;box-shadow:var(--nsx-ui-shadow)!important
}
.callout-inserter-item{min-height:36px;color:var(--nsx-ui-foreground)!important}.callout-inserter-item:hover{background:var(--nsx-ui-accent)!important}
#nodeimage-status{color:var(--nsx-ui-muted-foreground)!important;font-size:12px!important}
#nodeimage-status.success{color:var(--nsx-ui-success)!important}#nodeimage-status.error{color:var(--nsx-ui-destructive)!important}#nodeimage-status.warning{color:var(--nsx-ui-warning)!important}
.nodeimage-login-btn{
  min-height:28px;padding:3px 8px!important;border:1px solid var(--nsx-ui-border)!important;border-radius:4px!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-foreground)!important
}
.nodeimage-login-btn:hover{background:var(--nsx-ui-accent)!important}
.nsx-relation-btn,.nsx-inline-communication .nsx-communication-btn{
  min-height:24px;border:1px solid var(--nsx-ui-border)!important;border-radius:4px!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-muted-foreground)!important;box-shadow:none!important;transform:none!important
}
.nsx-relation-btn:hover,.nsx-inline-communication .nsx-communication-btn:hover{background:var(--nsx-ui-accent)!important;color:var(--nsx-ui-accent-foreground)!important;transform:none!important}
.nsx-btn-friend{border-color:color-mix(in srgb,var(--nsx-ui-success) 34%,var(--nsx-ui-border))!important;color:var(--nsx-ui-success)!important}
.nsx-btn-block{border-color:color-mix(in srgb,var(--nsx-ui-destructive) 34%,var(--nsx-ui-border))!important;color:var(--nsx-ui-destructive)!important}
.nsx-inline-communication .nsx-btn-message,.nsx-inline-communication .nsx-btn-telegram{color:var(--nsx-ui-muted-foreground)!important}
.nsx-fold-notice{
  min-height:44px;padding:9px 12px!important;border:1px solid color-mix(in srgb,var(--nsx-ui-destructive) 24%,var(--nsx-ui-border));border-radius:var(--nsx-ui-radius)!important;background:color-mix(in srgb,var(--nsx-ui-destructive) 5%,var(--nsx-ui-background))!important;color:var(--nsx-ui-foreground)!important;opacity:1!important
}
.nsx-unfold-btn{padding:3px 6px;border-radius:4px;color:var(--nsx-ui-destructive)!important;text-decoration:none!important}.nsx-unfold-btn:hover{background:color-mix(in srgb,var(--nsx-ui-destructive) 10%,transparent)!important}
.nsx-friend-badge,.nsx-blacklist-badge,.nsx-user-data-badge{border-radius:4px!important;box-shadow:none!important;text-shadow:none!important}
.nsx-nested-toggle{min-height:28px;padding:0 7px!important;border:1px solid var(--nsx-ui-border)!important;border-radius:4px!important;background:var(--nsx-ui-background)!important;color:var(--nsx-ui-muted-foreground)!important}
.nsx-nested-toggle:hover{background:var(--nsx-ui-accent)!important;color:var(--nsx-ui-accent-foreground)!important}
.nsx-nested-toggle::before{border-color:var(--nsx-ui-border)!important;border-radius:3px!important}
.nsx-nested-children{border-left-color:var(--nsx-ui-border)!important}.nsx-nested-children>.content-item{border-bottom-color:var(--nsx-ui-border)!important}.nsx-nested-children>.content-item::before{border-bottom-color:var(--nsx-ui-border)!important}
#setting-layer-direction-r{--nsx-cfg-surface:var(--nsx-ui-background);--nsx-cfg-soft:var(--nsx-ui-muted);--nsx-cfg-ink:var(--nsx-ui-foreground);--nsx-cfg-muted:var(--nsx-ui-muted-foreground);--nsx-cfg-line:var(--nsx-ui-border);--nsx-cfg-accent:var(--nsx-ui-primary)}
@media(max-width:600px){
  #nsx-filter-panel,#nsx-history-panel,#nsx-rel-panel,#nsx-lottery-panel{border-radius:var(--nsx-ui-radius)!important}
  .nsx-rel-header,.nsx-history-header,.nsx-lottery-panel-header{min-height:44px!important}
  .nsx-quick-reply-menu{max-width:calc(100vw - 16px)!important}
  .nsx-relation-btn,.nsx-inline-communication .nsx-communication-btn{min-height:36px!important}
  .nsx-forum-status-tag{min-height:24px;padding:2px 7px}
}
`;

        const frontUiTheme = {
            id: "frontUiTheme",
            order: 990,
            init(ctx) {
                ctx.addStyle("nsx-front-ui-theme", FRONT_UI_THEME_CSS);
            }
        };

        define(userRelation);
        define(lotteryReminder);
        define(nestedReplies);
        define(frontUiTheme);
        // 🚫 过滤设置 (放在最后)
        define(blockPosts);

        boot(ctx);
        document.addEventListener("NSPRO_GM_SETTINGS_CHANGED", event => {
            try {
                const nextSettings = JSON.parse(event.detail || "{}").settings || {};
                const previousSettings = structuredClone(store.init());
                const changedKeys = [];
                const visit = (left, right, prefix = "") => {
                    const keys = new Set([...Object.keys(left || {}), ...Object.keys(right || {})]);
                    keys.forEach(key => {
                        const path = prefix ? `${prefix}.${key}` : key;
                        const oldValue = left?.[key];
                        const newValue = right?.[key];
                        if (isObj(oldValue) && isObj(newValue)) visit(oldValue, newValue, path);
                        else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) changedKeys.push(path);
                    });
                };
                visit(previousSettings, nextSettings);
                store.replace(nextSettings);
                applyRuntimeSettings(ctx, changedKeys);
            } catch (error) {
                env.error("settingsSync", error);
            }
        });
    }

    const startExtensionEdition = () => Promise.resolve(globalThis.__NSPRO_READY)
        .catch(() => undefined)
        .then(start);
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startExtensionEdition, { once: true });
    } else {
        startExtensionEdition();
    }

    /*
     * ==================== 积分惩戒详细中文公式（说明注释） ====================
     * 该逻辑用于 inlineUserInfo 的“信誉分（trustScore）”计算与惩戒，不参与运行，仅供维护阅读。
     *
     * 1) 基础变量
     * - joinDays: 注册天数
     * - coins: 当前鸡腿（积分）
     * - nPost: 发帖数
     * - nComment: 评论数
     * - totalAct = nPost + nComment
     * - dailyAct = totalAct / max(joinDays, 1)
     * - coinPerDay = coins / max(joinDays, 1)
     * - isLegend: 特殊标签用户
     * - MATURE_DAYS = 30（成熟基线按注册天数定义）
     *
     * 2) 四项基础分
     * - 资历分(25分):
     *   alpha = min(joinDays / MATURE_DAYS, 1)
     *   baseSeniority = min(25, joinDays / 25)
     *   lowSeniority = min(5, joinDays / 100)
     *   seniorityScore = baseSeniority * alpha + lowSeniority * (1 - alpha)
     *
     * - 活跃分(25分):
     *   actVal = max(min(25, dailyAct * 15), min(25, totalAct / 15))
     *   spamPenalty = (dailyAct > 24) ? max(0.5, 1 - (dailyAct - 24) / 40) : 1
     *   actScore = actVal * spamPenalty
     *   过分极端高频会被打折。
     * 
     * - 财富分(20分):
     *   wealthScore = max(min(20, coinPerDay * 5), min(20, coins / 80))
     *
     * - 质量分(30分):
     *   estimatedBaseCoins = 90 + min(nComment, joinDays * 20) * 1 + min(nPost, joinDays * 4) * 5 + joinDays * 5
     *   extraCoins = max(0, coins - estimatedBaseCoins)
     *   extraPerAct = extraCoins / max(totalAct, 1)
     *   qualityConfidence = min(totalAct / 10, 1)
     *   rawQualityScore = extraPerAct * 18
     *   qualityScore = min(30, rawQualityScore) * qualityConfidence
     *
     * 3) 初始总分
     * - trustScore = seniorityScore + actScore + wealthScore + qualityScore
     * - 若 isLegend 为真，则 trustScore += 15
     *
     * 4) 惩戒与上限规则
     * - 僵尸号重罚:
     *   条件: joinDays > 100 且 coinPerDay < 5/3
     *   处理: trustScore = trustScore * 0.2
     *
     * - 新号封顶:
     *   条件: joinDays < MATURE_DAYS
     *   处理: trustScore = min(trustScore, 70)
     *
     * - 灌水惩戒（共三档）:
     *   先满足触发门槛:
     *   tavgReplyPerDay = totalAct / max(joinDays, 1)
     *   lowQuality = extraPerAct < 1.05
     *   spamLikely = (tavgReplyPerDay >= 40) 且 lowQuality
     *
     *   当 spamLikely 为真时按 extraPerAct 分三档惩戒:
     *   A. 最重档: extraPerAct < 0.35      -> trustScore *= 0.65
     *   B. 中档:   0.35 <= extraPerAct < 0.7 -> trustScore *= 0.75
     *   C. 轻档:   extraPerAct >= 0.7        -> trustScore *= 0.85
     *
     * 5) 最终分
     * - trustScore = floor(trustScore)
     * - trustScore = max(0, min(100, trustScore))
     * ========================================================================
     */
})();
