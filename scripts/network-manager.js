(function initNetworkManager(global){
    class NetworkManager {
        constructor(){
            this.peer=null; this.connections=new Map();
            this.isHost=false; this.hostPeerId=null; this.hostConn=null;
            this.myPeerId=null; this.roomCode=''; this.handlers={};
            this.heartbeatTimer=null; this.onPeerConnect=null; this.onPeerDisconnect=null;
            this.destroyed=false; this._lastHostHB=0;
            this._pendingTurnConfig = null;  // 临时 TURN 配置
            this._reconnectAttempts = 0;
        }
        _pid(code){ return 'lg-'+code; }
        _hasTurnConfig(){
            if(!NET_CONFIG.remoteOnlineEnabled) return false;
            const t=_getEffectiveTurnConfig();
            return !!(t.urls&&t.urls.length&&t.username&&t.credential);
        }
        _peerOptions(useTurn=false){
            const stun=(NET_CONFIG.ice?.stun||[]).map(s=>({ ...s }));
            const servers=[...stun];
            if(useTurn&&this._hasTurnConfig()){
                const t=_getEffectiveTurnConfig();
                servers.push({
                    urls: t.urls,
                    username: t.username,
                    credential: t.credential
                });
            }
            // 如果使用了临时 TURN 配置
            if(this._pendingTurnConfig && this._pendingTurnConfig.urls?.length) {
                servers.push({
                    urls: this._pendingTurnConfig.urls,
                    username: this._pendingTurnConfig.username,
                    credential: this._pendingTurnConfig.credential
                });
                this._pendingTurnConfig = null;
            }
            return { debug:NET_CONFIG.peerDebug, config:{ iceServers:servers } };
        }

        // 尝试不同的连接方式
        async joinRoom(code){
            this.isHost=false;
            this.roomCode=code.toUpperCase();
            const hpid=this._pid(this.roomCode);
            this.hostPeerId=hpid;
            
            // 依次尝试不同的连接方式
            const connectionAttempts = [
                { name: 'STUN only', useTurn: false, customTurn: null },
                { name: 'Default TURN', useTurn: true, customTurn: null },
                { name: 'Metered TURN', useTurn: true, customTurn: TURN_SERVERS_POOL[0] },
                { name: 'Open Relay TURN', useTurn: true, customTurn: TURN_SERVERS_POOL[1] }
            ];
            
            let lastError = null;
            for (let i = 0; i < connectionAttempts.length; i++) {
                const attempt = connectionAttempts[i];
                try {
                    if (attempt.customTurn) {
                        this._pendingTurnConfig = attempt.customTurn;
                    }
                    await this._doJoin(code, attempt.useTurn);
                    console.log(`[Network] Connected using ${attempt.name}`);
                    this._reconnectAttempts = 0;
                    return;
                } catch (e) {
                    lastError = e;
                    console.warn(`[Network] ${attempt.name} failed:`, e);
                    await this._delay(1000 * (i + 1));
                }
            }
            throw lastError || new Error('所有连接方式都失败');
        }

        async _doJoin(code, useTurn) {
            return new Promise((res, rej) => {
                const timeout = setTimeout(() => rej(new Error('连接超时')), NET_CONFIG.connectTimeoutMs);
                
                const options = this._peerOptions(useTurn);
                this.peer = new Peer(undefined, options);
                
                this.peer.on('open', id => {
                    this.myPeerId = id;
                    const conn = this.peer.connect(this.hostPeerId, { reliable: true });
                    
                    conn.on('open', () => {
                        clearTimeout(timeout);
                        this.hostConn = conn;
                        this._setupHostConn(conn);
                        this._startHB();
                        res();
                    });
                    
                    conn.on('error', (e) => {
                        clearTimeout(timeout);
                        rej(e);
                    });
                    
                    // 额外超时保护
                    setTimeout(() => {
                        if (conn.open === false) {
                            rej(new Error('连接建立超时'));
                        }
                    }, 5000);
                });
                
                this.peer.on('error', (e) => {
                    clearTimeout(timeout);
                    rej(e);
                });
                
                this.peer.on('disconnected', () => {
                    if (!this.destroyed) {
                        this._scheduleReconnect();
                    }
                });
            });
        }

        _delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        _scheduleReconnect() {
            if (this._reconnectTimer) return;
            this._reconnectTimer = setTimeout(async () => {
                this._reconnectTimer = null;
                if (this.destroyed) return;
                
                this._reconnectAttempts++;
                const delay = Math.min(30000, 1000 * Math.pow(2, this._reconnectAttempts));
                
                try {
                    await this.reconnect();
                } catch (e) {
                    console.error('[Network] Reconnect failed:', e);
                    if (this._reconnectAttempts < 5) {
                        this._scheduleReconnect();
                    } else if (this.onPeerDisconnect) {
                        this.onPeerDisconnect(this.hostPeerId);
                    }
                }
            }, 2000);
        }

        async reconnect() {
            if (this.destroyed || !this.roomCode) return;
            const oldHostId = this.hostPeerId;
            await this.joinRoom(this.roomCode);
            if (this.onPeerConnect && oldHostId) {
                this.onPeerConnect(oldHostId, this.hostConn);
            }
        }

        async createRoom(){
            this.isHost=true; this.roomCode=mkRoomCode();
            const pid=this._pid(this.roomCode);
            return new Promise((res,rej)=>{
                this.peer=new Peer(pid,this._peerOptions(!!NET_CONFIG.hostUseTurnIfConfigured));
                this.peer.on('open',id=>{
                    this.myPeerId=id; this.hostPeerId=id;
                    this.peer.on('connection',c=>this._setupConn(c));
                    this._startHB(); 
                    res(this.roomCode);
                });
                this.peer.on('error',e=>{
                    if(e.type==='unavailable-id') rej(new Error('房间号冲突，请重试'));
                    else rej(e);
                });
                this.peer.on('disconnected',()=>{ if(!this.destroyed) this.peer.reconnect(); });
            });
        }

        _setupConn(conn){
            const pid=conn.peer;
            conn.on('open',()=>{
                this.connections.set(pid,{conn,lastHB:Date.now()});
                if(this.onPeerConnect) this.onPeerConnect(pid,conn);
            });
            conn.on('data',d=>{
                if(d&&d.type==='HEARTBEAT'){const e=this.connections.get(pid);if(e)e.lastHB=Date.now();return;}
                this._dispatch(d,pid);
            });
            conn.on('close',()=>{
                this.connections.delete(pid);
                if(this.onPeerDisconnect) this.onPeerDisconnect(pid);
            });
            conn.on('error',()=>{});
        }

        _setupHostConn(conn){
            conn.on('data',d=>{
                if(d&&d.type==='HEARTBEAT'){this._lastHostHB=Date.now();return;}
                this._dispatch(d,conn.peer);
            });
            conn.on('close',()=>{
                if(this.onPeerDisconnect) this.onPeerDisconnect(this.hostPeerId);
            });
            this._lastHostHB=Date.now();
        }

        send(pid,msg){
            if(this.isHost){const e=this.connections.get(pid);if(e&&e.conn.open)e.conn.send(msg);}
            else if(this.hostConn&&this.hostConn.open) this.hostConn.send(msg);
        }
        sendToHost(msg){
            if(this.isHost) this._dispatch(msg,this.myPeerId);
            else if(this.hostConn&&this.hostConn.open) this.hostConn.send(msg);
        }
        broadcast(msg){for(const[,e]of this.connections)if(e.conn.open)e.conn.send(msg);}
        broadcastAndSelf(msg){this.broadcast(msg);this._dispatch(msg,this.myPeerId);}

        on(type,handler){if(!this.handlers[type])this.handlers[type]=[];this.handlers[type].push(handler);}
        off(type){delete this.handlers[type];}
        _dispatch(d,from){if(!d||!d.type)return;const hs=this.handlers[d.type];if(hs)hs.forEach(h=>h(d,from));}

        _startHB(){
            this.heartbeatTimer=setInterval(()=>{
                const hb={type:'HEARTBEAT',t:Date.now()};
                if(this.isHost){
                    this.broadcast(hb);
                    const now=Date.now();
                    for(const[pid,e]of this.connections){
                        if(now-e.lastHB>HEARTBEAT_TIMEOUT){
                            e.conn.close(); this.connections.delete(pid);
                            if(this.onPeerDisconnect)this.onPeerDisconnect(pid);
                        }
                    }
                } else {
                    if(this.hostConn&&this.hostConn.open) this.hostConn.send(hb);
                    if(this._lastHostHB && Date.now()-this._lastHostHB>HEARTBEAT_TIMEOUT){
                        if(this.onPeerDisconnect) this.onPeerDisconnect(this.hostPeerId);
                        this._lastHostHB = Date.now() + 60000;
                        // 尝试重连
                        this._scheduleReconnect();
                    }
                }
            },HEARTBEAT_INTERVAL);
        }

        destroy(){
            this.destroyed=true; 
            clearInterval(this.heartbeatTimer);
            if(this._reconnectTimer) clearTimeout(this._reconnectTimer);
            if(this.peer)this.peer.destroy(); 
            this.connections.clear();
        }
    }

    const {
        NET_CONFIG,
        TURN_SERVERS_POOL,
        HEARTBEAT_TIMEOUT,
        HEARTBEAT_INTERVAL,
        _getEffectiveTurnConfig,
    } = global.LG_RUNTIME_CONFIG;
    const { mkRoomCode } = global.LG_RUNTIME_UTILS;

    global.LG_NETWORK_MANAGER = { NetworkManager };
})(window);