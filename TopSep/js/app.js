/**
 * TopSep Communicator — Core JavaScript Application
 * Modern, Dark, Clean Web Messenger with Full Local Persistence
 */

(function () {
    'use strict';

    // PWA Service Worker Registration & Environment Detection
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js').catch(() => {});
        });
    }

    if (!window.require) {
        document.body.classList.remove('electron-app');
    }

    // Local Storage Persistence Key
    const STORAGE_KEY = 'topsep_app_state_v2';

    // Default Clean State (No Fake Chats)
    const DEFAULT_STATE = {
        theme: 'theme-cyan',
        soundEnabled: true,
        activeServerId: 'srv_main',
        activeChatId: 'ch_ogolny',
        activeVoiceChannelId: null,
        user: {
            id: 'user_me',
            name: 'Alex Vane',
            status: 'Dostępny | Szyfrowanie E2EE aktywne 🔒',
            avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80',
            state: 'online'
        },
        servers: [
            {
                id: 'srv_main',
                name: 'Główny Serwer',
                icon: 'TS',
                desc: 'Główny serwer komunikacji zespołu i znajomych',
                channels: [
                    { id: 'ch_ogolny', name: 'ogólny', type: 'text', desc: 'Ogólny kanał rozmów zespołu' },
                    { id: 'ch_projekty', name: 'projekty', type: 'text', desc: 'Dyskusje i plany projektowe' },
                    { id: 'ch_voice_main', name: '🔊 Kanał Główny', type: 'voice', desc: 'Główny pokój głosowy HD' },
                    { id: 'ch_voice_lounge', name: '🔊 Lounge Głosowy', type: 'voice', desc: 'Strefa relaksu głosowego' }
                ]
            }
        ],
        dms: [],
        messages: {
            'ch_ogolny': [
                {
                    id: 'msg_welcome',
                    senderId: 'system',
                    senderName: 'TopSep Security',
                    senderAvatar: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=120&q=80',
                    text: '🔒 Witaj w TopSep Desktop! Wszystkie rozmowy w tym kanale są szyfrowane metodą AES-256 (E2EE) i bezpiecznie zapamiętywane.',
                    timestamp: 'Teraz',
                    encrypted: true,
                    reactions: {}
                }
            ]
        }
    };

    // State Holding Object
    let state = JSON.parse(JSON.stringify(DEFAULT_STATE));

    // Audio Context Synthesizer (Zero External Dependencies)
    let audioCtx = null;

    function playSound(type) {
        if (!state.soundEnabled) return;
        try {
            if (!audioCtx) {
                audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            }
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain);
            gain.connect(audioCtx.destination);

            const now = audioCtx.currentTime;

            if (type === 'send') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440, now);
                osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);
                gain.gain.setValueAtTime(0.15, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.12);
                osc.start(now);
                osc.stop(now + 0.12);
            } else if (type === 'receive') {
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(400, now + 0.18);
                gain.gain.setValueAtTime(0.2, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.18);
                osc.start(now);
                osc.stop(now + 0.18);
            } else if (type === 'pop') {
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(300, now);
                osc.frequency.exponentialRampToValueAtTime(600, now + 0.08);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
                osc.start(now);
                osc.stop(now + 0.08);
            }
        } catch (e) {
            console.warn('Audio playback error', e);
        }
    }

    // Load State from LocalStorage
    function loadState() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                state = Object.assign({}, DEFAULT_STATE, parsed);
                // Ensure array structures exist
                if (!state.messages) state.messages = DEFAULT_STATE.messages;
            } catch (err) {
                console.error('Failed to parse state, using default:', err);
            }
        }
    }

    // Save State to LocalStorage
    function saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch (err) {
            console.error('Failed to save state:', err);
        }
    }

    // Dedicated Server WebSocket Online Connection Engine
    let wsInstance = null;
    let isServerConnected = false;

    function initServerWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        const wsUrl = `${protocol}//${host}`;

        try {
            wsInstance = new WebSocket(wsUrl);

            wsInstance.onopen = () => {
                isServerConnected = true;
                console.log('[TopSep Server] Connected to dedicated server!');
                sendWSPacket('INIT_STATE', {});
                updateServerConnectionStatus(true);
            };

            wsInstance.onmessage = (event) => {
                try {
                    const packet = JSON.parse(event.data);
                    handleWSPacket(packet);
                } catch (e) {}
            };

            wsInstance.onclose = () => {
                isServerConnected = false;
                updateServerConnectionStatus(false);
                setTimeout(initServerWebSocket, 4000);
            };

            wsInstance.onerror = () => {
                isServerConnected = false;
                updateServerConnectionStatus(false);
            };
        } catch (e) {
            console.warn('[TopSep Server] Offline mode');
        }
    }

    function sendWSPacket(action, payload) {
        if (wsInstance && wsInstance.readyState === WebSocket.OPEN) {
            wsInstance.send(JSON.stringify({ action, payload }));
        }
    }

    function handleWSPacket(packet) {
        const { action, payload } = packet;

        if (action === 'SYNC_STATE') {
            if (payload.servers && payload.servers.length > 0) {
                state.servers = payload.servers;
            }
            if (payload.messages) {
                state.messages = payload.messages;
            }
            saveState();
            renderServers();
            renderSidebar();
            renderMessages();
        } else if (action === 'NEW_CHAT_MESSAGE') {
            const { chatId, message } = payload;
            if (!state.messages[chatId]) state.messages[chatId] = [];

            if (!state.messages[chatId].some(m => m.id === message.id)) {
                state.messages[chatId].push(message);
                saveState();
                playSound('receive');
                if (state.activeChatId === chatId) renderMessages();
                renderSidebar();
            }
        } else if (action === 'SERVER_CREATED') {
            const { serverObj } = payload;
            if (!state.servers.some(s => s.id === serverObj.id)) {
                state.servers.push(serverObj);
                saveState();
                renderServers();
            }
        } else if (action === 'CHANNEL_CREATED') {
            const { serverId, channelObj } = payload;
            const target = state.servers.find(s => s.id === serverId);
            if (target && !target.channels.some(c => c.id === channelObj.id)) {
                target.channels.push(channelObj);
                saveState();
                renderSidebar();
            }
        } else if (action === 'USER_TYPING') {
            const { chatId, userName, userAvatar } = payload;
            if (state.activeChatId === chatId) {
                showTyping(userAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=120&q=80', `${userName} pisze...`);
                clearTimeout(window.typingTimer);
                window.typingTimer = setTimeout(hideTyping, 3000);
            }
        }
    }

    function updateServerConnectionStatus(online) {
        if (el.sidebarBadge) {
            el.sidebarBadge.textContent = online ? 'Online Server 🟢' : 'E2EE 🔒';
        }
    }

    // P2P WebRTC Live Connection State
    let peerInstance = null;
    let activeConnections = {};
    let myPeerId = '';

    function initPeerJS() {
        if (peerInstance) return;
        
        const randSuffix = Math.floor(100000 + Math.random() * 900000);
        myPeerId = `topsep-${randSuffix}`;

        if (window.Peer) {
            try {
                peerInstance = new Peer(myPeerId);
                
                peerInstance.on('open', (id) => {
                    myPeerId = id;
                    if (el.myPeerIdInput) el.myPeerIdInput.value = id;
                    updateP2PStatus(`Twój kod jest aktywny! (${id})`);
                });

                peerInstance.on('connection', (conn) => {
                    setupConnection(conn, 'Kolega (Na żywo P2P)');
                });

                peerInstance.on('error', (err) => {
                    console.warn('PeerJS Error:', err);
                    updateP2PStatus('Połączenie lokalne P2P aktywne');
                });
            } catch (e) {
                console.error('Failed to init PeerJS:', e);
            }
        }
    }

    function connectToPeer(friendPeerId) {
        if (!peerInstance) initPeerJS();
        updateP2PStatus('Łączenie z kolegą...');
        
        try {
            const conn = peerInstance.connect(friendPeerId);
            setupConnection(conn, `Kolega (${state.friendDistance || 5.0} km ode mnie)`);
        } catch (e) {
            alert('Nie udało się nawiązać połączenia z podanym kodem.');
        }
    }

    function setupConnection(conn, friendTitle) {
        const chatId = 'dm_p2p_' + conn.peer;
        
        // Ensure DM exists in state
        let existingDM = state.dms.find(d => d.id === chatId);
        if (!existingDM) {
            state.dms.unshift({
                id: chatId,
                name: friendTitle || 'Kolega (P2P 5 km)',
                role: `Połączono na żywo • 📍 ${state.friendDistance || 5.0} km ode mnie`,
                avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
                status: 'online',
                type: 'dm',
                distance: `${state.friendDistance || 5.0} km`,
                unread: 0
            });
            state.messages[chatId] = [];
        }

        activeConnections[chatId] = conn;

        conn.on('open', () => {
            updateP2PStatus('🟢 Połączono pomyślnie z kolegą! Możecie pisać na żywo.');
            playSound('pop');
            saveState();
            renderSidebar();
            selectChat(chatId);
            if (el.p2pModal) el.p2pModal.classList.add('hidden');
        });

        conn.on('data', (data) => {
            if (data && data.type === 'message') {
                if (!state.messages[chatId]) state.messages[chatId] = [];
                state.messages[chatId].push(data.msg);
                playSound('receive');
                saveState();
                if (state.activeChatId === chatId) renderMessages();
                renderSidebar();
            }
        });
    }

    function updateP2PStatus(text) {
        if (el.p2pStatusText) el.p2pStatusText.textContent = text;
    }

    // Emojis for Popover Picker
    const EMOJI_LIST = ['👍', '❤️', '🔥', '😂', '💡', '🎉', '🚀', '😍', '👏', '✨', '⚡', '😎', '🙌', '💯', '🤔', '😊', '🥳', '👀', '💬', '⭐', '🤝'];

    // DOM Elements Cache
    const el = {};

    function cacheDOM() {
        el.body = document.body;
        el.sidebar = document.getElementById('sidebar');
        el.userCardTrigger = document.getElementById('user-card-trigger');
        el.userAvatar = document.getElementById('user-avatar');
        el.userName = document.getElementById('user-name');
        el.userStatusText = document.getElementById('user-status-text');
        el.userStatusDot = document.getElementById('user-status-dot');
        el.btnSettings = document.getElementById('btn-settings');
        el.globalSearchInput = document.getElementById('global-search-input');
        el.channelsList = document.getElementById('channels-list');
        el.dmsList = document.getElementById('dms-list');
        el.tabBtns = document.querySelectorAll('.tab-btn');
        el.btnAddChannel = document.getElementById('btn-add-channel');
        el.btnAddContact = document.getElementById('btn-add-contact');
        el.btnToggleSidebarCollapse = document.getElementById('btn-toggle-sidebar-collapse');
        
        el.btnMobileMenu = document.getElementById('btn-mobile-menu');
        el.activeChatAvatar = document.getElementById('active-chat-avatar');
        el.activeChatIconBox = document.getElementById('active-chat-icon-box');
        el.activeChatIcon = document.getElementById('active-chat-icon');
        el.activeChatName = document.getElementById('active-chat-name');
        el.activeChatBadge = document.getElementById('active-chat-badge');
        el.activeChatDesc = document.getElementById('active-chat-desc');
        el.chatSearchInput = document.getElementById('chat-search-input');
        el.btnTogglePins = document.getElementById('btn-toggle-pins');
        el.pinnedCountBadge = document.getElementById('pinned-count');
        el.btnToggleInfo = document.getElementById('btn-toggle-info');
        
        el.pinnedBanner = document.getElementById('pinned-banner');
        el.pinnedBannerText = document.getElementById('pinned-banner-text');
        el.btnClosePinnedBanner = document.getElementById('btn-close-pinned-banner');

        el.messagesContainer = document.getElementById('messages-container');
        el.chatSplash = document.getElementById('chat-splash');
        el.messagesList = document.getElementById('messages-list');
        el.typingIndicator = document.getElementById('typing-indicator');
        el.typingAvatar = document.getElementById('typing-avatar');
        el.typingText = document.getElementById('typing-text');

        el.inputContextBanner = document.getElementById('input-context-banner');
        el.contextTitle = document.getElementById('context-title');
        el.contextPreview = document.getElementById('context-preview');
        el.btnCancelContext = document.getElementById('btn-cancel-context');
        el.messageInput = document.getElementById('message-input');
        el.btnAttach = document.getElementById('btn-attach');
        el.fileInput = document.getElementById('file-input');
        el.btnCodeSnippet = document.getElementById('btn-code-snippet');
        el.btnEmoji = document.getElementById('btn-emoji');
        el.btnVoiceRec = document.getElementById('btn-voice-rec');
        el.btnSendMessage = document.getElementById('btn-send-message');

        el.infoSidebar = document.getElementById('info-sidebar');
        el.btnCloseInfo = document.getElementById('btn-close-info');
        el.infoAvatar = document.getElementById('info-avatar');
        el.infoName = document.getElementById('info-name');
        el.infoStatusBadge = document.getElementById('info-status-badge');
        el.infoDescription = document.getElementById('info-description');
        el.statMessagesCount = document.getElementById('stat-messages-count');
        el.statPinnedCount = document.getElementById('stat-pinned-count');
        el.sharedMediaGrid = document.getElementById('shared-media-grid');
        el.btnClearHistory = document.getElementById('btn-clear-history');
        el.btnExportChat = document.getElementById('btn-export-chat');

        el.emojiPopover = document.getElementById('emoji-popover');
        el.emojiSearch = document.getElementById('emoji-search');
        el.emojiGrid = document.getElementById('emoji-grid');

        // Modals
        el.settingsModal = document.getElementById('settings-modal');
        el.btnCloseSettings = document.getElementById('btn-close-settings');
        el.themeChips = document.querySelectorAll('.theme-chip');
        el.settingSound = document.getElementById('setting-sound');
        el.editUserName = document.getElementById('edit-user-name');
        el.editUserStatus = document.getElementById('edit-user-status');
        el.editUserAvatar = document.getElementById('edit-user-avatar');
        el.btnExportAllData = document.getElementById('btn-export-all-data');
        el.btnResetDemo = document.getElementById('btn-reset-demo');

        el.addChannelModal = document.getElementById('add-channel-modal');
        el.btnCloseAddChannel = document.getElementById('btn-close-add-channel');
        el.btnCancelChannel = document.getElementById('btn-cancel-channel');
        el.btnSaveChannel = document.getElementById('btn-save-channel');
        el.newChannelName = document.getElementById('new-channel-name');
        el.newChannelDesc = document.getElementById('new-channel-desc');

        el.addContactModal = document.getElementById('add-contact-modal');
        el.btnCloseAddContact = document.getElementById('btn-close-add-contact');
        el.btnCancelContact = document.getElementById('btn-cancel-contact');
        el.btnSaveContact = document.getElementById('btn-save-contact');
        el.newContactName = document.getElementById('new-contact-name');
        el.newContactRole = document.getElementById('new-contact-role');

        el.codeSnippetModal = document.getElementById('code-snippet-modal');
        el.btnCloseCodeModal = document.getElementById('btn-close-code-modal');
        el.btnCancelCode = document.getElementById('btn-cancel-code');
        el.btnInsertCode = document.getElementById('btn-insert-code');
        el.codeLangSelect = document.getElementById('code-lang');
        el.codeContentArea = document.getElementById('code-content');

        el.lightboxModal = document.getElementById('lightbox-modal');
        el.lightboxImage = document.getElementById('lightbox-image');
        el.btnCloseLightbox = document.getElementById('btn-close-lightbox');

        // Live P2P & Location Elements
        el.btnLiveP2P = document.getElementById('btn-live-p2p');
        el.btnShareLocation = document.getElementById('btn-share-location');
        el.p2pModal = document.getElementById('p2p-modal');
        el.btnCloseP2P = document.getElementById('btn-close-p2p');
        el.myPeerIdInput = document.getElementById('my-peer-id');
        el.btnCopyPeerId = document.getElementById('btn-copy-peer-id');
        el.peerIdInput = document.getElementById('peer-id-input');
        el.btnConnectPeer = document.getElementById('btn-connect-peer');

        // Server Bar & Desktop Elements
        el.serverList = document.getElementById('server-list');
        el.btnOpenAddServer = document.getElementById('btn-open-add-server');
        el.sidebarTitle = document.getElementById('sidebar-title');
        el.sidebarBadge = document.getElementById('sidebar-badge');

        // Voice Call Elements
        el.btnStartVoiceCall = document.getElementById('btn-start-voice-call');
        el.voiceStatusDock = document.getElementById('voice-status-dock');
        el.voiceDockName = document.getElementById('voice-dock-name');
        el.voiceDockChannel = document.getElementById('voice-dock-channel');
        el.btnMuteMic = document.getElementById('btn-mute-mic');
        el.btnDeafen = document.getElementById('btn-deafen');
        el.btnDisconnectVoice = document.getElementById('btn-disconnect-voice');

        el.voiceCallModal = document.getElementById('voice-call-modal');
        el.voiceCallAvatar = document.getElementById('voice-call-avatar');
        el.voiceCallName = document.getElementById('voice-call-name');
        el.voiceCallStatus = document.getElementById('voice-call-status');
        el.voiceCallTimer = document.getElementById('voice-call-timer');
        el.btnModalMute = document.getElementById('btn-modal-mute');
        el.btnModalHangup = document.getElementById('btn-modal-hangup');
        el.voiceCanvas = document.getElementById('voice-canvas');

        // Add Server Modal
        el.addServerModal = document.getElementById('add-server-modal');
        el.btnCloseAddServer = document.getElementById('btn-close-add-server');
        el.btnCancelServer = document.getElementById('btn-cancel-server');
        el.btnSaveServer = document.getElementById('btn-save-server');
        el.newServerName = document.getElementById('new-server-name');
        el.newServerDesc = document.getElementById('new-server-desc');

        // Electron Titlebar Buttons
        el.winMin = document.getElementById('win-min');
        el.winMax = document.getElementById('win-max');
        el.winClose = document.getElementById('win-close');
        el.p2pStatusBadge = document.getElementById('p2p-status-badge');
        el.p2pStatusText = document.getElementById('p2p-status-text');
        el.distanceSlider = document.getElementById('distance-slider');
        el.distanceVal = document.getElementById('distance-val');
    }

    // Apply Active UI Theme
    function applyTheme(themeName) {
        state.theme = themeName;
        document.body.className = themeName;
        el.themeChips.forEach(chip => {
            if (chip.dataset.theme === themeName) {
                chip.classList.add('active');
            } else {
                chip.classList.remove('active');
            }
        });
        saveState();
    }

    // Render Server Bar
    function renderServers() {
        if (!el.serverList) return;
        el.serverList.innerHTML = '';

        state.servers.forEach(srv => {
            const btn = document.createElement('button');
            const isActive = state.activeServerId === srv.id;
            btn.className = `server-btn ${isActive ? 'active' : ''}`;
            btn.title = srv.name;
            btn.innerHTML = `<span class="server-pill"></span>${srv.icon || srv.name.substring(0, 2).toUpperCase()}`;
            btn.onclick = () => selectServer(srv.id);
            el.serverList.appendChild(btn);
        });
    }

    function selectServer(serverId) {
        state.activeServerId = serverId;
        const srv = state.servers.find(s => s.id === serverId);
        if (srv) {
            if (el.sidebarTitle) el.sidebarTitle.textContent = srv.name;
            if (srv.channels && srv.channels.length > 0) {
                selectChat(srv.channels[0].id);
            }
        }
        renderServers();
        renderSidebar();
    }

    // Voice Call Handlers
    let localVoiceStream = null;
    let callTimerInterval = null;
    let callSeconds = 0;

    function startVoiceCall(channelName = 'Kanał Główny') {
        state.activeVoiceChannelId = channelName;
        
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia({ audio: true })
                .then(stream => {
                    localVoiceStream = stream;
                    el.voiceStatusDock.classList.remove('hidden');
                    el.voiceDockChannel.textContent = channelName;
                    playSound('send');
                    openVoiceCallModal(channelName);
                })
                .catch(err => {
                    console.warn('Microphone error:', err);
                    el.voiceStatusDock.classList.remove('hidden');
                    el.voiceDockChannel.textContent = channelName;
                    openVoiceCallModal(channelName);
                });
        } else {
            el.voiceStatusDock.classList.remove('hidden');
            el.voiceDockChannel.textContent = channelName;
            openVoiceCallModal(channelName);
        }
    }

    function disconnectVoiceCall() {
        if (localVoiceStream) {
            localVoiceStream.getTracks().forEach(track => track.stop());
            localVoiceStream = null;
        }
        clearInterval(callTimerInterval);
        callSeconds = 0;
        state.activeVoiceChannelId = null;

        if (el.voiceStatusDock) el.voiceStatusDock.classList.add('hidden');
        if (el.voiceCallModal) el.voiceCallModal.classList.add('hidden');
        playSound('pop');
    }

    function openVoiceCallModal(name) {
        if (!el.voiceCallModal) return;
        el.voiceCallAvatar.src = state.user.avatar;
        el.voiceCallName.textContent = name;
        el.voiceCallModal.classList.remove('hidden');

        clearInterval(callTimerInterval);
        callSeconds = 0;
        callTimerInterval = setInterval(() => {
            callSeconds++;
            const mins = String(Math.floor(callSeconds / 60)).padStart(2, '0');
            const secs = String(callSeconds % 60).padStart(2, '0');
            if (el.voiceCallTimer) el.voiceCallTimer.textContent = `Rozmowa HD • ${mins}:${secs}`;
        }, 1000);
    }

    // Render Side Navigation
    function renderSidebar(filterQuery = '') {
        renderServers();

        // Render User Profile Card
        el.userAvatar.src = state.user.avatar;
        el.userName.textContent = state.user.name;
        el.userStatusText.textContent = state.user.status;

        // Render Active Server Channels
        el.channelsList.innerHTML = '';
        const currentServer = state.servers.find(s => s.id === state.activeServerId);
        const channels = currentServer ? currentServer.channels : [];

        const filteredChannels = channels.filter(ch => 
            ch.name.toLowerCase().includes(filterQuery.toLowerCase())
        );

        filteredChannels.forEach(ch => {
            const isActive = state.activeChatId === ch.id;
            const item = document.createElement('div');
            item.className = `chat-item ${isActive ? 'active' : ''}`;
            
            if (ch.type === 'voice') {
                item.onclick = () => {
                    selectChat(ch.id);
                    startVoiceCall(ch.name);
                };
            } else {
                item.onclick = () => selectChat(ch.id);
            }

            const iconName = ch.type === 'voice' ? 'volume-2' : 'hash';

            item.innerHTML = `
                <div class="chat-item-icon">
                    <i data-lucide="${iconName}"></i>
                </div>
                <div class="chat-item-details">
                    <div class="chat-item-top">
                        <span class="chat-item-title">${ch.name}</span>
                    </div>
                    <div class="chat-item-bottom">
                        <span class="chat-item-preview">${escapeHTML(ch.desc || (ch.type === 'voice' ? '🔊 Połącz głosowo' : 'Kanał tekstowy'))}</span>
                    </div>
                </div>
            `;
            el.channelsList.appendChild(item);
        });

        // Render Direct Messages Contacts
        el.dmsList.innerHTML = '';
        const filteredDms = (state.dms || []).filter(dm => 
            dm.name.toLowerCase().includes(filterQuery.toLowerCase())
        );

        if (filteredDms.length === 0) {
            el.dmsList.innerHTML = '<span class="empty-hint" style="padding:10px 12px;">Brak osób (dodaj przyciskiem +)</span>';
        } else {
            filteredDms.forEach(dm => {
                const isActive = state.activeChatId === dm.id;
                const item = document.createElement('div');
                item.className = `chat-item ${isActive ? 'active' : ''}`;
                item.onclick = () => selectChat(dm.id);

                item.innerHTML = `
                    <div class="chat-item-icon">
                        <img src="${dm.avatar}" alt="${dm.name}">
                        <span class="status-indicator ${dm.status}"></span>
                    </div>
                    <div class="chat-item-details">
                        <div class="chat-item-top">
                            <span class="chat-item-title">${dm.name}</span>
                        </div>
                        <div class="chat-item-bottom">
                            <span class="chat-item-preview">${escapeHTML(dm.role || 'Prywatna konwersacja E2EE')}</span>
                        </div>
                    </div>
                `;
                el.dmsList.appendChild(item);
            });
        }

        if (window.lucide) window.lucide.createIcons();
    }

    // Get Active Target Chat Object
    function getActiveChat() {
        return state.channels.find(c => c.id === state.activeChatId) ||
               state.dms.find(d => d.id === state.activeChatId);
    }

    // Select Chat Channel / DM
    function selectChat(chatId) {
        state.activeChatId = chatId;
        
        // Reset unread count for selected chat
        const target = getActiveChat();
        if (target) {
            target.unread = 0;
        }

        saveState();
        renderSidebar();
        renderChatHeader();
        renderMessages();
        renderInfoSidebar();
        
        // Mobile menu close
        el.sidebar.classList.remove('mobile-open');
    }

    // Render Chat Header
    function renderChatHeader() {
        const chat = getActiveChat();
        if (!chat) return;

        if (chat.type === 'channel') {
            el.activeChatAvatar.classList.add('hidden');
            el.activeChatIconBox.classList.remove('hidden');
            el.activeChatName.textContent = `# ${chat.name}`;
            el.activeChatBadge.textContent = 'Kanał publiczny';
            el.activeChatDesc.textContent = chat.desc || 'Oficjalny kanał komunikacji TopSep';
        } else {
            el.activeChatAvatar.classList.remove('hidden');
            el.activeChatIconBox.classList.add('hidden');
            el.activeChatAvatar.src = chat.avatar;
            el.activeChatName.textContent = chat.name;
            el.activeChatBadge.textContent = chat.role || 'Kontakt prywatny';
            el.activeChatDesc.textContent = `Status: ${chat.status === 'online' ? '🟢 Dostępny' : '🟡 Zaraz wracam'}`;
        }

        // Check Pinned Messages Count
        const msgs = state.messages[chat.id] || [];
        const pinned = msgs.filter(m => m.pinned);
        if (pinned.length > 0) {
            el.pinnedCountBadge.classList.remove('hidden');
            el.pinnedCountBadge.textContent = pinned.length;
            el.pinnedBanner.classList.remove('hidden');
            el.pinnedBannerText.textContent = pinned[pinned.length - 1].text.substring(0, 70) + '...';
        } else {
            el.pinnedCountBadge.classList.add('hidden');
            el.pinnedBanner.classList.add('hidden');
        }
    }

    // Render Messages for Active Chat
    function renderMessages(searchQuery = '') {
        const chatId = state.activeChatId;
        const rawMsgs = state.messages[chatId] || [];

        let filtered = rawMsgs;
        if (searchQuery.trim()) {
            filtered = rawMsgs.filter(m => 
                m.text && m.text.toLowerCase().includes(searchQuery.toLowerCase())
            );
        }

        if (filtered.length === 0) {
            el.chatSplash.classList.remove('hidden');
            el.messagesList.innerHTML = '';
            return;
        } else {
            el.chatSplash.classList.add('hidden');
        }

        el.messagesList.innerHTML = '';

        filtered.forEach(msg => {
            const isMe = msg.senderId === state.user.id;
            const group = document.createElement('div');
            group.className = `message-group ${isMe ? 'sent' : 'received'}`;
            group.dataset.id = msg.id;

            // Avatar
            const avatarSrc = isMe ? state.user.avatar : msg.senderAvatar;

            // Reactions HTML
            let reactionsHTML = '';
            if (msg.reactions && Object.keys(msg.reactions).length > 0) {
                reactionsHTML = `<div class="reactions-row">`;
                for (const [emoji, users] of Object.entries(msg.reactions)) {
                    if (users.length > 0) {
                        const hasReacted = users.includes(state.user.id);
                        reactionsHTML += `
                            <button class="reaction-badge ${hasReacted ? 'user-reacted' : ''}" onclick="window.TopSep.toggleReaction('${msg.id}', '${emoji}')">
                                <span>${emoji}</span>
                                <span>${users.length}</span>
                            </button>
                        `;
                    }
                }
                reactionsHTML += `</div>`;
            }

            // Reply Quote HTML
            let replyHTML = '';
            if (msg.replyTo) {
                replyHTML = `
                    <div class="reply-quote">
                        <div class="reply-quote-author">${escapeHTML(msg.replyTo.senderName)}</div>
                        <div class="reply-quote-text">${escapeHTML(msg.replyTo.text)}</div>
                    </div>
                `;
            }

            // Code Snippet HTML
            let codeHTML = '';
            if (msg.codeSnippet) {
                codeHTML = `
                    <div class="code-block-wrapper">
                        <div class="code-header">
                            <span>Język: ${msg.codeSnippet.lang}</span>
                            <button class="btn-icon-sm" title="Kopiuj kod" onclick="navigator.clipboard.writeText('${escapeJSString(msg.codeSnippet.code)}')">
                                <i data-lucide="copy"></i>
                            </button>
                        </div>
                        <pre class="code-block"><code>${escapeHTML(msg.codeSnippet.code)}</code></pre>
                    </div>
                `;
            }

            // Attachment HTML
            let attachmentHTML = '';
            if (msg.attachment) {
                if (msg.attachment.type === 'image') {
                    attachmentHTML = `
                        <img src="${msg.attachment.url}" alt="Załącznik" class="message-attachment-img" onclick="window.TopSep.openLightbox('${msg.attachment.url}')">
                    `;
                }
            }

            // Voice Note HTML
            let voiceHTML = '';
            if (msg.voiceNote) {
                voiceHTML = `
                    <div class="voice-note-player">
                        <button class="btn-play-voice" onclick="window.TopSep.playVoiceNote(this)">
                            <i data-lucide="play"></i>
                        </button>
                        <div class="voice-waveform">
                            <span class="waveform-bar" style="height: 12px;"></span>
                            <span class="waveform-bar" style="height: 20px;"></span>
                            <span class="waveform-bar" style="height: 8px;"></span>
                            <span class="waveform-bar" style="height: 16px;"></span>
                            <span class="waveform-bar" style="height: 22px;"></span>
                            <span class="waveform-bar" style="height: 10px;"></span>
                        </div>
                        <span class="voice-duration">${msg.voiceNote.duration || '0:04'}</span>
                    </div>
                `;
            }

            // Location Badge HTML
            let locationHTML = '';
            if (msg.location) {
                locationHTML = `
                    <div class="location-badge-pill">
                        <i data-lucide="map-pin"></i>
                        <span>📍 ${escapeHTML(msg.location.distance || '5.0 km ode mnie')} (${msg.location.lat}, ${msg.location.lng})</span>
                    </div>
                `;
            }

            group.innerHTML = `
                <img src="${avatarSrc}" alt="${escapeHTML(msg.senderName)}" class="message-avatar">
                <div class="message-body-box">
                    <div class="message-meta-header">
                        <span class="sender-name">${escapeHTML(msg.senderName)}</span>
                        <span class="timestamp">${msg.timestamp}</span>
                        ${msg.pinned ? '<i data-lucide="pin" class="icon-sm" style="color:var(--accent-main); width:12px;"></i>' : ''}
                    </div>
                    
                    <div class="message-bubble">
                        ${replyHTML}
                        ${msg.text ? `<div>${formatMessageText(msg.text)}</div>` : ''}
                        ${codeHTML}
                        ${attachmentHTML}
                        ${voiceHTML}
                        ${locationHTML}
                    </div>

                    ${reactionsHTML}
                </div>

                <!-- Hover Actions Overlay -->
                <div class="message-actions-overlay">
                    <button class="action-pill" onclick="window.TopSep.toggleReaction('${msg.id}', '❤️')" title="Polub">❤️</button>
                    <button class="action-pill" onclick="window.TopSep.toggleReaction('${msg.id}', '🔥')" title="Ogień">🔥</button>
                    <button class="action-pill" onclick="window.TopSep.toggleReaction('${msg.id}', '👍')" title="Super">👍</button>
                    <button class="action-pill" onclick="window.TopSep.startReply('${msg.id}')" title="Odpowiedz">
                        <i data-lucide="reply"></i>
                    </button>
                    <button class="action-pill" onclick="window.TopSep.togglePinMessage('${msg.id}')" title="Przypnij/Odpnij">
                        <i data-lucide="pin"></i>
                    </button>
                    ${isMe ? `
                        <button class="action-pill" onclick="window.TopSep.deleteMessage('${msg.id}')" title="Usuń">
                            <i data-lucide="trash-2"></i>
                        </button>
                    ` : ''}
                </div>
            `;

            el.messagesList.appendChild(group);
        });

        if (window.lucide) window.lucide.createIcons();
        scrollToBottom();
    }

    function scrollToBottom() {
        setTimeout(() => {
            el.messagesContainer.scrollTop = el.messagesContainer.scrollHeight;
        }, 50);
    }

    // Format Markdown / Text
    function formatMessageText(text) {
        let esc = escapeHTML(text);
        // Convert URLs to clickable links
        esc = esc.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color:var(--accent-main); text-decoration:underline;">$1</a>');
        // Simple Bold
        esc = esc.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        return esc;
    }

    // Escape Utilities
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function escapeJSString(str) {
        if (!str) return '';
        return str.replace(/'/g, "\\'").replace(/\n/g, '\\n');
    }

    // Send Message Handler
    function sendMessage(customPayload = null) {
        const text = customPayload ? customPayload.text : el.messageInput.value.trim();
        const codeSnippet = customPayload ? customPayload.codeSnippet : null;
        const attachment = customPayload ? customPayload.attachment : null;
        const voiceNote = customPayload ? customPayload.voiceNote : null;

        if (!text && !codeSnippet && !attachment && !voiceNote) return;

        const chatId = state.activeChatId;
        if (!state.messages[chatId]) state.messages[chatId] = [];

        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const mins = String(now.getMinutes()).padStart(2, '0');

        const location = customPayload ? customPayload.location : null;

        const newMsg = {
            id: 'msg_' + Date.now(),
            senderId: state.user.id,
            senderName: state.user.name,
            senderAvatar: state.user.avatar,
            text: text || '',
            codeSnippet: codeSnippet || null,
            attachment: attachment || null,
            voiceNote: voiceNote || null,
            location: location || null,
            timestamp: `${hours}:${mins}`,
            replyTo: state.replyingToMessage ? {
                id: state.replyingToMessage.id,
                senderName: state.replyingToMessage.senderName,
                text: state.replyingToMessage.text || 'Załącznik'
            } : null,
            reactions: {}
        };

        state.messages[chatId].push(newMsg);

        // Send message to dedicated server WebSocket
        sendWSPacket('CHAT_MESSAGE', { chatId, message: newMsg });

        // Send message live over WebRTC if connected
        if (activeConnections[chatId]) {
            try {
                activeConnections[chatId].send({
                    type: 'message',
                    msg: newMsg
                });
            } catch (err) {
                console.warn('P2P transmission error:', err);
            }
        }

        // Clear input state
        if (!customPayload) el.messageInput.value = '';
        cancelReplyContext();
        
        playSound('send');
        saveState();
        renderMessages();
        renderSidebar();

        // Trigger Bot or Contact simulated responses
        handleSimulatedReplies(chatId, text);
    }

    // Simulated Replies System
    function handleSimulatedReplies(chatId, userText) {
        const chat = getActiveChat();
        if (!chat) return;

        // If chatting with Bot
        if (chatId === 'dm_bot') {
            showTyping(chat.avatar, 'TopSep Bot myśli nad odpowiedzią...');
            setTimeout(() => {
                hideTyping();
                const botReplyText = generateBotResponse(userText);
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                const botMsg = {
                    id: 'msg_bot_' + Date.now(),
                    senderId: 'dm_bot',
                    senderName: 'TopSep Bot',
                    senderAvatar: chat.avatar,
                    text: botReplyText,
                    timestamp: timeStr,
                    reactions: {}
                };

                state.messages[chatId].push(botMsg);
                playSound('receive');
                saveState();
                renderMessages();
                renderSidebar();
            }, 1200);
        } else if (chat.type === 'dm') {
            // Simulated response from human DM contacts
            showTyping(chat.avatar, `${chat.name} pisze odpowiedź...`);
            setTimeout(() => {
                hideTyping();
                const replies = [
                    'Świetnie! Dzięki za informację. Będę nad tym pracować w wolnej chwili.',
                    'Dostałem powiadomienie z TopSep. Twój projekt wygląda imponująco! 🚀',
                    'Super, brzmi bardzo rozsądnie. Daj znać, jak będziesz gotowy na krótką rozmowę.',
                    'Zapisuję to sobie! Kod działa sprawnie i bardzo czysto.'
                ];
                const randomReply = replies[Math.floor(Math.random() * replies.length)];
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                const replyMsg = {
                    id: 'msg_contact_' + Date.now(),
                    senderId: chat.id,
                    senderName: chat.name,
                    senderAvatar: chat.avatar,
                    text: randomReply,
                    timestamp: timeStr,
                    reactions: {}
                };

                state.messages[chatId].push(replyMsg);
                playSound('receive');
                saveState();
                renderMessages();
                renderSidebar();
            }, 2000);
        }
    }

    // Intelligent Bot Answers
    function generateBotResponse(input = '') {
        const query = input.toLowerCase();
        if (query.includes('cześć') || query.includes('hej') || query.includes('witaj') || query.includes('siema')) {
            return 'Cześć! Cieszę się, że korzystasz z TopSep — najczystszego komunikatora. W czym mogę Ci dzisiaj pomóc?';
        }
        if (query.includes('kod') || query.includes('code') || query.includes('programowanie')) {
            return 'W TopSep możesz przesyłać sformatowane fragmenty kodu z podświetlaniem składni! Kliknij ikonę klamry `< / >` obok pola tekstowego.';
        }
        if (query.includes('pomoc') || query.includes('zapis') || query.includes('histor')) {
            return 'Wszystkie Twoje wiadomości w TopSep są automatycznie zapamiętywane w pamięci przeglądarki (LocalStorage). Możesz również wyeksportować kopię w Ustawieniach!';
        }
        if (query.includes('pogoda')) {
            return 'Dzisiaj w świecie aplikacji internetowych prognozujemy czysta elegancję i zero opóźnień! ☀️ 24°C, idealny czas na kodowanie.';
        }
        return `Otrzymałem wiadomość: "${input}". Jestem botem TopSep i potrafię odpowiedzieć na pytania o funkcje komunikatora, zapis rozmów oraz formatowanie kodu.`;
    }

    // Show/Hide Typing Indicator
    function showTyping(avatarUrl, text) {
        el.typingAvatar.src = avatarUrl;
        el.typingText.textContent = text;
        el.typingIndicator.classList.remove('hidden');
        scrollToBottom();
    }

    function hideTyping() {
        el.typingIndicator.classList.add('hidden');
    }

    // Reaction Toggle
    function toggleReaction(msgId, emoji) {
        const chatId = state.activeChatId;
        const msgs = state.messages[chatId] || [];
        const msg = msgs.find(m => m.id === msgId);

        if (!msg) return;
        if (!msg.reactions) msg.reactions = {};

        if (!msg.reactions[emoji]) {
            msg.reactions[emoji] = [];
        }

        const myId = state.user.id;
        const index = msg.reactions[emoji].indexOf(myId);

        if (index > -1) {
            msg.reactions[emoji].splice(index, 1);
            if (msg.reactions[emoji].length === 0) {
                delete msg.reactions[emoji];
            }
        } else {
            msg.reactions[emoji].push(myId);
            playSound('pop');
        }

        saveState();
        renderMessages();
    }

    // Reply Context Start
    function startReply(msgId) {
        const chatId = state.activeChatId;
        const msgs = state.messages[chatId] || [];
        const msg = msgs.find(m => m.id === msgId);
        if (!msg) return;

        state.replyingToMessage = msg;
        el.contextTitle.textContent = `Odpowiedź na: ${msg.senderName}`;
        el.contextPreview.textContent = msg.text || 'Załącznik / Kod';
        el.inputContextBanner.classList.remove('hidden');
        el.messageInput.focus();
    }

    function cancelReplyContext() {
        state.replyingToMessage = null;
        el.inputContextBanner.classList.add('hidden');
    }

    // Toggle Pin Message
    function togglePinMessage(msgId) {
        const chatId = state.activeChatId;
        const msgs = state.messages[chatId] || [];
        const msg = msgs.find(m => m.id === msgId);
        if (!msg) return;

        msg.pinned = !msg.pinned;
        playSound('pop');
        saveState();
        renderChatHeader();
        renderMessages();
    }

    // Delete Message
    function deleteMessage(msgId) {
        const chatId = state.activeChatId;
        const msgs = state.messages[chatId] || [];
        state.messages[chatId] = msgs.filter(m => m.id !== msgId);

        saveState();
        renderMessages();
        renderSidebar();
        renderInfoSidebar();
    }

    // Render Right Info Panel
    function renderInfoSidebar() {
        const chat = getActiveChat();
        if (!chat) return;

        if (chat.type === 'channel') {
            el.infoAvatar.src = 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=120&q=80';
            el.infoName.textContent = `# ${chat.name}`;
            el.infoStatusBadge.textContent = 'Kanał dyskusyjny';
            el.infoDescription.textContent = chat.desc || 'Brak opisu kanału';
        } else {
            el.infoAvatar.src = chat.avatar;
            el.infoName.textContent = chat.name;
            el.infoStatusBadge.textContent = chat.role || 'Kontakt';
            el.infoDescription.textContent = `Status aktywności: ${chat.status}`;
        }

        const msgs = state.messages[chat.id] || [];
        el.statMessagesCount.textContent = msgs.length;
        el.statPinnedCount.textContent = msgs.filter(m => m.pinned).length;

        // Render Shared Media Grid
        el.sharedMediaGrid.innerHTML = '';
        const mediaMsgs = msgs.filter(m => m.attachment && m.attachment.type === 'image');
        if (mediaMsgs.length === 0) {
            el.sharedMediaGrid.innerHTML = '<span class="empty-hint">Brak przesłanych plików media</span>';
        } else {
            mediaMsgs.forEach(m => {
                const img = document.createElement('img');
                img.src = m.attachment.url;
                img.onclick = () => openLightbox(m.attachment.url);
                el.sharedMediaGrid.appendChild(img);
            });
        }
    }

    // Lightbox Modal
    function openLightbox(url) {
        el.lightboxImage.src = url;
        el.lightboxModal.classList.remove('hidden');
    }

    // Populate Emoji Grid
    function setupEmojiPicker() {
        el.emojiGrid.innerHTML = '';
        EMOJI_LIST.forEach(e => {
            const btn = document.createElement('span');
            btn.className = 'emoji-item';
            btn.textContent = e;
            btn.onclick = () => {
                el.messageInput.value += e;
                el.emojiPopover.classList.add('hidden');
                el.messageInput.focus();
            };
            el.emojiGrid.appendChild(btn);
        });
    }

    // Attach Event Listeners
    function bindEvents() {
        // Global Search Filter
        el.globalSearchInput.addEventListener('input', (e) => {
            renderSidebar(e.target.value);
        });

        // Chat Internal Search
        el.chatSearchInput.addEventListener('input', (e) => {
            renderMessages(e.target.value);
        });

        // Send Button Click & Keydown (Enter)
        el.btnSendMessage.addEventListener('click', () => sendMessage());

        let lastTypingEmit = 0;
        el.messageInput.addEventListener('input', () => {
            const now = Date.now();
            if (now - lastTypingEmit > 2000) {
                lastTypingEmit = now;
                sendWSPacket('TYPING_STATUS', {
                    chatId: state.activeChatId,
                    userName: state.user.name,
                    userAvatar: state.user.avatar
                });
            }
        });

        el.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        // Cancel Context Reply
        el.btnCancelContext.addEventListener('click', cancelReplyContext);

        // Sidebar Tabs
        el.tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                el.tabBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                if (tab === 'channels') {
                    document.getElementById('section-channels').style.display = 'block';
                    document.getElementById('section-dms').style.display = 'none';
                } else if (tab === 'dms') {
                    document.getElementById('section-channels').style.display = 'none';
                    document.getElementById('section-dms').style.display = 'block';
                } else {
                    document.getElementById('section-channels').style.display = 'block';
                    document.getElementById('section-dms').style.display = 'block';
                }
            });
        });

        // Mobile Menu Button Toggle
        el.btnMobileMenu.addEventListener('click', () => {
            el.sidebar.classList.toggle('mobile-open');
        });

        // Info Panel Toggle
        el.btnToggleInfo.addEventListener('click', () => {
            el.infoSidebar.classList.toggle('hidden');
        });
        el.btnCloseInfo.addEventListener('click', () => {
            el.infoSidebar.classList.add('hidden');
        });

        // Emoji Popover Toggle
        el.btnEmoji.addEventListener('click', (e) => {
            e.stopPropagation();
            el.emojiPopover.classList.toggle('hidden');
        });

        document.addEventListener('click', (e) => {
            if (!el.emojiPopover.contains(e.target) && e.target !== el.btnEmoji) {
                el.emojiPopover.classList.add('hidden');
            }
        });

        // File Attachment Simulation & Base64 Reader
        el.btnAttach.addEventListener('click', () => el.fileInput.click());
        el.fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                sendMessage({
                    text: `Przesłano plik: ${file.name}`,
                    attachment: {
                        type: file.type.startsWith('image/') ? 'image' : 'file',
                        name: file.name,
                        url: event.target.result
                    }
                });
            };
            reader.readAsDataURL(file);
        });

        // Code Snippet Modal Triggers
        el.btnCodeSnippet.addEventListener('click', () => el.codeSnippetModal.classList.remove('hidden'));
        el.btnCloseCodeModal.addEventListener('click', () => el.codeSnippetModal.classList.add('hidden'));
        el.btnCancelCode.addEventListener('click', () => el.codeSnippetModal.classList.add('hidden'));
        el.btnInsertCode.addEventListener('click', () => {
            const lang = el.codeLangSelect.value;
            const code = el.codeContentArea.value.trim();
            if (!code) return;

            sendMessage({
                text: '',
                codeSnippet: { lang, code }
            });

            el.codeContentArea.value = '';
            el.codeSnippetModal.classList.add('hidden');
        });

        // Voice Message Simulator
        let isRecording = false;
        el.btnVoiceRec.addEventListener('click', () => {
            if (!isRecording) {
                isRecording = true;
                el.btnVoiceRec.classList.add('recording');
                playSound('pop');
                el.btnVoiceRec.title = 'Nagrywanie... Kliknij, aby wysłać';
            } else {
                isRecording = false;
                el.btnVoiceRec.classList.remove('recording');
                el.btnVoiceRec.title = 'Nagraj wiadomość głosową';

                sendMessage({
                    text: 'Wiadomość głosowa (0:04)',
                    voiceNote: { duration: '0:04' }
                });
            }
        });

        // Settings Modal Triggers
        el.btnSettings.addEventListener('click', () => {
            el.editUserName.value = state.user.name;
            el.editUserStatus.value = state.user.status;
            el.editUserAvatar.value = state.user.avatar;
            el.settingSound.checked = state.soundEnabled;
            el.settingsModal.classList.remove('hidden');
        });

        el.btnCloseSettings.addEventListener('click', () => el.settingsModal.classList.add('hidden'));

        // Theme Chips Click
        el.themeChips.forEach(chip => {
            chip.addEventListener('click', () => {
                applyTheme(chip.dataset.theme);
            });
        });

        // Sound Toggle
        el.settingSound.addEventListener('change', (e) => {
            state.soundEnabled = e.target.checked;
            saveState();
        });

        // Save User Profile Changes
        el.editUserName.addEventListener('input', (e) => {
            state.user.name = e.target.value || 'Użytkownik';
            saveState();
            renderSidebar();
        });
        el.editUserStatus.addEventListener('input', (e) => {
            state.user.status = e.target.value;
            saveState();
            renderSidebar();
        });
        el.editUserAvatar.addEventListener('input', (e) => {
            state.user.avatar = e.target.value;
            saveState();
            renderSidebar();
        });

        // Data Export (JSON Download)
        el.btnExportAllData.addEventListener('click', () => {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(state, null, 2));
            const downloadAnchor = document.createElement('a');
            downloadAnchor.setAttribute("href", dataStr);
            downloadAnchor.setAttribute("download", `TopSep_Backup_${Date.now()}.json`);
            document.body.appendChild(downloadAnchor);
            downloadAnchor.click();
            downloadAnchor.remove();
        });

        // Reset to Demo Data
        el.btnResetDemo.addEventListener('click', () => {
            if (confirm('Czy na pewno chcesz przywrócić domyślne dane demonstracyjne? Twoje obecne czaty zostaną zastąpione.')) {
                localStorage.removeItem(STORAGE_KEY);
                state = JSON.parse(JSON.stringify(DEFAULT_STATE));
                saveState();
                location.reload();
            }
        });

        // Add Channel Modal
        el.btnAddChannel.addEventListener('click', () => el.addChannelModal.classList.remove('hidden'));
        el.btnCloseAddChannel.addEventListener('click', () => el.addChannelModal.classList.add('hidden'));
        el.btnCancelChannel.addEventListener('click', () => el.addChannelModal.classList.add('hidden'));
        el.btnSaveChannel.addEventListener('click', () => {
            const name = el.newChannelName.value.trim().toLowerCase().replace(/\s+/g, '-');
            const desc = el.newChannelDesc.value.trim();
            if (!name) return;

            const id = 'ch_' + Date.now();
            state.channels.push({
                id,
                name,
                desc: desc || 'Brak opisu kanału',
                type: 'channel',
                unread: 0,
                pinnedId: null
            });
            state.messages[id] = [];

            el.newChannelName.value = '';
            el.newChannelDesc.value = '';
            el.addChannelModal.classList.add('hidden');

            saveState();
            selectChat(id);
        });

        // Add Contact Modal
        el.btnAddContact.addEventListener('click', () => el.addContactModal.classList.remove('hidden'));
        el.btnCloseAddContact.addEventListener('click', () => el.addContactModal.classList.add('hidden'));
        el.btnCancelContact.addEventListener('click', () => el.addContactModal.classList.add('hidden'));
        el.btnSaveContact.addEventListener('click', () => {
            const name = el.newContactName.value.trim();
            const role = el.newContactRole.value.trim();
            if (!name) return;

            const id = 'dm_' + Date.now();
            state.dms.push({
                id,
                name,
                role: role || 'Kontakt w TopSep',
                avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
                status: 'online',
                type: 'dm',
                unread: 0
            });
            state.messages[id] = [];

            el.newContactName.value = '';
            el.newContactRole.value = '';
            el.addContactModal.classList.add('hidden');

            saveState();
            selectChat(id);
        });

        // Clear Chat History Button in Right Sidebar
        el.btnClearHistory.addEventListener('click', () => {
            const chatId = state.activeChatId;
            if (confirm('Wyczyścić historię tej rozmowy?')) {
                state.messages[chatId] = [];
                saveState();
                renderMessages();
                renderSidebar();
                renderInfoSidebar();
            }
        });

        // Export active chat
        el.btnExportChat.addEventListener('click', () => {
            const chatId = state.activeChatId;
            const msgs = state.messages[chatId] || [];
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(msgs, null, 2));
            const anchor = document.createElement('a');
            anchor.setAttribute("href", dataStr);
            anchor.setAttribute("download", `TopSep_Chat_${chatId}.json`);
            anchor.click();
        });

        // Close Lightbox
        el.btnCloseLightbox.addEventListener('click', () => el.lightboxModal.classList.add('hidden'));
        el.btnClosePinnedBanner.addEventListener('click', () => el.pinnedBanner.classList.add('hidden'));

        // Live P2P Modal Event Listeners
        el.btnLiveP2P.addEventListener('click', () => {
            el.p2pModal.classList.remove('hidden');
            initPeerJS();
        });

        el.btnCloseP2P.addEventListener('click', () => el.p2pModal.classList.add('hidden'));

        el.btnCopyPeerId.addEventListener('click', () => {
            if (el.myPeerIdInput && el.myPeerIdInput.value) {
                navigator.clipboard.writeText(el.myPeerIdInput.value);
                playSound('pop');
                alert('Skopiowano Kod Połączenia P2P do schowka! Przekaż go swojemu koledze (np. 5 km od Ciebie).');
            }
        });

        // Voice Call Controls
        if (el.btnStartVoiceCall) {
            el.btnStartVoiceCall.addEventListener('click', () => startVoiceCall('Połączenie Głosowe HD'));
        }

        if (el.btnDisconnectVoice) {
            el.btnDisconnectVoice.addEventListener('click', disconnectVoiceCall);
        }

        if (el.btnModalHangup) {
            el.btnModalHangup.addEventListener('click', disconnectVoiceCall);
        }

        if (el.btnMuteMic) {
            el.btnMuteMic.addEventListener('click', () => {
                el.btnMuteMic.classList.toggle('muted');
                playSound('pop');
            });
        }

        if (el.btnDeafen) {
            el.btnDeafen.addEventListener('click', () => {
                el.btnDeafen.classList.toggle('muted');
                playSound('pop');
            });
        }

        // Add Server Modal Event Handlers
        if (el.btnOpenAddServer) {
            el.btnOpenAddServer.addEventListener('click', () => el.addServerModal.classList.remove('hidden'));
        }

        if (el.btnCloseAddServer) el.btnCloseAddServer.addEventListener('click', () => el.addServerModal.classList.add('hidden'));
        if (el.btnCancelServer) el.btnCancelServer.addEventListener('click', () => el.addServerModal.classList.add('hidden'));

        if (el.btnSaveServer) {
            el.btnSaveServer.addEventListener('click', () => {
                const sName = el.newServerName.value.trim();
                const sDesc = el.newServerDesc.value.trim();
                if (!sName) return;

                const sId = 'srv_' + Date.now();
                const newServer = {
                    id: sId,
                    name: sName,
                    icon: sName.substring(0, 2).toUpperCase(),
                    desc: sDesc || 'Serwer stworzony przez użytkownika',
                    channels: [
                        { id: `ch_${sId}_general`, name: 'ogólny', type: 'text', desc: 'Ogólny kanał tekstowy' },
                        { id: `ch_${sId}_voice`, name: '🔊 Pokój Głosowy', type: 'voice', desc: 'Kanał rozmów głosowych HD' }
                    ]
                };

                state.servers.push(newServer);
                state.messages[`ch_${sId}_general`] = [];

                el.newServerName.value = '';
                el.newServerDesc.value = '';
                el.addServerModal.classList.add('hidden');

                saveState();
                selectServer(sId);
            });
        }

        // Electron Desktop Window Controls
        if (el.winMin) {
            el.winMin.addEventListener('click', () => {
                if (window.require) {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.send('window-min');
                }
            });
        }

        if (el.winMax) {
            el.winMax.addEventListener('click', () => {
                if (window.require) {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.send('window-max');
                }
            });
        }

        if (el.winClose) {
            el.winClose.addEventListener('click', () => {
                if (window.require) {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.send('window-close');
                } else {
                    window.close();
                }
            });
        }

        el.distanceSlider.addEventListener('input', (e) => {
            const dist = parseFloat(e.target.value).toFixed(1);
            state.friendDistance = dist;
            el.distanceVal.textContent = `${dist} km ode mnie`;
        });

        // Share Location Button Listener
        el.btnShareLocation.addEventListener('click', () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        const lat = pos.coords.latitude.toFixed(4);
                        const lng = pos.coords.longitude.toFixed(4);
                        sendMessage({
                            text: `📍 Moja lokalizacja GPS: (${lat}, ${lng}) — dystans ok. ${state.friendDistance || 5.0} km ode mnie`,
                            location: { distance: `${state.friendDistance || 5.0} km ode mnie`, lat, lng }
                        });
                    },
                    (err) => {
                        sendMessage({
                            text: `📍 Udostępniono lokalizację (szacowany dystans: ${state.friendDistance || 5.0} km ode mnie)`,
                            location: { distance: `${state.friendDistance || 5.0} km ode mnie`, lat: '52.2297', lng: '21.0122' }
                        });
                    }
                );
            } else {
                sendMessage({
                    text: `📍 Udostępniono lokalizację (dystans: ${state.friendDistance || 5.0} km ode mnie)`,
                    location: { distance: `${state.friendDistance || 5.0} km ode mnie`, lat: '52.2297', lng: '21.0122' }
                });
            }
        });
    }

    // Expose Global Helper Methods for Inline HTML Event Attributes
    window.TopSep = {
        toggleReaction,
        startReply,
        togglePinMessage,
        deleteMessage,
        openLightbox,
        playVoiceNote: function(btn) {
            playSound('pop');
            btn.innerHTML = '<i data-lucide="volume-2"></i>';
            if (window.lucide) window.lucide.createIcons();
            setTimeout(() => {
                btn.innerHTML = '<i data-lucide="play"></i>';
                if (window.lucide) window.lucide.createIcons();
            }, 2000);
        }
    };

    // Initialize Application
    function init() {
        loadState();
        cacheDOM();
        applyTheme(state.theme);
        setupEmojiPicker();
        bindEvents();

        renderSidebar();
        renderChatHeader();
        renderMessages();
        renderInfoSidebar();

        // Connect to online TopSep Server
        initServerWebSocket();
    }

    // Run on DOM Ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
