/* static/js/main.js */
import { TimeSyncer } from './ntp.js';
import { SyncPlayer } from './player.js';
import { UI } from './ui.js';

let socket = null;
let timeSyncer = null;
let player = null;

const connectBtn = document.getElementById('connectBtn');
const urlInput = document.getElementById('serverUrlInput');

// --- 新增：加载本地存储的地址 ---
const savedUrl = localStorage.getItem('server_url');
if (savedUrl) {
    urlInput.value = savedUrl;
}
// ----------------------------

connectBtn.addEventListener('click', () => {
    const serverUrl = urlInput.value.trim();
    if (!serverUrl) {
        alert("请输入服务器地址");
        return;
    }

    // --- 新增：保存地址到本地 ---
    localStorage.setItem('server_url', serverUrl);
    // -------------------------

    if (socket) socket.disconnect();

    socket = io(serverUrl);

    socket.on('connect', () => {
        console.log("Connected to Public Server");
        connectBtn.innerText = "已连接";
        connectBtn.classList.replace('btn-primary', 'btn-success');

        timeSyncer = new TimeSyncer(socket);
        timeSyncer.startSync();

        const videoEl = document.getElementById('player');
        player = new SyncPlayer(videoEl, socket, timeSyncer);
    });

    socket.on('disconnect', () => {
        connectBtn.innerText = "断开连接";
        connectBtn.classList.replace('btn-success', 'btn-error');
    });

    socket.on('connect_error', (err) => {
        console.error("连接失败", err);
        connectBtn.innerText = "连接失败";
        connectBtn.classList.replace('btn-primary', 'btn-error');
    });

    socket.on('update_playlist', (playlist) => {
        UI.renderPlaylist(playlist, socket);
    });

    socket.on('sync_state', (state) => {
        if (player) player.updateState(state);
    });
});

document.getElementById('addSongBtn').addEventListener('click', () => {
    const input = document.getElementById('newSongUrl');
    const url = input.value.trim();
    if (url && socket && socket.connected) {
        socket.emit('add_song', { url });
        input.value = '';
    }
});