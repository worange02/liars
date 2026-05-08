(function initRuntimeConfig(global){
    const BASE_URL = 'https://worange02.github.io/liars/';
    const SUITS = ['♠','♥','♦','♣'];
    const RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const RED_SUITS = new Set(['♥','♦']);
    const REMOTE_ONLINE_STORAGE_KEY = 'lg_enable_remote_online';
    const CUSTOM_TURN_STORAGE_KEY = 'lg_custom_turn_config';
    
    // 多 TURN 服务器池（国内外都有）
    const TURN_SERVERS_POOL = [
        {
            name: 'Metered Global',
            urls: [
                'turn:global.relay.metered.ca:80',
                'turn:global.relay.metered.ca:80?transport=tcp',
                'turns:global.relay.metered.ca:443?transport=tcp'
            ],
            username: '9e2e5450e6f05266678650e7',
            credential: 'zwo+0bAQys8L6Zsl'
        },
        {
            name: 'Open Relay',
            urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443'],
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            name: 'Google STUN Only',
            urls: [],
            username: '',
            credential: ''
        }
    ];
    
    const DEFAULT_NET_CONFIG = {
        maxPlayers: 8,
        heartbeatIntervalMs: 10000,
        heartbeatTimeoutMs: 30000,
        connectTimeoutMs: 8000,
        challengeWindowMs: 100,
        peerDebug: 0,
        remoteOnlineEnabled: true,  // 默认开启远程联机
        hostUseTurnIfConfigured: true,
        ice: {
            stun: [{ urls: 'stun:stun.l.google.com:19302' }]
        },
        turn: TURN_SERVERS_POOL[0]  // 默认使用 Metered
    };

    function _readRuntimeNetConfig(){
        let fromStorage={};
        try{
            const raw=localStorage.getItem('lg_net_config');
            if(raw) fromStorage=JSON.parse(raw)||{};
        }catch(e){}
        const fromWindow=(typeof window!=='undefined'&&window.__LG_NET_CONFIG__&&typeof window.__LG_NET_CONFIG__==='object')
            ? window.__LG_NET_CONFIG__ : {};
        const merged={...DEFAULT_NET_CONFIG,...fromStorage,...fromWindow};
        merged.ice={
            ...DEFAULT_NET_CONFIG.ice,
            ...(fromStorage.ice||{}),
            ...(fromWindow.ice||{})
        };
        merged.turn={
            ...DEFAULT_NET_CONFIG.turn,
            ...(fromStorage.turn||{}),
            ...(fromWindow.turn||{})
        };
        return merged;
    }

    const NET_CONFIG = _readRuntimeNetConfig();

    function _readRemoteOnlineEnabled(){
        try{ 
            const val = localStorage.getItem(REMOTE_ONLINE_STORAGE_KEY);
            // 默认开启远程联机
            return val === null ? true : val === 'true';
        } catch(e){ 
            return true;
        }
    }

    function _setRemoteOnlineEnabled(enabled){
        NET_CONFIG.remoteOnlineEnabled = !!enabled;
        try{ localStorage.setItem(REMOTE_ONLINE_STORAGE_KEY, enabled); }catch(e){}
    }

    function _normalizeTurnUrls(raw){
        if(Array.isArray(raw)) return raw.map(v=>String(v||'').trim()).filter(Boolean);
        return String(raw||'').split(/[\n,]+/).map(v=>v.trim()).filter(Boolean);
    }

    function _readCustomTurnConfig(){
        try{
            const raw=localStorage.getItem(CUSTOM_TURN_STORAGE_KEY);
            if(!raw) return null;
            const cfg=JSON.parse(raw)||{};
            return {
                urls:_normalizeTurnUrls(cfg.urls),
                username:String(cfg.username||'').trim(),
                credential:String(cfg.credential||'').trim()
            };
        }catch(e){
            return null;
        }
    }

    function _setCustomTurnConfig(cfg){
        try{
            localStorage.setItem(CUSTOM_TURN_STORAGE_KEY,JSON.stringify({
                urls:_normalizeTurnUrls(cfg?.urls),
                username:String(cfg?.username||'').trim(),
                credential:String(cfg?.credential||'').trim()
            }));
        }catch(e){}
    }

    function _clearCustomTurnConfig(){
        try{ localStorage.removeItem(CUSTOM_TURN_STORAGE_KEY); }catch(e){}
    }

    // 获取有效的 TURN 配置（自动选择最佳）
    function _getEffectiveTurnConfig(){
        const c=_readCustomTurnConfig();
        if(c&&c.urls?.length&&c.username&&c.credential) return c;
        // 从池中选择第一个可用的
        return TURN_SERVERS_POOL[0];
    }

    function _isCustomTurnConfigActive(){
        const c=_readCustomTurnConfig();
        return !!(c&&c.urls?.length&&c.username&&c.credential);
    }

    function _getRoomMaxPlayers(){
        if(!NET_CONFIG.remoteOnlineEnabled) return 9;
        return _isCustomTurnConfigActive()?9:6;
    }

    NET_CONFIG.remoteOnlineEnabled=_readRemoteOnlineEnabled();

    const HEARTBEAT_INTERVAL = NET_CONFIG.heartbeatIntervalMs;
    const HEARTBEAT_TIMEOUT = NET_CONFIG.heartbeatTimeoutMs;
    const CHALLENGE_WINDOW_MS = NET_CONFIG.challengeWindowMs;
    const DECK_COLORS = [
        { primary:'#B8453A', symbol:'●' },
        { primary:'#4A7C96', symbol:'◆' },
        { primary:'#6B7F4E', symbol:'▲' },
    ];

    global.LG_RUNTIME_CONFIG = {
        BASE_URL,
        SUITS,
        RANKS,
        RED_SUITS,
        REMOTE_ONLINE_STORAGE_KEY,
        CUSTOM_TURN_STORAGE_KEY,
        DEFAULT_NET_CONFIG,
        NET_CONFIG,
        TURN_SERVERS_POOL,
        HEARTBEAT_INTERVAL,
        HEARTBEAT_TIMEOUT,
        CHALLENGE_WINDOW_MS,
        DECK_COLORS,
        _readRuntimeNetConfig,
        _readRemoteOnlineEnabled,
        _setRemoteOnlineEnabled,
        _normalizeTurnUrls,
        _readCustomTurnConfig,
        _setCustomTurnConfig,
        _clearCustomTurnConfig,
        _getEffectiveTurnConfig,
        _isCustomTurnConfigActive,
        _getRoomMaxPlayers,
    };
})(window);