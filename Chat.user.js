// ==UserScript==
// @name         Torn Alliance Shared Chat
// @namespace    almanac.shared.chat
// @updateURL   https://github.com/Dannebox/Shared-chat/raw/refs/heads/main/Chat.user.js
// @downloadURL https://github.com/Dannebox/Shared-chat/raw/refs/heads/main/Chat.user.js
// @version      0.3.2
// @description  Secure shared chat for approved Torn factions using CSP-safe HTTP polling; does not scrape Torn pages.
// @match        https://www.torn.com/*
// @match        https://torn.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM.xmlHttpRequest
// @connect      127.0.0.1
// @connect      chat.shiroshura.com
// @run-at       document-idle
// ==/UserScript==

(() => {
    'use strict';

    // CHANGE THIS to your HTTPS hostname. Do not put any secrets in this file.
    const API_BASE = 'https://chat.shiroshura.com';
    const TOKEN_KEY = 'alliance_chat_session_v1';
    const UI_STATE_KEY = 'alliance_chat_ui_state_v1';
    const PANEL_ID = 'almanac-alliance-chat';
    const LAUNCHER_ID = 'almanac-alliance-chat-launcher';
    const POLL_OPEN_MS = 3000;
    const POLL_CLOSED_MS = 60000;

    const state = {
        token: GM_getValue(TOKEN_KEY, ''),
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
    };

    let ui = {};

    function addStyles() {
        if (document.getElementById('almanac-alliance-chat-css')) return;
        const style = document.createElement('style');
        style.id = 'almanac-alliance-chat-css';
        style.textContent = `
            #${PANEL_ID} {
                position: fixed;
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
                background: #202225;
                color: #ddd;
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
                background: linear-gradient(#3b4b5f, #263546);
                border-bottom: 1px solid #111;
                color: #fff;
                cursor: move;
                user-select: none;
                box-sizing: border-box;
            }
            #${PANEL_ID} .ac-title { font-weight: 700; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
            #${PANEL_ID} .ac-online { font-size: 10px; color: #9ab3cb; }
            #${PANEL_ID} .ac-header button {
                border: 0; background: transparent; color: #ddd; cursor: pointer;
                font-size: 16px; width: 24px; height: 24px; line-height: 20px;
            }
            #${PANEL_ID} .ac-header button:hover { color: #fff; }
            #${PANEL_ID} .ac-status {
                min-height: 22px; padding: 4px 8px; box-sizing: border-box;
                background: #181a1d; color: #9aa0a6; border-bottom: 1px solid #111;
                font-size: 10px;
            }
            #${PANEL_ID} .ac-body {
                flex: 1; overflow-y: auto; overflow-x: hidden;
                padding: 8px; box-sizing: border-box; background: #26292d;
            }
            #${PANEL_ID} .ac-msg { margin: 0 0 7px 0; word-break: break-word; line-height: 1.32; }
            #${PANEL_ID} .ac-meta { display: flex; align-items: baseline; gap: 5px; margin-bottom: 1px; }
            #${PANEL_ID} .ac-name { color: #77a7d5; font-weight: 700; text-decoration: none; cursor: pointer; }
            #${PANEL_ID} .ac-name:hover { text-decoration: underline; }
            #${PANEL_ID} .ac-time { color: #777; font-size: 9px; }
            #${PANEL_ID} .ac-faction { color: #8c9298; font-size: 9px; }
            #${PANEL_ID} .ac-text { color: #e3e3e3; white-space: pre-wrap; }
            #${PANEL_ID} .ac-system { color: #a8b3be; font-style: italic; margin: 6px 0; }
            #${PANEL_ID} .ac-error { color: #e58d8d; }
            #${PANEL_ID} .ac-composer {
                display: flex; align-items: flex-end; gap: 5px;
                padding: 6px; background: #1d1f22; border-top: 1px solid #111;
            }
            #${PANEL_ID} .ac-composer textarea {
                flex: 1; resize: none; min-height: 34px; max-height: 90px;
                border: 1px solid #111; border-radius: 3px; padding: 7px;
                box-sizing: border-box; background: #303338; color: #eee; outline: none;
                font: inherit;
            }
            #${PANEL_ID} .ac-send {
                width: 38px; height: 34px; border: 1px solid #111; border-radius: 3px;
                background: #405d79; color: #fff; cursor: pointer;
            }
            #${PANEL_ID} .ac-send:disabled { opacity: .45; cursor: default; }
            #${PANEL_ID} .ac-login {
                position: absolute; inset: 38px 0 0 0; z-index: 3;
                display: none; flex-direction: column; padding: 14px;
                box-sizing: border-box; background: #22262a; color: #ddd;
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
                background: #405d79; color: #fff; cursor: pointer;
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
                cursor: pointer; color: #9ab3cb; user-select: none;
            }
            #${PANEL_ID} .ac-privacy-body { margin-top: 7px; line-height: 1.4; }
            #${PANEL_ID} .ac-privacy-body p { margin: 0 0 7px; }
            #${PANEL_ID} .ac-privacy-body strong { color: #d6dbe0; }
            #${LAUNCHER_ID} {
                width: 40px; height: 40px; border: 1px solid #111; border-radius: 4px;
                background: linear-gradient(#405d79, #27394b); color: white; cursor: pointer;
                font: bold 11px Arial, sans-serif; position: relative;
                box-shadow: inset 0 1px rgba(255,255,255,.08);
            }
            #${LAUNCHER_ID}:hover { filter: brightness(1.15); }
            #${LAUNCHER_ID} .ac-badge {
                display: none; position: absolute; top: -5px; right: -5px;
                min-width: 16px; height: 16px; padding: 0 3px; border-radius: 8px;
                background: #b33; color: white; font: bold 9px/16px Arial, sans-serif;
                box-sizing: border-box;
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
                height: null
            };
        }
        return {
            visible: !!saved.visible,
            minimized: !!saved.minimized,
            left: Number.isFinite(saved.left) ? saved.left : null,
            top: Number.isFinite(saved.top) ? saved.top : null,
            width: Number.isFinite(saved.width) ? saved.width : null,
            height: Number.isFinite(saved.height) ? saved.height : null
        };
    }

    function saveUiState(partial = {}) {
        GM_setValue(UI_STATE_KEY, { ...loadUiState(), ...partial });
    }

    function clampPanelPosition(panel, left, top) {
        const maxLeft = Math.max(0, window.innerWidth - panel.offsetWidth);
        const maxTop = Math.max(0, window.innerHeight - 38);
        return {
            left: Math.min(maxLeft, Math.max(0, left)),
            top: Math.min(maxTop, Math.max(0, top))
        };
    }

    function buildPanel() {
        if (document.getElementById(PANEL_ID)) return;
        const panel = el('div');
        panel.id = PANEL_ID;

        const header = el('div', 'ac-header');
        const title = el('div', 'ac-title', state.roomName);
        const online = el('div', 'ac-online', 'offline');
        const min = el('button', '', '—');
        min.type = 'button'; min.title = 'Minimize';
        const close = el('button', '', '×');
        close.type = 'button'; close.title = 'Close';
        header.append(title, online, min, close);

        const status = el('div', 'ac-status', 'Not connected');
        const body = el('div', 'ac-body');

        const composer = el('div', 'ac-composer');
        const textarea = document.createElement('textarea');
        textarea.placeholder = 'Type your message here...';
        textarea.maxLength = state.maxMessageChars;
        const send = el('button', 'ac-send', 'Send');
        send.type = 'button'; send.disabled = true;
        composer.append(textarea, send);

        const login = el('div', 'ac-login');
        const loginTitle = el('h3', '', 'Flux Chat authentication');
        const loginInfo = el(
            'p',
            '',
            'Create a dedicated Public Access API key for Flux Chat, then paste it below.'
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
            'Your key is used once to verify your Torn account and current faction. The API key is not stored.'
        );

        const privacy = document.createElement('details');
        privacy.className = 'ac-privacy';

        const privacySummary = document.createElement('summary');
        privacySummary.textContent = 'Privacy & API usage';

        const privacyBody = el('div', 'ac-privacy-body');

        const privacyKey = el(
            'p',
            '',
            'API key: used for one Torn API v2 key/info request at login. It is not stored by Flux Chat.'
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

        panel.append(header, status, body, composer, login);
        document.body.appendChild(panel);
        ui = { panel, header, title, online, min, close, status, body, textarea, send, login, input, loginButton, loginError };

        const savedUi = loadUiState();

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

        if (savedUi.minimized) panel.classList.add('ac-minimized');
        if (savedUi.visible) panel.classList.add('ac-visible');

        min.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.toggle('ac-minimized');
            saveUiState({ minimized: panel.classList.contains('ac-minimized') });
        });
        close.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.classList.remove('ac-visible');
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
            if (panel.classList.contains('ac-minimized')) return;

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

        button.append(document.createTextNode('ALLY'));

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

            ui.panel.classList.add('ac-visible');
            ui.panel.classList.remove('ac-minimized');
            saveUiState({ visible: true, minimized: false });
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

    function makeDraggable(panel, handle) {
        let dragging = false, dx = 0, dy = 0;
        handle.addEventListener('mousedown', (e) => {
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

            const r = panel.getBoundingClientRect();
            saveUiState({
                left: Math.round(r.left),
                top: Math.round(r.top)
            });
        });
    }

    function canQueryTornRelatedApi() {
        return document.visibilityState === 'visible' && document.hasFocus();
    }

    async function api(path, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        };

        if (state.token) {
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
                        reject(err);
                        return;
                    }

                    resolve(data);
                },

                onerror: () => {
                    reject(new Error('Network request failed'));
                },

                onabort: () => {
                    reject(new Error('Network request aborted'));
                },

                ontimeout: () => {
                    reject(new Error('Network request timed out'));
                }
            });
        });
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
            GM_setValue(TOKEN_KEY, state.token);
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
        state.cryptoKey = null;
        state.keyVersion = null;
        state.lastCursor = 0;
        state.seenMessageIds.clear();
        GM_deleteValue(TOKEN_KEY);

        if (state.pollTimer) {
            clearTimeout(state.pollTimer);
            state.pollTimer = null;
        }

        state.pollInFlight = false;
        ui.send.disabled = true;
        if (ui.online) ui.online.textContent = 'offline';
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
        ui.online.textContent = 'polling';
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
            ui.online.textContent = 'polling';
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
                ui.online.textContent = 'offline';
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

    function boot() {
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

    const wakePolling = () => {
        if (!state.token || !isPageActive()) return;
        schedulePoll(0);
    };

    document.addEventListener('visibilitychange', wakePolling);
    window.addEventListener('focus', wakePolling);

    window.addEventListener('pagehide', () => {
        if (state.pollTimer) {
            clearTimeout(state.pollTimer);
            state.pollTimer = null;
        }
    });

    boot();
})();
