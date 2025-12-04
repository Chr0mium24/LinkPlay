import { CONFIG } from './config.js';

/**
 * 播放器控制核心
 * 1. 拦截本地操作发送给服务器
 * 2. 接收服务器状态进行追帧
 */
export class SyncPlayer {
    constructor(videoEl, socket, timeSyncer) {
        this.video = videoEl;
        this.socket = socket;
        this.timeSyncer = timeSyncer;
        
        this.currentState = null;
        this.isInternalUpdate = false; // "锁"：区分是代码调整的还是用户点击的
        
        this.bindEvents();
        this.startSyncLoop();
    }

    // 绑定原生事件，发送请求
    bindEvents() {
        const events = ['play', 'pause', 'seeked'];
        events.forEach(evt => {
            this.video.addEventListener(evt, () => {
                if (this.isInternalUpdate) return; // 如果是代码在调整，不发送
                
                const actionData = { action: evt };
                if (evt === 'seeked') {
                    actionData.action = 'seek';
                    actionData.value = this.video.currentTime;
                }
                
                console.log(`User Action: ${evt}`);
                this.socket.emit('control_action', actionData);
            });
        });
    }

    // 更新服务器状态
    updateState(state) {
        this.currentState = state;
        
        // 检查是否需要切歌
        const currentUrl = this.video.getAttribute('data-origin-url');
        if (state.url && state.url !== currentUrl) {
            this.loadVideo(state.url);
        }
    }

    // 加载视频 (调用本地后端)
    async loadVideo(url) {
        const overlay = document.getElementById('loadingOverlay');
        overlay.classList.remove('hidden');
        
        try {
            const res = await fetch('/api/resolve', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url})
            });
            const data = await res.json();
            
            // 设锁，防止加载过程触发事件
            this.isInternalUpdate = true;
            this.video.src = `/stream/${data.filename}`;
            this.video.setAttribute('data-origin-url', url);
            document.getElementById('currentSongTitle').innerText = data.title;
            document.getElementById('currentSongUrl').innerText = url;
            
            // 等待一下让浏览器缓冲
            setTimeout(() => { this.isInternalUpdate = false; }, 500);
        } catch (e) {
            console.error("加载失败", e);
            alert("视频加载失败，请检查本地后端");
        } finally {
            overlay.classList.add('hidden');
        }
    }

    // 核心循环：每 100ms 检查一次
    startSyncLoop() {
        setInterval(() => {
            this.tick();
        }, 100);
    }

    tick() {
        if (!this.currentState || !this.timeSyncer.isReady || !this.video.src) return;
        
        // 如果视频没准备好（缓冲中），暂不强行同步
        if (this.video.readyState < 2) return;

        // 1. 计算目标时间
        const serverNow = this.timeSyncer.getServerTime();
        let targetTime = this.currentState.anchor_position;

        if (this.currentState.status === 'playing') {
            const elapsed = (serverNow - this.currentState.anchor_server_time) / 1000.0;
            targetTime += elapsed * this.currentState.playback_rate;
        }

        // 2. 状态同步 (Play/Pause)
        const shouldPlay = (this.currentState.status === 'playing');
        if (!this.video.paused !== shouldPlay) {
            this.isInternalUpdate = true;
            if (shouldPlay) this.video.play().catch(()=>{});
            else this.video.pause();
            setTimeout(() => { this.isInternalUpdate = false; }, 200);
        }

        // 3. 进度追赶 (仅在播放时)
        if (shouldPlay) {
            const diff = this.video.currentTime - targetTime;
            // diff > 0: 本地快了; diff < 0: 本地慢了

            if (Math.abs(diff) < CONFIG.SYNC_THRESHOLD_SOFT) {
                // 误差极小，恢复正常倍速
                if (this.video.playbackRate !== 1.0) this.video.playbackRate = 1.0;
            } 
            else if (Math.abs(diff) > CONFIG.SYNC_THRESHOLD_HARD) {
                // 误差太大，硬跳转
                console.log(`Hard Seek: ${diff.toFixed(2)}s`);
                this.isInternalUpdate = true;
                this.video.currentTime = targetTime;
                setTimeout(() => { this.isInternalUpdate = false; }, 200);
            } 
            else {
                // 误差中等，柔性追赶
                // 如果慢了(diff<0)，设为 1.05x；如果快了(diff>0)，设为 0.95x
                const newRate = diff < 0 ? CONFIG.PLAYBACK_RATE_FAST : CONFIG.PLAYBACK_RATE_SLOW;
                if (this.video.playbackRate !== newRate) {
                    this.video.playbackRate = newRate;
                    console.log(`Soft Sync: Rate ${newRate}`);
                }
            }
        }
    }
}