/* static/js/main.js */
import { TimeSyncer } from './ntp.js';
import { SyncPlayer } from './player.js';
import { UI } from './ui.js';

let socket = null;
let timeSyncer = null;
let player = null;
// 新增：用于存储当前歌单数据以便导出
let currentPlaylistData = []; 

const connectBtn = document.getElementById('connectBtn');
const urlInput = document.getElementById('serverUrlInput');

// --- 保持原有的连接逻辑 ---
const savedUrl = localStorage.getItem('server_url');
if (savedUrl) urlInput.value = savedUrl;

connectBtn.addEventListener('click', () => {
    const serverUrl = urlInput.value.trim();
    if (!serverUrl) { alert("请输入服务器地址"); return; }
    localStorage.setItem('server_url', serverUrl);

    if (socket) socket.disconnect();
    socket = io(serverUrl);

    socket.on('connect', () => {
        console.log("Connected");
        connectBtn.innerText = "已连接";
        connectBtn.classList.replace('btn-primary', 'btn-success');
        
        timeSyncer = new TimeSyncer(socket);
        timeSyncer.startSync();
        player = new SyncPlayer(document.getElementById('player'), socket, timeSyncer);
    });

    socket.on('disconnect', () => {
        connectBtn.innerText = "断开连接";
        connectBtn.classList.replace('btn-success', 'btn-error');
    });

    socket.on('update_playlist', (playlist) => {
        // 更新本地变量
        currentPlaylistData = playlist;
        UI.renderPlaylist(playlist, socket);
    });

    socket.on('sync_state', (state) => {
        if (player) player.updateState(state);
    });
});

// --- 新增逻辑：BV转换与URL验证函数 ---
function processInputUrl(input) {
    let url = input.trim();
    
    // 1. BV号识别 (简单的正则: BV开头，后面接字母数字)
    // 例如输入: BV1NcuUzJESu
    const bvRegex = /^(BV[a-zA-Z0-9]+)$/;
    if (bvRegex.test(url)) {
        url = `https://www.bilibili.com/video/${url}`;
        console.log(`检测到BV号，自动转换为: ${url}`);
    }

    // 2. URL 格式验证
    try {
        const urlObj = new URL(url);
        if (!['http:', 'https:'].includes(urlObj.protocol)) {
            throw new Error("Protocol must be http or https");
        }
        return urlObj.href; // 返回标准化后的URL
    } catch (e) {
        // 如果不是标准URL，尝试补全 http:// 再测一次 (针对 www.baidu.com 这种情况)
        if (!url.startsWith('http')) {
            try {
                const fixedUrl = new URL('http://' + url);
                return fixedUrl.href;
            } catch (e2) {}
        }
        alert("请输入有效的 HTTP/HTTPS 链接或 Bilibili BV号");
        return null;
    }
}

// --- 修改：添加歌曲按钮逻辑 ---
document.getElementById('addSongBtn').addEventListener('click', () => {
    const inputEl = document.getElementById('newSongUrl');
    const rawValue = inputEl.value;
    
    if (!rawValue) return;

    const validUrl = processInputUrl(rawValue);
    
    if (validUrl && socket && socket.connected) {
        // 检查是否重复 (可选)
        if (currentPlaylistData.includes(validUrl)) {
            alert("该链接已在歌单中");
            return;
        }
        socket.emit('add_song', { url: validUrl });
        inputEl.value = '';
    }
});

// --- 新增：导出功能 ---
document.getElementById('exportBtn').addEventListener('click', () => {
    if (currentPlaylistData.length === 0) {
        alert("歌单为空，无法导出");
        return;
    }
    
    // 构造 JSON (这里只导出URL列表，因为标题等元数据是本地缓存的，
    // 导出URL列表在任何人的电脑上都能重新解析)
    const dataStr = JSON.stringify(currentPlaylistData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `playlist_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
});

// --- 新增：导入功能 ---
const fileInput = document.getElementById('fileInput');
document.getElementById('importBtn').addEventListener('click', () => {
    if (!socket || !socket.connected) {
        alert("请先连接服务器");
        return;
    }
    fileInput.click(); // 触发隐藏的文件选择框
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedList = JSON.parse(event.target.result);
            if (!Array.isArray(importedList)) {
                throw new Error("文件格式错误：必须是URL数组");
            }
            
            // 确认提示
            if(!confirm(`确认导入 ${importedList.length} 首歌曲到当前列表？`)) return;

            // 批量添加 (简单的循环发送)
            let count = 0;
            importedList.forEach(url => {
                // 简单的去重检查
                if (!currentPlaylistData.includes(url)) {
                    socket.emit('add_song', { url });
                    count++;
                }
            });
            alert(`导入完成，新增 ${count} 首歌曲`);
            
        } catch (err) {
            console.error(err);
            alert("导入失败：文件格式不正确 (需要标准的 JSON 数组)");
        }
        // 清空 input 允许重复导入同一文件
        fileInput.value = '';
    };
    reader.readAsText(file);
});