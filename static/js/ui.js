/**
 * UI 管理：渲染歌单
 */
export const UI = {
    // 简单的内存缓存，避免重复请求后端API获取歌名
    localMetaCache: {},

    async renderPlaylist(urls, socket) {
        const tbody = document.getElementById('playlistBody');
        tbody.innerHTML = '';

        for (const url of urls) {
            const tr = document.createElement('tr');
            
            // 获取歌名（如果缓存没有，先显示URL，异步获取）
            let title = this.localMetaCache[url] ? this.localMetaCache[url].title : '正在解析...';
            
            tr.innerHTML = `
                <td>
                    <button class="btn btn-ghost btn-xs btn-play" data-url="${url}">▶</button>
                </td>
                <td class="text-sm font-medium break-all" id="title-${btoa(url).slice(0,10)}">${title}</td>
                <td>
                    <button class="btn btn-error btn-xs btn-del" data-url="${url}">✕</button>
                </td>
            `;
            tbody.appendChild(tr);

            // 绑定事件
            tr.querySelector('.btn-play').onclick = () => {
                socket.emit('control_action', { action: 'switch', value: url });
            };
            tr.querySelector('.btn-del').onclick = () => {
                socket.emit('remove_song', { url });
            };

            // 如果没有缓存，发起异步请求
            if (!this.localMetaCache[url]) {
                this.resolveTitle(url);
            }
        }
    },

    async resolveTitle(url) {
        try {
            const res = await fetch('/api/resolve', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url})
            });
            const data = await res.json();
            this.localMetaCache[url] = data;
            
            // 更新 DOM
            const el = document.getElementById(`title-${btoa(url).slice(0,10)}`);
            if (el) el.innerText = data.title;
        } catch (e) {
            console.error("解析歌名失败", e);
        }
    }
};