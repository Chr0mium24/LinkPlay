/* static/js/ui.js */
export const UI = {
    localMetaCache: {},

    async renderPlaylist(urls, socket) {
        const tbody = document.getElementById('playlistBody');
        tbody.innerHTML = '';

        for (const url of urls) {
            const tr = document.createElement('tr');
            
            // 生成唯一ID，用于后续更新DOM
            const safeId = btoa(url).replace(/=/g, '').slice(0, 10);
            const titleId = `title-${safeId}`;

            // 检查缓存
            const cachedData = this.localMetaCache[url];
            let displayHtml = '';

            if (cachedData) {
                // 已有缓存，直接显示
                displayHtml = `<span class="text-white">${cachedData.title}</span>`;
            } else {
                // 无缓存，显示加载占位符
                displayHtml = `<span class="loading loading-dots loading-xs text-info"></span> <span class="text-xs text-gray-400">解析/下载中...</span>`;
            }
            
            tr.innerHTML = `
                <td>
                    <button class="btn btn-ghost btn-xs btn-play" data-url="${url}">▶</button>
                </td>
                <td class="text-sm font-medium break-all" id="${titleId}">
                    ${displayHtml}
                </td>
                <td>
                    <button class="btn btn-error btn-xs btn-del" data-url="${url}">✕</button>
                </td>
            `;
            tbody.appendChild(tr);

            // 绑定基础事件
            tr.querySelector('.btn-play').onclick = () => {
                socket.emit('control_action', { action: 'switch', value: url });
            };
            tr.querySelector('.btn-del').onclick = () => {
                socket.emit('remove_song', { url });
            };

            // 如果没有缓存，触发异步解析
            if (!cachedData) {
                this.resolveTitle(url, titleId);
            }
        }
    },

    /**
     * 解析并下载歌曲
     * @param {string} url 视频链接
     * @param {string} domId 用于更新UI的元素ID
     */
    async resolveTitle(url, domId) {
        const el = document.getElementById(domId);
        if(!el) return;

        // 设置为加载状态
        el.innerHTML = `<span class="loading loading-spinner loading-xs text-warning"></span> <span class="text-xs text-warning">正在下载资源...</span>`;

        try {
            const res = await fetch('/api/resolve', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({url})
            });
            
            if (!res.ok) throw new Error("Server Error");

            const data = await res.json();
            
            // 成功：写入缓存并更新UI
            this.localMetaCache[url] = data;
            if (document.getElementById(domId)) {
                document.getElementById(domId).innerHTML = `<span class="text-white">${data.title}</span>`;
            }

        } catch (e) {
            console.error("解析失败", e);
            
            // 失败：显示重试按钮
            // 注意：这里我们生成一个临时的 "retry-btn-ID"
            if (document.getElementById(domId)) {
                document.getElementById(domId).innerHTML = `
                    <div class="flex items-center space-x-2 text-error">
                        <span class="text-xs">下载失败</span>
                        <button class="btn btn-xs btn-outline btn-error" id="retry-${domId}">
                            ↻ 重试
                        </button>
                    </div>
                `;
                
                // 绑定重试事件
                document.getElementById(`retry-${domId}`).onclick = () => {
                    this.resolveTitle(url, domId); // 递归调用自己进行重试
                };
            }
        }
    }
};