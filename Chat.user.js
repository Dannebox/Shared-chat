// ==UserScript==
// @name         FLUX Shared Chat
// @namespace    almanac.shared.chat
// @updateURL   https://raw.githubusercontent.com/Dannebox/Shared-chat/main/Chat.user.js
// @downloadURL https://raw.githubusercontent.com/Dannebox/Shared-chat/main/Chat.user.js
// @version      0.1.48
// @description  Secure shared chat for approved Torn factions using CSP-safe HTTP polling; does not scrape Torn pages.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// @connect      chat.shiroshura.com
// @connect      raw.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // CHANGE THIS to your HTTPS hostname. Do not put any secrets in this file.
    const API_BASE = 'https://chat.shiroshura.com';
    const TOKEN_KEY = 'alliance_chat_session_v1';
    const REFRESH_TOKEN_KEY = 'alliance_chat_refresh_v1';
    const UI_STATE_KEY = 'alliance_chat_ui_state_v1';
    const THEME_KEY = 'alliance_chat_theme_v1';
    const PANEL_ID = 'almanac-alliance-chat';
    const LAUNCHER_ID = 'almanac-alliance-chat-launcher';
    const POLL_OPEN_MS = 3000;
    const POLL_CLOSED_MS = 10000;
    const MOBILE_MEDIA = '(max-width: 700px)';
    const UPDATE_URL = 'https://raw.githubusercontent.com/Dannebox/Shared-chat/main/Chat.user.js';
    const UPDATE_CHECK_KEY = 'alliance_chat_update_check_v1';
    const UPDATE_AVAILABLE_KEY = 'alliance_chat_update_available_v1';
    const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

    const THEME_ASSETS = {
        almanac: {
            header: 'https://chat.shiroshura.com/assets/almanac/header.webp',
            background: 'https://chat.shiroshura.com/assets/almanac/background.webp'
        },

        flux: {
            header: 'https://chat.shiroshura.com/assets/flux/header.webp',
            background: 'https://chat.shiroshura.com/assets/flux/background.webp'
        }
    };

    const THEMES = new Set(['default', 'almanac', 'flux']);

    function preloadThemeAssets() {
        for (const theme of Object.values(THEME_ASSETS)) {
            for (const url of [theme.header, theme.background]) {
                if (!url) continue;
                const img = new Image();
                img.decoding = 'async';
                img.src = url;
            }
        }
    }

    const state = {
        token: GM_getValue(TOKEN_KEY, ''),
        refreshToken: GM_getValue(REFRESH_TOKEN_KEY, ''),
        refreshInFlight: null,
        roomId: null,
        roomName: 'Flux Family',
        keyVersion: null,
        cryptoKey: null,
        me: null,
        maxMessageChars: 1000,
        unread: 0,
        pollTimer: null,
        pollInFlight: false,
        pollFailures: 0,
        lastCursor: 0,
        seenMessageIds: new Set(),
        factionNames: {},
        theme: THEMES.has(GM_getValue(THEME_KEY, 'default')) ? GM_getValue(THEME_KEY, 'default') : 'default',
        updateAvailable: GM_getValue(UPDATE_AVAILABLE_KEY, ''),
    };

    let ui = {};

    // Transient mobile-only viewport state. This is intentionally not persisted:
    // it only prevents keyboard open/close from slightly changing the compact size.
    let mobileCompactHeight = null;
    let mobileKeyboardWasOpen = false;

    function addStyles() {
        if (document.getElementById('almanac-alliance-chat-css')) return;
        const style = document.createElement('style');
        style.id = 'almanac-alliance-chat-css';
        style.textContent = `
            #${PANEL_ID} {
                --ac-panel-bg: #202225;
                --ac-body-bg: #26292d;
                --ac-header-top: #3b4b5f;
                --ac-header-bottom: #263546;
                --ac-status-bg: #181a1d;
                --ac-composer-bg: #1d1f22;
                --ac-input-bg: #303338;
                --ac-border: #111;
                --ac-text: #ddd;
                --ac-message-text: #e3e3e3;
                --ac-muted: #9aa0a6;
                --ac-online: #9ab3cb;
                --ac-name: #77a7d5;
                --ac-faction: #8c9298;
                --ac-time: #777;
                --ac-accent: #405d79;
                --ac-scroll-track: #202225;
                --ac-scroll-thumb: #5d6268;
                --ac-scroll-thumb-hover: #737980;
                --ac-theme-header-image: none;
                --ac-theme-bg-image: none;

                position: fixed;
                box-sizing: border-box;
                width: 300px;
                height: 540px;
                min-width: 260px;
                min-height: 220px;
                max-width: calc(100vw - 16px);
                max-height: calc(100vh - 16px);
                resize: both;
                right: 58px;
                bottom: 0;
                z-index: 1000000;
                display: none;
                flex-direction: column;
                overflow: hidden;
                border: 1px solid rgba(0,0,0,.55);
                border-radius: 6px 6px 0 0;
                background: var(--ac-panel-bg);
                color: var(--ac-text);
                box-shadow: 0 2px 14px rgba(0,0,0,.55);
                font-family: Arial, sans-serif;
                font-size: 12px;
            }
            #${PANEL_ID}.ac-visible { display: flex; }
            #${PANEL_ID}.ac-minimized { height: 38px !important; resize: none; }
            #${PANEL_ID}.ac-minimized .ac-body,
            #${PANEL_ID}.ac-minimized .ac-composer,
            #${PANEL_ID}.ac-minimized .ac-status { display: none !important; }
            #${PANEL_ID} .ac-header {
                height: 38px;
                min-height: 38px;
                display: flex;
                align-items: center;
                gap: 7px;
                padding: 0 8px;
                background:
                    linear-gradient(rgba(4, 10, 18, 0.50), rgba(4, 10, 18, 0.50)),
                    var(--ac-theme-header-image),
                    linear-gradient(var(--ac-header-top), var(--ac-header-bottom));
                background-size: cover;
                background-position: center;
                border-bottom: 1px solid var(--ac-border);
                color: #fff;
                cursor: move;
                user-select: none;
                box-sizing: border-box;
            }
            #${PANEL_ID} .ac-title { font-weight: 700; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
            #${PANEL_ID} .ac-online { font-size: 10px; color: var(--ac-online); }
            #${PANEL_ID} .ac-online.ac-update {
                cursor: pointer;
                font-weight: 700;
                text-decoration: underline;
            }
            #${PANEL_ID} .ac-online.ac-update:hover {
                filter: brightness(1.25);
            }
            #${PANEL_ID} .ac-header button {
                border: 0; background: transparent; color: var(--ac-text); cursor: pointer;
                font-size: 16px; width: 24px; height: 24px; line-height: 20px;
            }
            #${PANEL_ID} .ac-header button:hover { color: #fff; }
            #${PANEL_ID} .ac-status {
                min-height: 22px; padding: 4px 8px; box-sizing: border-box;
                background: var(--ac-status-bg); color: var(--ac-muted); border-bottom: 1px solid var(--ac-border);
                font-size: 10px;
            }
            #${PANEL_ID} .ac-body {
                flex: 1; overflow-y: auto; overflow-x: hidden;
                padding: 8px; box-sizing: border-box;
                background:
                    linear-gradient(rgba(5, 10, 18, 0.73), rgba(5, 10, 18, 0.73)),
                    var(--ac-theme-bg-image),
                    var(--ac-body-bg);
                background-size: cover;
                background-position: center;
                scrollbar-width: thin;
                scrollbar-color: var(--ac-scroll-thumb) var(--ac-scroll-track);
            }

            #${PANEL_ID} .ac-body::-webkit-scrollbar {
                width: 7px;
            }

            #${PANEL_ID} .ac-body::-webkit-scrollbar-track {
                background: var(--ac-scroll-track);
            }

            #${PANEL_ID} .ac-body::-webkit-scrollbar-thumb {
                background: var(--ac-scroll-thumb);
                border-radius: 6px;
                border: 1px solid var(--ac-scroll-track);
            }

            #${PANEL_ID} .ac-body::-webkit-scrollbar-thumb:hover {
                background: var(--ac-scroll-thumb-hover);
            }
            #${PANEL_ID} .ac-msg { margin: 0 0 7px 0; word-break: break-word; line-height: 1.32; }
            #${PANEL_ID} .ac-meta { display: flex; align-items: baseline; gap: 5px; margin-bottom: 1px; }
            #${PANEL_ID} .ac-name { color: var(--ac-name); font-weight: 700; text-decoration: none; cursor: pointer; }
            #${PANEL_ID} .ac-name:hover { text-decoration: underline; }
            #${PANEL_ID} .ac-time { color: var(--ac-time); font-size: 9px; }
            #${PANEL_ID} .ac-faction { color: var(--ac-faction); font-size: 9px; }
            #${PANEL_ID} .ac-text { color: var(--ac-message-text); white-space: pre-wrap; }
            #${PANEL_ID} .ac-title,
            #${PANEL_ID} .ac-name,
            #${PANEL_ID} .ac-text {
                text-shadow: 0 1px 2px rgba(0,0,0,.85);
            }
            #${PANEL_ID} .ac-system { color: #a8b3be; font-style: italic; margin: 6px 0; }
            #${PANEL_ID} .ac-error { color: #e58d8d; }
            #${PANEL_ID} .ac-composer {
                display: flex; align-items: flex-end; gap: 5px;
                padding: 6px; background: var(--ac-composer-bg); border-top: 1px solid #111;
            }
            #${PANEL_ID} .ac-composer textarea {
                flex: 1; resize: none; min-height: 34px; max-height: 90px;
                border: 1px solid #111; border-radius: 3px; padding: 7px;
                box-sizing: border-box; background: var(--ac-input-bg); color: #eee; outline: none;
                font: inherit;
            }
            #${PANEL_ID} .ac-send {
                width: 58px; min-width: 58px; height: 34px;
                border: 1px solid #111; border-radius: 3px;
                background: var(--ac-accent); color: #fff; cursor: pointer;
                font-weight: 700;
            }
            #${PANEL_ID} .ac-send:disabled { opacity: .45; cursor: default; }
            #${PANEL_ID} .ac-login {
                position: absolute; inset: 38px 0 0 0; z-index: 3;
                display: none; flex-direction: column; padding: 14px;
                box-sizing: border-box; background: #22262a; color: var(--ac-text);
            }
            #${PANEL_ID} .ac-login.ac-show { display: flex; }
            #${PANEL_ID} .ac-login h3 { margin: 0 0 10px; color: #fff; font-size: 14px; }
            #${PANEL_ID} .ac-login p { margin: 0 0 10px; line-height: 1.4; }
            #${PANEL_ID} .ac-login input {
                padding: 8px; background: #151719; color: #eee; border: 1px solid #555;
                border-radius: 3px; outline: none;
            }
            #${PANEL_ID} .ac-login button {
                margin-top: 8px; padding: 8px; border: 1px solid #111; border-radius: 3px;
                background: var(--ac-accent); color: #fff; cursor: pointer;
            }
            #${PANEL_ID} .ac-login-note { margin-top: 10px !important; color: #8f979e; font-size: 10px; }
            #${PANEL_ID} .ac-api-table { width: 100%; border-collapse: collapse; margin: 2px 0 8px; font-size: 10px; }
            #${PANEL_ID} .ac-api-table th, #${PANEL_ID} .ac-api-table td { border: 1px solid #444; padding: 4px; text-align: left; vertical-align: top; }
            #${PANEL_ID} .ac-api-table th { color: #fff; background: #1b1e21; }
            #${PANEL_ID} .ac-api-table td { color: #b9c0c7; }
            #${PANEL_ID} .ac-login-error { min-height: 15px; color: #e58d8d; margin-top: 8px; }
            #${PANEL_ID} .ac-login-actions { display: flex; flex-direction: column; gap: 7px; }
            #${PANEL_ID} .ac-login-label { color: #c7cdd3; font-size: 10px; margin-top: 2px; }
            #${PANEL_ID} details.ac-privacy {
                margin-top: 10px; padding-top: 8px; border-top: 1px solid #3a3e43;
                color: #9fa7ae; font-size: 10px;
            }
            #${PANEL_ID} details.ac-privacy summary {
                cursor: pointer; color: var(--ac-online); user-select: none;
            }
            #${PANEL_ID} .ac-privacy-body { margin-top: 7px; line-height: 1.4; }
            #${PANEL_ID} .ac-privacy-body p { margin: 0 0 7px; }
            #${PANEL_ID} .ac-privacy-body strong { color: #d6dbe0; }

            #${PANEL_ID}[data-theme="almanac"] {
                --ac-panel-bg: #071321;
                --ac-body-bg: #081a2d;
                --ac-header-top: #0c3150;
                --ac-header-bottom: #071827;
                --ac-status-bg: #07121f;
                --ac-composer-bg: #07111c;
                --ac-input-bg: #091827;
                --ac-border: #0a6ea3;
                --ac-text: #d9f4ff;
                --ac-message-text: #e6f7ff;
                --ac-muted: #7fa7b8;
                --ac-online: #22c9ff;
                --ac-name: #11c6ff;
                --ac-faction: #6d9fb2;
                --ac-time: #6c8794;
                --ac-accent: #067fb8;
                --ac-scroll-track: #06111c;
                --ac-scroll-thumb: #00aee8;
                --ac-scroll-thumb-hover: #31d4ff;
            }

            #${PANEL_ID}[data-theme="flux"] {
                --ac-panel-bg: #100818;
                --ac-body-bg: #12091d;
                --ac-header-top: #29103d;
                --ac-header-bottom: #13091f;
                --ac-status-bg: #110719;
                --ac-composer-bg: #0e0715;
                --ac-input-bg: #170b22;
                --ac-border: #6f2296;
                --ac-text: #f1e5ff;
                --ac-message-text: #f5efff;
                --ac-muted: #aa8cb7;
                --ac-online: #28e4f1;
                --ac-name: #30e2ef;
                --ac-faction: #c24ae6;
                --ac-time: #8d7b98;
                --ac-accent: #70269c;
                --ac-scroll-track: #0b0610;
                --ac-scroll-thumb: #9e2ccc;
                --ac-scroll-thumb-hover: #d53eff;
            }

            #${PANEL_ID} .ac-settings {
                position: absolute;
                top: 42px;
                right: 8px;
                z-index: 5;
                display: none;
                width: 180px;
                padding: 10px;
                box-sizing: border-box;
                border: 1px solid var(--ac-border);
                border-radius: 4px;
                background: var(--ac-panel-bg);
                box-shadow: 0 4px 14px rgba(0,0,0,.55);
                color: var(--ac-text);
            }
            #${PANEL_ID} .ac-settings.ac-show { display: block; }
            #${PANEL_ID} .ac-settings-title { font-weight: 700; margin-bottom: 8px; }
            #${PANEL_ID} .ac-settings-label { font-size: 10px; color: var(--ac-muted); margin-bottom: 4px; }
            #${PANEL_ID} .ac-theme-select {
                width: 100%;
                padding: 6px;
                border: 1px solid var(--ac-border);
                border-radius: 3px;
                background: var(--ac-input-bg);
                color: var(--ac-text);
                outline: none;
            }

            #${PANEL_ID} .ac-mobile-size { display: none; }

            @media (max-width: 700px) {
                #${PANEL_ID} {
                    width: calc(100vw - 12px) !important;
                    height: min(65dvh, 520px);
                    min-width: 0;
                    min-height: 240px;
                    max-width: none;
                    max-height: calc(100dvh - 12px);
                    left: 6px !important;
                    right: auto !important;
                    top: auto;
                    bottom: 6px;
                    resize: none;
                    border-radius: 8px;
                }
                #${PANEL_ID}.ac-mobile-expanded { height: calc(100dvh - 12px); }
                #${PANEL_ID} .ac-header {
                    height: 44px; min-height: 44px; cursor: default;
                    padding: 0 6px 0 9px; gap: 4px;
                }
                #${PANEL_ID} .ac-header button {
                    width: 32px; height: 32px; font-size: 18px; line-height: 28px;
                    touch-action: manipulation;
                }
                #${PANEL_ID} .ac-mobile-size { display: inline-block; }
                #${PANEL_ID} .ac-status { min-height: 24px; padding: 5px 8px; }
                #${PANEL_ID} .ac-body {
                    -webkit-overflow-scrolling: touch;
                    overscroll-behavior: contain;
                }
                #${PANEL_ID} .ac-composer {
                    padding: 8px; gap: 7px;
                    padding-bottom: max(8px, env(safe-area-inset-bottom));
                }
                #${PANEL_ID} .ac-composer textarea {
                    min-height: 42px; max-height: 84px; padding: 9px;
                    font-size: 16px; line-height: 1.25;
                }
                #${PANEL_ID} .ac-send {
                    width: 64px; min-width: 64px; height: 42px; font-size: 13px;
                    touch-action: manipulation;
                }
                #${PANEL_ID} .ac-settings {
                    top: 48px; right: 6px; width: min(220px, calc(100vw - 24px));
                }
                #${PANEL_ID} .ac-login {
                    inset: 44px 0 0 0; overflow-y: auto;
                    padding-bottom: max(14px, env(safe-area-inset-bottom));
                }
            }

            #${LAUNCHER_ID} {
                width: 40px; height: 40px; border: 1px solid #111; border-radius: 4px;
                background: linear-gradient(#405d79, #27394b); color: white; cursor: pointer;
                font: bold 11px Arial, sans-serif; position: relative;
                box-shadow: inset 0 1px rgba(255,255,255,.08);
            }
            #${LAUNCHER_ID}:hover { filter: brightness(1.15); }
            #${LAUNCHER_ID} .ac-badge {
                display: none; position: absolute; top: -7px; right: -7px;
                min-width: 20px; height: 20px; padding: 0 5px; border-radius: 10px;
                background: #b33; color: white; font: bold 11px/20px Arial, sans-serif;
                box-sizing: border-box;
                border: 2px solid #202225;
                box-shadow: 0 1px 4px rgba(0,0,0,.6);
            }
            #${LAUNCHER_ID} .ac-badge.ac-show { display: block; }
            .ac-launcher-floating {
                position: fixed !important; right: 5px; bottom: 120px; z-index: 999999;
            }
        `;
        document.head.appendChild(style);
    }

    function el(tag, cls, text) {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function loadUiState() {
        const saved = GM_getValue(UI_STATE_KEY, null);
        if (!saved || typeof saved !== 'object') {
            return {
                visible: false,
                minimized: false,
                left: null,
                top: null,
                width: null,
                height: null,
                mobileExpanded: false
            };
        }
        return {
            visible: !!saved.visible,
            minimized: !!saved.minimized,
            left: Number.isFinite(saved.left) ? saved.left : null,
            top: Number.isFinite(saved.top) ? saved.top : null,
            width: Number.isFinite(saved.width) ? saved.width : null,
            height: Number.isFinite(saved.height) ? saved.height : null,
            mobileExpanded: !!saved.mobileExpanded
        };
    }

    function themeImageValue(url) {
        if (!url) return 'none';
        const escaped = String(url).replace(/["\\]/g, '\\$&');
        return `url("${escaped}")`;
    }

    function applyTheme(theme, persist = true) {
        const nextTheme = THEMES.has(theme) ? theme : 'default';
        state.theme = nextTheme;

        if (ui.panel) {
            ui.panel.dataset.theme = nextTheme;
            const assets = THEME_ASSETS[nextTheme] || {};
            ui.panel.style.setProperty('--ac-theme-header-image', themeImageValue(assets.header));
            ui.panel.style.setProperty('--ac-theme-bg-image', themeImageValue(assets.background));
        }

        if (ui.themeSelect && ui.themeSelect.value !== nextTheme) {
            ui.themeSelect.value = nextTheme;
        }

        if (persist) GM_setValue(THEME_KEY, nextTheme);
    }

    function saveUiState(partial = {}) {
        GM_setValue(UI_STATE_KEY, { ...loadUiState(), ...partial });
    }

    function saveCurrentPanelGeometry() {
        if (!ui.panel || isMobileLayout()) return;

        const rect = ui.panel.getBoundingClientRect();

        saveUiState({
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            visible: ui.panel.classList.contains('ac-visible')
        });
    }

    function applySyncedUiState(saved) {
        if (!ui.panel || !saved || typeof saved !== 'object') return;

        const panel = ui.panel;
        panel.dataset.syncingUi = '1';

        if (isMobileLayout()) {
            panel.classList.toggle('ac-mobile-expanded', !!saved.mobileExpanded);

            if (ui.mobileSizeButton) {
                const expanded = panel.classList.contains('ac-mobile-expanded');
                ui.mobileSizeButton.textContent = expanded ? '▣' : '⛶';
                ui.mobileSizeButton.title = expanded ? 'Compact chat' : 'Expand chat';
            }

            updateMobileViewport();
        } else {
            if (Number.isFinite(saved.width)) {
                panel.style.width = `${Math.max(260, Math.min(saved.width, window.innerWidth - 16))}px`;
            }

            if (Number.isFinite(saved.height)) {
                panel.style.height = `${Math.max(220, Math.min(saved.height, window.innerHeight - 16))}px`;
            }

            if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
                const pos = clampPanelPosition(panel, saved.left, saved.top);
                panel.style.left = `${pos.left}px`;
                panel.style.top = `${pos.top}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.dataset.dragged = '1';
            }
        }

        panel.classList.remove('ac-minimized');

        if (saved.visible) {
            panel.classList.add('ac-visible');

            // Only initialize networking immediately if this Torn tab is active.
            // Unfocused/hidden tabs keep the UI state in sync without making requests.
            if (isPageActive()) {
                startIfNeeded();
            }
        } else {
            panel.classList.remove('ac-visible');
            schedulePoll(POLL_CLOSED_MS);
        }

        // Prevent ResizeObserver from reflecting the remote change straight back
        // into GM storage and creating a cross-tab feedback loop.
        setTimeout(() => {
            if (panel) delete panel.dataset.syncingUi;
        }, 300);
    }

    function clampPanelPosition(panel, left, top) {
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - 38);
        return {
            left: Math.min(maxLeft, Math.max(0, left)),
            top: Math.min(maxTop, Math.max(0, top))
        };
    }

    function currentUserscriptVersion() {
        return '0.1.46';
    }

    function compareVersions(a, b) {
        const pa = String(a || '').split('.').map(part => Number.parseInt(part, 10) || 0);
        const pb = String(b || '').split('.').map(part => Number.parseInt(part, 10) || 0);
        const length = Math.max(pa.length, pb.length);

        for (let i = 0; i < length; i++) {
            const av = pa[i] || 0;
            const bv = pb[i] || 0;
            if (av > bv) return 1;
            if (av < bv) return -1;
        }
        return 0;
    }

    function renderConnectionState(label = 'Connected') {
        if (!ui.online) return;

        if (state.updateAvailable) {
            ui.online.textContent = 'Update';
            ui.online.classList.add('ac-update');
            ui.online.title = `Version ${state.updateAvailable} available — click to update`;
            return;
        }

        ui.online.classList.remove('ac-update');
        ui.online.removeAttribute('title');
        ui.online.textContent = label;
    }

    function openUserscriptUpdate() {
        window.open(UPDATE_URL, '_blank', 'noopener,noreferrer');
    }

    async function checkForUserscriptUpdate(force = false) {
        const now = Date.now();
        const saved = GM_getValue(UPDATE_CHECK_KEY, null);

        if (
            !force &&
            saved &&
            typeof saved === 'object' &&
            Number.isFinite(saved.checkedAt) &&
            now - saved.checkedAt < UPDATE_CHECK_INTERVAL_MS
        ) {
            const cachedVersion = String(saved.latestVersion || '');
            state.updateAvailable =
                cachedVersion && compareVersions(cachedVersion, currentUserscriptVersion()) > 0
                    ? cachedVersion
                    : '';
            GM_setValue(UPDATE_AVAILABLE_KEY, state.updateAvailable);
            renderConnectionState();
            return;
        }

        try {
            const source = await new Promise((resolve, reject) => {
                GM.xmlHttpRequest({
                    method: 'GET',
                    url: `${UPDATE_URL}?t=${now}`,
                    headers: {
                        'Cache-Control': 'no-cache'
                    },
                    responseType: 'text',
                    onload: response => {
                        if (response.status >= 200 && response.status < 300) {
                            resolve(response.responseText || '');
                        } else {
                            reject(new Error(`Update check HTTP ${response.status}`));
                        }
                    },
                    onerror: () => reject(new Error('Update check failed')),
                    onabort: () => reject(new Error('Update check aborted')),
                    ontimeout: () => reject(new Error('Update check timed out'))
                });
            });

            const match = source.match(/^\s*\/\/\s*@version\s+([^\s]+)\s*$/m);
            const latestVersion = match ? match[1].trim() : '';

            GM_setValue(UPDATE_CHECK_KEY, {
                checkedAt: now,
                latestVersion
            });

            state.updateAvailable =
                latestVersion && compareVersions(latestVersion, currentUserscriptVersion()) > 0
                    ? latestVersion
                    : '';

            GM_setValue(UPDATE_AVAILABLE_KEY, state.updateAvailable);
            renderConnectionState();
        } catch (_) {
            // Update checking should never interfere with chat operation.
        }
    }

    function buildPanel() {
        if (document.getElementById(PANEL_ID)) return;
        const panel = el('div');
        panel.id = PANEL_ID;

        const header = el('div', 'ac-header');
        const title = el('div', 'ac-title', state.roomName);
        const online = el('div', 'ac-online', 'offline');
        const settingsButton = el('button', '', '⚙');
        settingsButton.type = 'button'; settingsButton.title = 'Settings';
        const mobileSizeButton = el('button', 'ac-mobile-size', '⛶');
        mobileSizeButton.type = 'button'; mobileSizeButton.title = 'Expand chat';
        const min = el('button', '', '—');
        min.type = 'button'; min.title = 'Hide';
        const close = el('button', '', '×');
        close.type = 'button'; close.title = 'Close';
        header.append(title, online, settingsButton, mobileSizeButton, min, close);

        const status = el('div', 'ac-status', 'Not connected');
        const body = el('div', 'ac-body');

        const settings = el('div', 'ac-settings');
        const settingsTitle = el('div', 'ac-settings-title', 'Chat settings');
        const themeLabel = el('div', 'ac-settings-label', 'Theme');
        const themeSelect = document.createElement('select');
        themeSelect.className = 'ac-theme-select';

        for (const [value, label] of [
            ['default', 'Default'],
            ['almanac', 'Almanac'],
            ['flux', 'FLUX']
        ]) {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            themeSelect.appendChild(option);
        }

        themeSelect.value = state.theme;
        settings.append(settingsTitle, themeLabel, themeSelect);

        const composer = el('div', 'ac-composer');
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Type your message here...';
        textarea.maxLength = state.maxMessageChars;
        const send = el('button', 'ac-send', 'Send');
        send.type = 'button'; send.disabled = true;
        composer.append(textarea, send);

        const login = el('div', 'ac-login');
        const loginTitle = el('h3', '', 'Alliance Chat authentication');
        const loginInfo = el(
            'p',
            '',
            'Create a dedicated Public Access API key for Alliance Chat, then paste it below.'
        );

        const actions = el('div', 'ac-login-actions');

        const createKeyButton = el('button', '', 'Create Public API key on Torn');
        createKeyButton.type = 'button';

        const inputLabel = el('div', 'ac-login-label', 'Paste your API key:');
        const input = document.createElement('input');
        input.type = 'password';
        input.placeholder = 'Paste Torn API key';
        input.autocomplete = 'off';

        const loginButton = el('button', '', 'Verify and connect');
        loginButton.type = 'button';

        actions.append(createKeyButton, inputLabel, input, loginButton);

        const shortNote = el(
            'p',
            'ac-login-note',
            'Your key is used once to verify your Torn account and current faction. The API key is not stored. This device stays signed in for up to 90 days using a rotating session token.'
        );

        const privacy = document.createElement('details');
        privacy.className = 'ac-privacy';

        const privacySummary = document.createElement('summary');
        privacySummary.textContent = 'Privacy & API usage';

        const privacyBody = el('div', 'ac-privacy-body');

        const privacyKey = el(
            'p',
            '',
            'API key: used for one Torn API v2 key/info request at login. It is not stored by Alliance Chat.'
        );
        const privacyData = el(
            'p',
            '',
            'Stored account data: Torn user ID, username, and faction ID.'
        );
        const privacyDom = el(
            'p',
            '',
            'Userscript behavior: does not read or transmit Torn faction-chat messages or other Torn page content. Torn DOM access is only used to position this custom UI.'
        );
        const privacyMembership = el(
            'p',
            '',
            'Membership checks: performed through Torn\'s official API by the chat server.'
        );

        privacyBody.append(privacyKey, privacyData, privacyDom, privacyMembership);
        privacy.append(privacySummary, privacyBody);

        const loginError = el('div', 'ac-login-error');

        login.append(loginTitle, loginInfo, actions, shortNote, privacy, loginError);

        panel.append(header, status, body, composer, login, settings);
        document.body.appendChild(panel);
        ui = { panel, header, title, online, settingsButton, mobileSizeButton, min, close, status, body, textarea, send, login, input, loginButton, loginError, settings, themeSelect };

        applyTheme(state.theme, false);

        const savedUi = loadUiState();

        if (isMobileLayout()) {
            panel.classList.toggle('ac-mobile-expanded', savedUi.mobileExpanded);
            mobileSizeButton.textContent = savedUi.mobileExpanded ? '▣' : '⛶';
            mobileSizeButton.title = savedUi.mobileExpanded ? 'Compact chat' : 'Expand chat';
        } else {
            if (savedUi.left !== null && savedUi.top !== null) {
                const pos = clampPanelPosition(panel, savedUi.left, savedUi.top);
                panel.style.left = `${pos.left}px`;
                panel.style.top = `${pos.top}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.dataset.dragged = '1';
            }

            if (savedUi.width !== null) {
                panel.style.width = `${Math.max(260, Math.min(savedUi.width, window.innerWidth - 16))}px`;
            }

            if (savedUi.height !== null) {
                panel.style.height = `${Math.max(220, Math.min(savedUi.height, window.innerHeight - 16))}px`;
            }
        }

        if (savedUi.minimized) panel.classList.add('ac-minimized');
        if (savedUi.visible) panel.classList.add('ac-visible');

        mobileSizeButton.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!isMobileLayout()) return;
            panel.classList.toggle('ac-mobile-expanded');
            const expanded = panel.classList.contains('ac-mobile-expanded');
            mobileSizeButton.textContent = expanded ? '▣' : '⛶';
            mobileSizeButton.title = expanded ? 'Compact chat' : 'Expand chat';

            if (!expanded) {
                const viewportHeight = window.visualViewport?.height || window.innerHeight;
                mobileCompactHeight = Math.max(240, Math.min(viewportHeight * 0.65, 520));
                panel.dataset.mobileHeightInitialized = '1';
            }

            saveUiState({ mobileExpanded: expanded });
            updateMobileViewport(true);
        });

        online.addEventListener('click', (e) => {
            if (!state.updateAvailable) return;
            e.stopPropagation();
            openUserscriptUpdate();
        });

        settingsButton.addEventListener('click', (e) => {
            e.stopPropagation();
            settings.classList.toggle('ac-show');
        });

        themeSelect.addEventListener('change', () => {
            applyTheme(themeSelect.value, true);
        });

        min.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.remove('ac-visible');
            settings.classList.remove('ac-show');
            panel.classList.remove('ac-minimized');
            saveUiState({ visible: false, minimized: false });
            schedulePoll(POLL_CLOSED_MS);
        });
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.remove('ac-visible');
            settings.classList.remove('ac-show');
            saveUiState({ visible: false });
            schedulePoll(POLL_CLOSED_MS);
        });
        send.addEventListener('click', sendMessage);
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });
        loginButton.addEventListener('click', loginWithKey);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') loginWithKey();
        });

        createKeyButton.addEventListener('click', () => {
            const url = 'https://www.torn.com/preferences.php#tab=api?step=addNewKey&title=Alliance%20Shared%20Chat&type=1';
            window.open(url, '_blank', 'noopener,noreferrer');
        });
        makeDraggable(panel, header);

        let resizeSaveTimer = null;
        const resizeObserver = new ResizeObserver(() => {
            if (isMobileLayout()) return;
            if (panel.classList.contains('ac-minimized')) return;
            if (panel.dataset.syncingUi === '1') return;

            clearTimeout(resizeSaveTimer);
            resizeSaveTimer = setTimeout(() => {
                const rect = panel.getBoundingClientRect();
                saveUiState({
                    width: Math.round(rect.width),
                    height: Math.round(rect.height)
                });
            }, 150);
        });

        resizeObserver.observe(panel);
        updateMobileViewport();
    }

    function installLauncher() {
        const factionButton = document.querySelector(
            '[id^="channel_panel_button:faction-"]'
        );

        if (!factionButton) return;

        const factionWrapper = factionButton.parentElement;
        const controlsContainer = factionWrapper?.parentElement;

        if (!factionWrapper || !controlsContainer) return;

        let launcher = document.getElementById(LAUNCHER_ID);

        // Already installed correctly in its own Torn-style wrapper.
        if (
            launcher &&
            launcher.parentElement?.dataset?.allianceWrapper === '1' &&
            launcher.parentElement?.parentElement === controlsContainer
        ) {
            return;
        }

        // Remove any previous/bad installation.
        if (launcher) {
            const oldWrapper = launcher.parentElement;
            if (oldWrapper?.dataset?.allianceWrapper === '1') {
                oldWrapper.remove();
            } else {
                launcher.remove();
            }
        }

        // Create a new sibling wrapper using Torn's own wrapper shell.
        const wrapper = factionWrapper.cloneNode(false);
        wrapper.removeAttribute('data-alliance-launcher-host');
        wrapper.dataset.allianceWrapper = '1';

        // Keep Torn's layout slot, but make our own click surface sit above its DnD layers.
        wrapper.style.transition = factionWrapper.style.transition || 'transform linear';
        wrapper.style.position = 'relative';
        wrapper.style.zIndex = '2147483646';
        wrapper.style.pointerEvents = 'auto';

        const button = el('button');
        button.id = LAUNCHER_ID;
        button.type = 'button';
        button.title = 'Alliance Chat';

        // Absolute positioning keeps the Torn flex slot intact while ensuring the
        // clickable surface is above Torn's drag/drop overlays.
        const factionRect = factionWrapper.getBoundingClientRect();
        wrapper.style.width = `${factionRect.width}px`;
        wrapper.style.minWidth = `${factionRect.width}px`;
        wrapper.style.height = `${factionRect.height}px`;

        button.style.position = 'absolute';
        button.style.width = '40px';
        button.style.height = '40px';
        button.style.left = '50%';
        button.style.top = '50%';
        button.style.transform = 'translate(-50%, -50%)';
        button.style.zIndex = '2147483647';
        button.style.pointerEvents = 'auto';
        button.style.touchAction = 'manipulation';

        button.append(document.createTextNode('FLUX'));

        const badge = el('span', 'ac-badge', '0');
        button.appendChild(badge);

        const swallowTornPointer = (event) => {
            event.stopPropagation();
        };

        button.addEventListener('pointerdown', swallowTornPointer, true);
        button.addEventListener('mousedown', swallowTornPointer, true);

        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();

            console.log('[AllianceChat] Launcher clicked');

            buildPanel();

            const isVisible = ui.panel.classList.contains('ac-visible');

            if (isVisible) {
                ui.panel.classList.remove('ac-visible');
                ui.settings?.classList.remove('ac-show');
                saveUiState({ visible: false });
                schedulePoll(POLL_CLOSED_MS);
                return;
            }

            ui.panel.classList.add('ac-visible');
            ui.panel.classList.remove('ac-minimized');
            saveUiState({ visible: true, minimized: false });
            if (isMobileLayout()) updateMobileViewport();
            schedulePoll(0);

            state.unread = 0;
            updateBadge();

            positionPanelNearTornChat();
            startIfNeeded();
        });

        wrapper.appendChild(button);

        // Insert ALLY as its own flex item immediately before Faction.
        controlsContainer.insertBefore(wrapper, factionWrapper);
    }

    function positionPanelNearTornChat() {
        if (!ui.panel || ui.panel.dataset.dragged === '1') return;
        const tornWindow = document.querySelector('#chatRoot [id^="faction-"]');
        if (tornWindow) {
            const r = tornWindow.getBoundingClientRect();
            const left = Math.max(8, r.left - 308);
            ui.panel.style.left = `${left}px`;
            ui.panel.style.right = 'auto';
            ui.panel.style.bottom = `${Math.max(0, window.innerHeight - r.bottom)}px`;
        }
    }

    function isMobileLayout() {
        return window.matchMedia(MOBILE_MEDIA).matches;
    }

    function updateMobileViewport(force = false) {
        if (!ui.panel) return;

        const panel = ui.panel;

        if (!isMobileLayout()) {
            panel.classList.remove('ac-mobile-expanded');
            mobileCompactHeight = null;
            mobileKeyboardWasOpen = false;

            const saved = loadUiState();

            if (saved.width !== null) {
                panel.style.width = `${Math.max(260, Math.min(saved.width, window.innerWidth - 16))}px`;
            }

            if (saved.height !== null) {
                panel.style.height = `${Math.max(220, Math.min(saved.height, window.innerHeight - 16))}px`;
            }

            if (saved.left !== null && saved.top !== null) {
                const pos = clampPanelPosition(panel, saved.left, saved.top);
                panel.style.left = `${pos.left}px`;
                panel.style.top = `${pos.top}px`;
                panel.style.right = 'auto';
                panel.style.bottom = 'auto';
                panel.dataset.dragged = '1';
            }

            if (ui.mobileSizeButton) {
                ui.mobileSizeButton.textContent = '⛶';
                ui.mobileSizeButton.title = 'Expand chat';
            }
            return;
        }

        const viewport = window.visualViewport;
        const viewportWidth = viewport?.width || window.innerWidth;
        const viewportHeight = viewport?.height || window.innerHeight;
        const offsetLeft = viewport?.offsetLeft || 0;
        const offsetTop = viewport?.offsetTop || 0;
        const expanded = panel.classList.contains('ac-mobile-expanded');

        const keyboardLikelyOpen =
            !!viewport && viewportHeight < window.innerHeight * 0.82;

        // Capture compact height only while the keyboard is closed.
        // Once captured, keep reusing it so browser chrome / visualViewport
        // changes don't make the chat grow a few pixels after typing.
        if (!expanded && !keyboardLikelyOpen) {
            if (mobileCompactHeight === null || mobileKeyboardWasOpen === false && force === false && panel.dataset.mobileHeightInitialized !== '1') {
                mobileCompactHeight = Math.max(
                    240,
                    Math.min(viewportHeight * 0.65, 520)
                );
                panel.dataset.mobileHeightInitialized = '1';
            }
        }

        let targetHeight;

        if (expanded) {
            targetHeight = Math.max(240, viewportHeight - 12);
        } else if (keyboardLikelyOpen) {
            targetHeight = Math.max(240, viewportHeight - 12);
        } else {
            if (mobileCompactHeight === null) {
                mobileCompactHeight = Math.max(
                    240,
                    Math.min(viewportHeight * 0.65, 520)
                );
            }
            targetHeight = mobileCompactHeight;
        }

        mobileKeyboardWasOpen = keyboardLikelyOpen;

        const targetWidth = Math.max(248, viewportWidth - 12);
        const left = offsetLeft + 6;
        const top = offsetTop + Math.max(6, viewportHeight - targetHeight - 6);

        panel.style.width = `${targetWidth}px`;
        panel.style.height = `${targetHeight}px`;
        panel.style.left = `${left}px`;
        panel.style.top = `${top}px`;
        panel.style.right = 'auto';
        panel.style.bottom = 'auto';

        if (force && ui.body) {
            requestAnimationFrame(() => {
                if (document.activeElement === ui.textarea) {
                    ui.body.scrollTop = ui.body.scrollHeight;
                }
            });
        }
    }

    function makeDraggable(panel, handle) {
        let dragging = false, dx = 0, dy = 0;
        handle.addEventListener('mousedown', (e) => {
            if (isMobileLayout()) return;
            if (e.target.closest('button')) return;
            const r = panel.getBoundingClientRect();
            dragging = true; dx = e.clientX - r.left; dy = e.clientY - r.top;
            panel.dataset.dragged = '1';
            panel.style.right = 'auto'; panel.style.bottom = 'auto';
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const x = Math.min(window.innerWidth - panel.offsetWidth, Math.max(0, e.clientX - dx));
            const y = Math.min(window.innerHeight - 38, Math.max(0, e.clientY - dy));
            panel.style.left = `${x}px`; panel.style.top = `${y}px`;
        });
        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;

            saveCurrentPanelGeometry();
        });
    }

    function canQueryTornRelatedApi() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    async function apiRaw(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        if (state.token && !options.skipAuth) {
            headers.Authorization = `Bearer ${state.token}`;
        }

        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: options.method || 'GET',
                url: `${API_BASE}${path}`,
                headers,
                data: options.body || undefined,
                responseType: 'text',

                onload: (response) => {
                    let data = {};
                    try {
                        data = response.responseText ? JSON.parse(response.responseText) : {};
                    } catch (_) {}

                    if (response.status < 200 || response.status >= 300) {
                        const err = new Error(data.detail || `HTTP ${response.status}`);
                        err.status = response.status;
                        err.data = data;
                        reject(err);
                        return;
                    }

                    resolve(data);
                },

                onerror: () => reject(new Error('Network request failed')),
                onabort: () => reject(new Error('Network request aborted')),
                ontimeout: () => reject(new Error('Network request timed out'))
            });
        });
    }

    async function refreshAccessToken() {
        if (!state.refreshToken) {
            throw new Error('No refresh session');
        }

        if (state.refreshInFlight) {
            return state.refreshInFlight;
        }

        state.refreshInFlight = (async () => {
            const result = await apiRaw('/api/session/refresh', {
                method: 'POST',
                skipAuth: true,
                body: JSON.stringify({ refresh_token: state.refreshToken })
            });

            if (!result.token || !result.refresh_token) {
                throw new Error('Invalid refresh response');
            }

            state.token = result.token;
            state.refreshToken = result.refresh_token;

            GM_setValue(TOKEN_KEY, state.token);
            GM_setValue(REFRESH_TOKEN_KEY, state.refreshToken);

            if (result.user) state.me = result.user;
            return result;
        })();

        try {
            return await state.refreshInFlight;
        } finally {
            state.refreshInFlight = null;
        }
    }

    async function api(path, options = {}) {
        try {
            return await apiRaw(path, options);
        } catch (err) {
            const canRefresh =
                err.status === 401 &&
                !options.skipRefresh &&
                path !== '/api/auth' &&
                path !== '/api/session/refresh' &&
                !!state.refreshToken;

            if (!canRefresh) throw err;

            try {
                await refreshAccessToken();
            } catch (_) {
                logoutLocal();
                throw err;
            }

            return apiRaw(path, { ...options, skipRefresh: true });
        }
    }

    async function loginWithKey() {
        if (!canQueryTornRelatedApi()) {
            ui.loginError.textContent = 'Keep the Torn tab visible and focused while verifying your API key.';
            return;
        }

        const key = ui.input.value.trim();
        if (!key) return;
        ui.loginError.textContent = '';
        ui.loginButton.disabled = true;
        ui.loginButton.textContent = 'Verifying...';
        try {
            // Intentionally never persisted via GM_setValue/localStorage.
            const result = await api('/api/auth', {
                method: 'POST',
                body: JSON.stringify({ api_key: key }),
            });
            ui.input.value = '';
            state.token = result.token;
            state.refreshToken = result.refresh_token || '';
            GM_setValue(TOKEN_KEY, state.token);
            if (state.refreshToken) GM_setValue(REFRESH_TOKEN_KEY, state.refreshToken);
            state.me = result.user;
            ui.login.classList.remove('ac-show');
            await loadBootstrap(true);
            startPolling();
        } catch (err) {
            ui.input.value = '';
            ui.loginError.textContent = err.message || 'Authentication failed';
        } finally {
            ui.loginButton.disabled = false;
            ui.loginButton.textContent = 'Verify and connect';
        }
    }

    async function startIfNeeded() {
        if (!state.token && state.refreshToken) {
            try {
                await refreshAccessToken();
            } catch (_) {
                logoutLocal();
            }
        }

        if (!state.token) {
            showLogin();
            return;
        }

        try {
            await loadBootstrap(true);
            startPolling();
        } catch (err) {
            if (err.status === 401 || err.status === 403) {
                logoutLocal();
                showLogin(err.status === 403
                    ? 'Your faction is not authorized.'
                    : 'Session expired. Verify again.');
            } else {
                setStatus(`Connection error: ${err.message}`, true);
                schedulePoll(5000);
            }
        }
    }

    function showLogin(message = '') {
        buildPanel();
        ui.panel.classList.add('ac-visible');
        ui.login.classList.add('ac-show');
        ui.loginError.textContent = message;
        ui.input.focus();
    }

    function logoutLocal() {
        state.token = '';
        state.refreshToken = '';
        state.refreshInFlight = null;
        state.cryptoKey = null;
        state.keyVersion = null;
        state.lastCursor = 0;
        state.seenMessageIds.clear();
        GM_deleteValue(TOKEN_KEY);
        GM_deleteValue(REFRESH_TOKEN_KEY);

        if (state.pollTimer) {
            clearTimeout(state.pollTimer);
            state.pollTimer = null;
        }

        state.pollInFlight = false;
        ui.send.disabled = true;
        if (ui.online) renderConnectionState('offline');
    }

    async function loadBootstrap(renderHistory) {
        const data = await api('/api/bootstrap');

        state.roomId = data.room.id;
        state.roomName = data.room.name;
        state.keyVersion = data.key_version;
        state.me = data.user;
        state.factionNames = { ...state.factionNames, ...(data.faction_names || {}) };
        if (data.user?.faction_name) {
            state.factionNames[String(data.user.faction_id)] = data.user.faction_name;
        }
        state.maxMessageChars = data.max_message_chars || 1000;
        state.lastCursor = Number(data.cursor || 0);

        ui.title.textContent = state.roomName;
        ui.textarea.maxLength = state.maxMessageChars;
        state.cryptoKey = await importRoomKey(data.room_key);

        if (renderHistory) {
            ui.body.textContent = '';
            state.seenMessageIds.clear();

            for (const msg of data.history || []) {
                rememberMessage(msg);
                await renderEncryptedMessage(msg);
            }
            scrollBottom();
        }

        ui.send.disabled = false;
        renderConnectionState('Connecting');
        setStatus(`${state.me.name} · ${state.me.faction_name || state.factionNames[String(state.me.faction_id)] || `Faction ${state.me.faction_id}`}`);
    }

    function isPageActive() {
        return !document.hidden && document.hasFocus();
    }

    function pollDelay() {
        const visible = ui.panel?.classList.contains('ac-visible');
        return visible ? POLL_OPEN_MS : POLL_CLOSED_MS;
    }

    function schedulePoll(delay = pollDelay()) {
        if (!state.token) return;

        if (state.pollTimer) {
            clearTimeout(state.pollTimer);
            state.pollTimer = null;
        }

        state.pollTimer = setTimeout(async () => {
            state.pollTimer = null;
            await pollOnce();
            schedulePoll();
        }, Math.max(0, delay));
    }

    function startPolling() {
        if (!state.token) return;
        schedulePoll(0);
    }

    function rememberMessage(msg) {
        if (!msg?.message_id) return false;
        if (state.seenMessageIds.has(msg.message_id)) return false;

        state.seenMessageIds.add(msg.message_id);
        if (state.seenMessageIds.size > 1000) {
            const first = state.seenMessageIds.values().next().value;
            if (first) state.seenMessageIds.delete(first);
        }
        return true;
    }

    async function pollOnce(force = false) {
        if (!state.token || state.pollInFlight) return;
        if (!force && !isPageActive()) return;

        state.pollInFlight = true;

        try {
            const data = await api(
                `/api/messages?cursor=${encodeURIComponent(state.lastCursor)}&limit=100`
            );

            if (Number(data.key_version) !== Number(state.keyVersion)) {
                addSystem('Room encryption key rotated. Loading the new key...');
                await loadBootstrap(true);
                state.pollFailures = 0;
                return;
            }

            state.factionNames = {
                ...state.factionNames,
                ...(data.faction_names || {})
            };

            let newUnread = 0;

            for (const msg of data.messages || []) {
                state.lastCursor = Math.max(
                    state.lastCursor,
                    Number(msg.seq || 0)
                );

                if (!rememberMessage(msg)) continue;

                await renderEncryptedMessage(msg);

                const panelClosed = !ui.panel.classList.contains('ac-visible');
                const minimized = ui.panel.classList.contains('ac-minimized');
                const fromOtherUser = Number(msg.sender_id) !== Number(state.me?.id);

                if ((panelClosed || minimized) && fromOtherUser) {
                    // In-page notification only: no sound, OS notification,
                    // title flashing, focus stealing, or background alerting.
                    newUnread++;
                }
            }

            state.lastCursor = Math.max(
                state.lastCursor,
                Number(data.cursor || 0)
            );

            if (newUnread > 0) {
                state.unread += newUnread;
                updateBadge();
            }

            state.pollFailures = 0;
            renderConnectionState('Connected');
            setStatus(`${state.me.name} · ${state.me.faction_name || state.factionNames[String(state.me.faction_id)] || `Faction ${state.me.faction_id}`}`);
        } catch (err) {
            if (err.status === 401 || err.status === 403) {
                logoutLocal();
                showLogin(
                    err.status === 403
                        ? 'Faction access was revoked.'
                        : 'Session expired. Verify again.'
                );
                return;
            }

            state.pollFailures++;
            if (state.pollFailures >= 3) {
                renderConnectionState('offline');
                setStatus(`Chat reconnecting: ${err.message}`, true);
            }
        } finally {
            state.pollInFlight = false;
        }
    }

    async function sendMessage() {
        const text = ui.textarea.value.trim();

        if (!text || !state.cryptoKey || !state.token) return;
        if (text.length > state.maxMessageChars) return;

        ui.textarea.value = '';
        ui.send.disabled = true;

        try {
            const encrypted = await encryptText(text);

            const result = await api('/api/messages', {
                method: 'POST',
                body: JSON.stringify({
                    key_version: state.keyVersion,
                    nonce: encrypted.nonce,
                    ciphertext: encrypted.ciphertext,
                }),
            });

            if (Number(result.key_version) !== Number(state.keyVersion)) {
                await loadBootstrap(true);
                return;
            }

            state.lastCursor = Math.max(
                state.lastCursor,
                Number(result.cursor || 0)
            );

            if (result.message && rememberMessage(result.message)) {
                await renderEncryptedMessage(result.message);
            }

            schedulePoll(0);
        } catch (err) {
            if (err.status === 409) {
                ui.textarea.value = text;
                addSystem('Room key changed. Refreshing encryption state...', true);
                try {
                    await loadBootstrap(true);
                } catch (_) {}
            } else if (err.status === 401 || err.status === 403) {
                ui.textarea.value = text;
                logoutLocal();
                showLogin('Session expired or faction access was revoked.');
            } else {
                ui.textarea.value = text;
                addSystem(`Could not send message: ${err.message}`, true);
            }
        } finally {
            ui.send.disabled = !state.token || !state.cryptoKey;
        }
    }

    async function importRoomKey(keyB64) {
        const raw = fromB64(keyB64);
        return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    }

    function aadBytes(version) {
        return new TextEncoder().encode(`${state.roomId}:${version}`);
    }

    async function encryptText(text) {
        const nonce = crypto.getRandomValues(new Uint8Array(12));
        const plain = new TextEncoder().encode(text);
        const cipher = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: aadBytes(state.keyVersion), tagLength: 128 },
            state.cryptoKey,
            plain,
        );
        return { nonce: toB64(nonce), ciphertext: toB64(new Uint8Array(cipher)) };
    }

    async function decryptMessage(msg) {
        if (!state.cryptoKey || msg.key_version !== state.keyVersion) throw new Error('Unknown key version');
        const plain = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: fromB64(msg.nonce),
                additionalData: aadBytes(msg.key_version),
                tagLength: 128,
            },
            state.cryptoKey,
            fromB64(msg.ciphertext),
        );
        return new TextDecoder().decode(plain);
    }

    async function renderEncryptedMessage(msg) {
        let text;
        try { text = await decryptMessage(msg); }
        catch (_) { text = '[Unable to decrypt this message]'; }

        const wrap = el('div', 'ac-msg');
        const meta = el('div', 'ac-meta');

        // Avoid Torn/BSP player-list patterns: no ".user.name", no visible
        // [playerId], and no profile <a href> in the message DOM.
        const name = el('span', 'ac-name', msg.sender_name || 'Unknown user');
        name.dataset.allianceSender = '1';
        name.dataset.playerId = String(msg.sender_id || '');
        name.setAttribute('role', 'link');
        name.setAttribute('tabindex', '0');

        const openProfile = () => {
            const playerId = Number(msg.sender_id || 0);
            if (!playerId) return;
            window.open(
                `https://www.torn.com/profiles.php?XID=${encodeURIComponent(playerId)}`,
                '_blank',
                'noopener,noreferrer'
            );
        };

        name.addEventListener('click', openProfile);
        name.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                openProfile();
            }
        });

        const factionName =
            msg.faction_name ||
            state.factionNames[String(msg.faction_id)] ||
            `Faction ${msg.faction_id}`;

        const faction = el('span', 'ac-faction', `[${factionName}]`);
        const stamp = el('span', 'ac-time', formatTime(msg.created_at));
        const body = el('div', 'ac-text', text); // textContent: no message HTML execution.
        meta.append(name, faction, stamp);
        wrap.append(meta, body);
        ui.body.appendChild(wrap);
        scrollBottom();
    }

    function addSystem(text, isError = false) {
        const node = el('div', `ac-system${isError ? ' ac-error' : ''}`, text);
        ui.body.appendChild(node);
        scrollBottom();
    }

    function setStatus(text, isError = false) {
        if (!ui.status) return;
        ui.status.textContent = text;
        ui.status.classList.toggle('ac-error', !!isError);
    }

    function formatTime(value) {
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    function scrollBottom() {
        if (!ui.body) return;
        ui.body.scrollTop = ui.body.scrollHeight;
    }

    function toB64(bytes) {
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return btoa(binary);
    }

    function fromB64(value) {
        const binary = atob(value);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
    }

    function updateBadge() {
        const launcher = document.getElementById(LAUNCHER_ID);
        const badge = launcher?.querySelector('.ac-badge');
        if (!badge) return;
        badge.textContent = state.unread > 99 ? '99+' : String(state.unread);
        badge.classList.toggle('ac-show', state.unread > 0);
    }

    if (typeof GM_addValueChangeListener === 'function') {
        GM_addValueChangeListener(UI_STATE_KEY, (_name, _oldValue, newValue, remote) => {
            if (!remote) return;
            applySyncedUiState(newValue);
        });

        GM_addValueChangeListener(THEME_KEY, (_name, _oldValue, newValue, remote) => {
            if (!remote) return;
            applyTheme(newValue, false);
        });
    }

    function boot() {
        checkForUserscriptUpdate();

        preloadThemeAssets();

        addStyles();
        buildPanel();
        installLauncher();

        if (loadUiState().visible) {
            startIfNeeded();
        }
    }

    // Torn is React-heavy and can rebuild the chat tree after navigation.
    // Re-running these functions is safe and restores only our launcher if needed.
    let observerQueued = false;
    const observer = new MutationObserver(() => {
        if (observerQueued) return;
        observerQueued = true;
        setTimeout(() => {
            observerQueued = false;
            installLauncher();
        }, 250);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    window.addEventListener('resize', () => {
        if (isMobileLayout()) {
            updateMobileViewport();
            return;
        }
        if (!ui.panel || ui.panel.dataset.dragged !== '1') return;

        const r = ui.panel.getBoundingClientRect();

        const width = Math.max(260, Math.min(r.width, window.innerWidth - 16));
        const height = Math.max(220, Math.min(r.height, window.innerHeight - 16));

        ui.panel.style.width = `${width}px`;
        if (!ui.panel.classList.contains('ac-minimized')) {
            ui.panel.style.height = `${height}px`;
        }

        const pos = clampPanelPosition(ui.panel, r.left, r.top);

        ui.panel.style.left = `${pos.left}px`;
        ui.panel.style.top = `${pos.top}px`;

        saveUiState({
            left: Math.round(pos.left),
            top: Math.round(pos.top),
            width: Math.round(width),
            height: Math.round(height)
        });
    });

    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            if (isMobileLayout()) updateMobileViewport();
        });
        window.visualViewport.addEventListener('scroll', () => {
            if (isMobileLayout()) updateMobileViewport();
        });
    }

    const mobileMediaQuery = window.matchMedia(MOBILE_MEDIA);
    if (typeof mobileMediaQuery.addEventListener === 'function') {
        mobileMediaQuery.addEventListener('change', () => updateMobileViewport());
    }

    const adjustForMobileKeyboard = () => {
        if (!isMobileLayout()) return;
        requestAnimationFrame(() => updateMobileViewport(true));
        setTimeout(() => updateMobileViewport(true), 120);
        setTimeout(() => updateMobileViewport(true), 300);
    };

    document.addEventListener('focusin', (event) => {
        if (event.target === ui.textarea || event.target === ui.input) adjustForMobileKeyboard();
    });

    document.addEventListener('focusout', (event) => {
        if (event.target === ui.textarea || event.target === ui.input) {
            setTimeout(() => updateMobileViewport(), 180);
            setTimeout(() => updateMobileViewport(), 320);
        }
    });

    const wakePolling = () => {
        if (!state.token || !isPageActive()) return;

        if (ui.panel?.classList.contains('ac-visible') && !state.cryptoKey) {
            startIfNeeded();
            return;
        }

        schedulePoll(0);
    };

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveCurrentPanelGeometry();
        }
        wakePolling();
    });
    window.addEventListener('focus', () => {
        wakePolling();
        checkForUserscriptUpdate();
    });

    window.addEventListener('pagehide', () => {
        saveCurrentPanelGeometry();

        if (state.pollTimer) {
            clearTimeout(state.pollTimer);
            state.pollTimer = null;
        }
    });

    boot();
})();