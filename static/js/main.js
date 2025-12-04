import { TimeSyncer } from './ntp.js';
import { SyncPlayer } from './player.js';
import { UI } from './ui.js';

let socket = null;
let timeSyncer = null;
let player = null;

const connectBtn = document.getElementById('connectBtn');
const urlInput = document.getElementById('serverUrlInput');

// 连接逻辑
connectBtn.addEventListener('click', () => {
    const serverUrl = urlInput.value;
    if (!serverUrl) return;

    if (socket) socket.disconnect();

    // 初始化 SocketIO
    socket = io(serverUrl);

    socket.on('connect', () => {
        console.log("Connected to Public Server");
        connectBtn.innerText = "已连接";
        connectBtn.classList.replace('btn-primary', 'btn-success');

        // 1. 启动 NTP
        timeSyncer = new TimeSyncer(socket);
        timeSyncer.startSync();

        // 2. 初始化播放器
        const videoEl = document.getElementById('player');
        player = new SyncPlayer(videoEl, socket, timeSyncer);
    });

    socket.on('disconnect', () => {
        connectBtn.innerText = "连接断开";
        connectBtn.classList.replace('btn-success', 'btn-error');
    });

    // 监听歌单更新
    socket.on('update_playlist', (playlist) => {
        UI.renderPlaylist(playlist, socket);
    });

    // 监听播放状态
    socket.on('sync_state', (state) => {
        if (player) player.updateState(state);
    });
});

// 添加歌曲按钮
document.getElementById('addSongBtn').addEventListener('click', () => {
    const input = document.getElementById('newSongUrl');
    const url = input.value.trim();
    if (url && socket && socket.connected) {
        socket.emit('add_song', { url });
        input.value = '';
    }
});