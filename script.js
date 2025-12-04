/**
 * 模块 1: NTP 时间同步器
 * 负责计算本地时间与服务器时间的偏差
 */
class TimeSyncer {
    constructor(socket) {
        this.socket = socket;
        this.offset = 0; // ServerTime = LocalTime + offset
        this.rtt = 0;
        this.isReady = false;
        
        this.socket.on('time_sync_response', (data) => this.handleResponse(data));
    }

    async startSync() {
        console.log("开始时间校准...");
        const samples = [];
        // 连续Ping 5次
        for(let i=0; i<5; i++) {
            const t1 = Date.now();
            this.socket.emit('time_sync', t1);
            // 等待回复（利用Promise包装SocketIO事件是比较复杂的，这里简化处理：
            // 我们不await socket回复，而是依赖 handleResponse 收集数据）
            await new Promise(r => setTimeout(r, 200)); 
        }
    }

    handleResponse(data) {
        const t1 = data.client_send_time;
        const t2 = Date.now();
        const serverTime = data.server_receive_time;
        
        const rtt = t2 - t1;
        // Offset = T_server - (T2 - RTT/2)
        const offset = serverTime - (t2 - rtt / 2);
        
        // 简单的加权平均或直接更新（为了代码清晰，这里直接更新）
        this.offset = offset;
        this.rtt = rtt;
        this.isReady = true;
        // console.log(`校准完成: Offset=${Math.round(this.offset)}ms, RTT=${rtt}ms`);
    }

    // 获取当前估算的服务器时间
    getServerTime() {
        return Date.now() + this.offset;
    }
}

/**
 * 模块 2: 播放控制器
 * 核心：相对时间模型、追帧逻辑、事件防抖
 */
class SyncPlayer {
    constructor(videoElement, socket, timeSyncer) {
        this.video = videoElement;
        this.socket = socket;
        this.timeSyncer = timeSyncer;
        
        this.currentState = null;
        this.isApplyingRemote = false; // 锁：是否正在应用远程状态
        this.checkInterval = null;
        
        // 绑定视频事件（用于发送用户操作）
        this.bindEvents();
        
        // 启动追帧循环 (30fps)
        this.startLoop();
    }

    bindEvents() {
        // 监听用户的播放/暂停/Seek操作
        // 关键：必须区分 "用户点击" 还是 "代码调用的play()"
        
        const eventHandler = (type) => {
            if (this.isApplyingRemote) return; // 如果是系统在同步，忽略
            
            // 简单的防抖或逻辑判断
            if (type === 'play') {
                this.socket.emit('control_action', { action: 'play' });
            } else if (type === 'pause') {
                this.socket.emit('control_action', { action: 'pause' });
            } else if (type === 'seeked') {
                this.socket.emit('control_action', { 
                    action: 'seek', 
                    value: this.video.currentTime 
                });
            }
        };

        this.video.addEventListener('play', () => eventHandler('play'));
        this.video.addEventListener('pause', () => eventHandler('pause'));
        // seeked 比 seeking 更稳定，表示拖动结束
        this.video.addEventListener('seeked', () => eventHandler('seeked')); 
    }

    // 接收服务器状态更新
    updateState(state) {
        this.currentState = state;
        // console.log("收到新状态:", state);
        
        // 只有当URL变了，才需要加载新视频
        const currentSrc = this.video.getAttribute('data-origin-url');
        if (state.url && state.url !== currentSrc) {
            this.loadVideo(state.url);
        }
    }

    async loadVideo(url) {
        // 显示加载中
        document.getElementById('loadingOverlay').classList.remove('hidden');
        
        // 调用本地后端解析
        try {
            const res = await fetch('/api/resolve', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url: url})
            });
            const meta = await res.json();
            
            this.isApplyingRemote = true; // 加载过程加锁
            this.video.src = `/stream/${meta.filename}`;
            this.video.setAttribute('data-origin-url', url);
            
            // 更新UI
            document.getElementById('currentSongTitle').innerText = meta.title;
            
            this.isApplyingRemote = false;
        } catch(e) {
            console.error(e);
        } finally {
            document.getElementById('loadingOverlay').classList.add('hidden');
        }
    }

    // 核心循环：每秒执行多次，计算目标时间并调整
    startLoop() {
        // 使用 requestAnimationFrame 保证流畅，或者 setInterval
        setInterval(() => {
            this.syncTick();
        }, 100); // 100ms 检查一次足够了
    }

    syncTick() {
        if (!this.currentState || !this.timeSyncer.isReady || !this.video.src) return;

        // 1. 计算 TargetTime
        const nowServer = this.timeSyncer.getServerTime();
        let targetTime = this.currentState.anchor_position;

        if (this.currentState.status === 'playing') {
            const elapsed = (nowServer - this.currentState.anchor_server_time) / 1000.0;
            targetTime += elapsed * this.currentState.playback_rate;
        }

        // 2. 状态同步 (Play/Pause)
        const isVideoPlaying = !this.video.paused;
        const shouldBePlaying = (this.currentState.status === 'playing');

        if (isVideoPlaying !== shouldBePlaying) {
            this.isApplyingRemote = true;
            if (shouldBePlaying) {
                // 只有当加载就绪才播放
                this.video.play().catch(e=>{}); 
            } else {
                this.video.pause();
            }
            // 这是一个瞬间动作，稍微延迟解锁，防止立即触发事件
            setTimeout(() => { this.isApplyingRemote = false; }, 300);
        }

        // 3. 进度追赶 (核心算法)
        if (shouldBePlaying) {
            const diff = this.video.currentTime - targetTime;
            // diff > 0 说明本地快了，diff < 0 说明本地慢了
            
            // 情况A: 误差很小 (< 0.5s)，忽略，避免鬼畜
            if (Math.abs(diff) < 0.5) {
                if (this.video.playbackRate !== 1.0) this.video.playbackRate = 1.0;
                return;
            }

            this.isApplyingRemote = true; // 下面的操作不应该触发 Seek 事件广播

            // 情况B: 误差较大 (> 3s)，硬跳转
            if (Math.abs(diff) > 3.0) {
                console.log(`硬跳转: 本地${this.video.currentTime} -> 目标${targetTime}`);
                this.video.currentTime = targetTime;
            } 
            // 情况C: 误差中等 (0.5s ~ 3s)，柔性追赶
            else {
                // 如果本地慢了 (diff < 0)，加速 (1.1x)
                // 如果本地快了 (diff > 0)，减速 (0.9x)
                const newRate = diff < 0 ? 1.1 : 0.9;
                if (this.video.playbackRate !== newRate) {
                    console.log(`柔性追赶: 倍速调整为 ${newRate}`);
                    this.video.playbackRate = newRate;
                }
            }
            
            setTimeout(() => { this.isApplyingRemote = false; }, 100);
        }
    }
}

// --- 初始化逻辑 ---
const socket = io(document.getElementById('serverUrlInput').value); // 这里的Value需要在连接时获取
const videoEl = document.getElementById('player');
let syncer = null;
let playerController = null;

document.getElementById('connectBtn').addEventListener('click', () => {
    const url = document.getElementById('serverUrlInput').value;
    if (socket.connected) socket.disconnect();
    
    socket.io.uri = url;
    socket.connect();
});

socket.on('connect', () => {
    console.log("已连接");
    document.getElementById('connectBtn').innerText = "已连接";
    document.getElementById('connectBtn').classList.replace('btn-primary', 'btn-success');
    
    // 1. 初始化 NTP
    syncer = new TimeSyncer(socket);
    syncer.startSync();
    
    // 2. 初始化播放控制器
    playerController = new SyncPlayer(videoEl, socket, syncer);
});

socket.on('sync_state', (state) => {
    if (playerController) playerController.updateState(state);
});

socket.on('update_playlist', (list) => {
    renderPlaylist(list); // 复用之前的渲染逻辑，稍微修改onclick
});

// 复用之前的 UI 逻辑
// ... resolveTitle, renderPlaylist 等函数 ...
// 唯一区别：playlist 中的 onclick 不再直接播放，而是 emit('control_action', {action: 'switch', value: url})
function renderPlaylist(list) {
    const tbody = document.getElementById('playlistBody');
    tbody.innerHTML = '';
    list.forEach(url => {
        // ... (缓存与解析逻辑同前) ...
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><button class="btn btn-ghost btn-xs" onclick="switchSong('${url}')">▶</button></td>
            <td class="song-title">${url}</td> 
            <td>...</td>
        `;
        tbody.appendChild(tr);
    });
}

window.switchSong = (url) => {
    socket.emit('control_action', { action: 'switch', value: url });
}