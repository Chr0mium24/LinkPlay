/* static/js/main.js */
import { TimeSyncer } from './ntp.js';
import { SyncPlayer } from './player.js';
import { UI } from './ui.js';

let socket = null;
let timeSyncer = null;
let player = null;
let currentPlaylistData = []; 

// --- 连接部分保持不变 ---
const connectBtn = document.getElementById('connectBtn');
const urlInput = document.getElementById('serverUrlInput');
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
        currentPlaylistData = playlist;
        UI.renderPlaylist(playlist, socket);
    });

    socket.on('sync_state', (state) => {
        if (player) player.updateState(state);
    });
});

// --- URL验证和添加逻辑 (保持不变) ---
function processInputUrl(input) {
    let url = input.trim();
    const bvRegex = /^(BV[a-zA-Z0-9]+)$/;
    if (bvRegex.test(url)) url = `https://www.bilibili.com/video/${url}`;
    try {
        const urlObj = new URL(url);
        if (!['http:', 'https:'].includes(urlObj.protocol)) throw new Error();
        return urlObj.href;
    } catch (e) {
        if (!url.startsWith('http')) {
            try { return new URL('http://' + url).href; } catch (e2) {}
        }
        alert("无效的链接");
        return null;
    }
}

document.getElementById('addSongBtn').addEventListener('click', () => {
    const inputEl = document.getElementById('newSongUrl');
    const validUrl = processInputUrl(inputEl.value);
    if (validUrl && socket && socket.connected) {
        if (currentPlaylistData.includes(validUrl)) { alert("已存在"); return; }
        socket.emit('add_song', { url: validUrl });
        inputEl.value = '';
    }
});

// ==========================================
//   核心修改区域：导出与导入逻辑
// ==========================================

// --- 1. 导出功能 (包含标题) ---
document.getElementById('exportBtn').addEventListener('click', () => {
    if (currentPlaylistData.length === 0) {
        alert("歌单为空");
        return;
    }
    
    // 组装数据：[{url: "...", title: "..."}, ...]
    const exportList = currentPlaylistData.map(url => ({
        url: url,
        // 尝试从 UI 缓存中拿标题，拿不到就用 "Unknown" 或 截断的URL
        title: UI.localMetaCache[url] ? UI.localMetaCache[url].title : (url.split('/').pop() || 'Unknown Song')
    }));
    
    const dataStr = JSON.stringify(exportList, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const dlUrl = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = dlUrl;
    a.download = `playlist_full_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(dlUrl);
});

// --- 2. 导入功能 (模态框与选择逻辑) ---
const fileInput = document.getElementById('fileInput');
const importModal = document.getElementById('importModal');
const importListBody = document.getElementById('importListBody');
const selectedCountSpan = document.getElementById('selectedCount');
let importedItemsCache = []; // 临时存储导入的数据

// 点击导入按钮 -> 触发文件选择
document.getElementById('importBtn').addEventListener('click', () => {
    if (!socket || !socket.connected) { alert("请先连接服务器"); return; }
    fileInput.click();
});

// 文件被选择后 -> 读取并显示模态框
fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const json = JSON.parse(event.target.result);
            if (!Array.isArray(json)) throw new Error("格式错误");

            // 兼容旧版纯URL数组格式，统一转为对象格式
            importedItemsCache = json.map(item => {
                if (typeof item === 'string') return { url: item, title: item };
                return item;
            });

            renderImportModal();
            importModal.showModal(); // 显示 DaisyUI Modal
            
        } catch (err) {
            console.error(err);
            alert("文件解析失败");
        }
        fileInput.value = ''; // 重置以允许重复导入
    };
    reader.readAsText(file);
});

// 渲染模态框列表
function renderImportModal() {
    importListBody.innerHTML = '';
    
    importedItemsCache.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.className = "playlist-row hover group"; // group 用于控制子元素显示
        // 检查是否已经在当前播放列表中，如果是，默认置灰或标记
        const isExists = currentPlaylistData.includes(item.url);
        
        tr.className = "hover:bg-base-200 transition-colors select-none";
        tr.dataset.index = index;
        tr.dataset.selected = "false"; // 默认不选中

        // 如果已存在，样式做特殊处理（可选）
        if (isExists) {
            tr.classList.add('opacity-50');
            tr.title = "当前歌单已存在";
        }

        tr.innerHTML = `
            <td class="font-medium">${item.title || '无标题'}</td>
            <td class="text-xs text-gray-500 truncate max-w-[200px]">${item.url}</td>
        `;

        // 点击行：切换选中状态
        tr.addEventListener('click', () => {
            const isSelected = tr.dataset.selected === "true";
            toggleRow(tr, !isSelected);
            updateCount();
        });

        importListBody.appendChild(tr);
    });
    
    updateCount();
}

// 切换行的选中样式
function toggleRow(tr, selected) {
    tr.dataset.selected = selected ? "true" : "false";
    if (selected) {
        tr.classList.add('bg-primary', 'text-primary-content');
        tr.classList.remove('hover:bg-base-200'); // 移除 hover 避免闪烁
    } else {
        tr.classList.remove('bg-primary', 'text-primary-content');
        tr.classList.add('hover:bg-base-200');
    }
}

// 更新选中计数
function updateCount() {
    const count = importListBody.querySelectorAll('[data-selected="true"]').length;
    selectedCountSpan.innerText = `已选: ${count}`;
}

// 全选 / 反选 按钮逻辑
document.getElementById('selectAllBtn').addEventListener('click', (e) => {
    // 阻止这个按钮提交表单（如果在form里）
    e.preventDefault(); 
    
    const allRows = importListBody.querySelectorAll('tr');
    // 如果当前有未选中的，则全选；如果全部都选中了，则全不选
    const hasUnselected = Array.from(allRows).some(tr => tr.dataset.selected === "false");
    
    allRows.forEach(tr => toggleRow(tr, hasUnselected));
    updateCount();
});

// 确认导入按钮
document.getElementById('confirmImportBtn').addEventListener('click', (e) => {
    // 这里的 e.preventDefault() 取决于 DaisyUI modal 的 form method="dialog" 行为
    // 如果需要保留Modal关闭动画，通常不需要 preventDefault，
    // 但我们需要先执行逻辑再让它关闭。
    
    const selectedRows = importListBody.querySelectorAll('[data-selected="true"]');
    if (selectedRows.length === 0) return;

    let addedCount = 0;
    selectedRows.forEach(tr => {
        const index = tr.dataset.index;
        const item = importedItemsCache[index];
        
        // 双重检查去重
        if (!currentPlaylistData.includes(item.url)) {
            // 这里还可以顺便把 title 塞回 UI.localMetaCache，避免导入后重新解析一遍！
            // 这是一个优化点
            if (item.title) {
                UI.localMetaCache[item.url] = { title: item.title, filename: null }; 
            }
            
            socket.emit('add_song', { url: item.url });
            addedCount++;
        }
    });
    
    console.log(`已提交导入 ${addedCount} 首歌曲`);
    // 模态框会自动关闭，因为按钮在 form method="dialog" 内
});