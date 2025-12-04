import time
import html  # 用于 HTML 转义，防止 XSS
from flask import Flask, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'  # 生产环境建议修改，但按要求此处未做变动
# 保持 CORS 为 *
socketio = SocketIO(app, cors_allowed_origins="*")

# --- 配置限制 ---
MAX_PLAYLIST_SIZE = 50   # 限制歌单最多 50 首歌
MAX_URL_LENGTH = 1024    # 限制单条 URL 最大长度 1024 字符

# --- 内存数据 ---
playlist = [] 
room_state = {
    'url': None,              
    'status': 'paused',
    'playback_rate': 1.0,     
    'anchor_position': 0.0,
    'anchor_server_time': 0,
    'last_updated': 0         
}

def get_server_time_ms():
    return time.time() * 1000

@socketio.on('connect')
def handle_connect():
    emit('update_playlist', playlist)
    emit('sync_state', room_state)

# --- NTP 时间校准 ---
@socketio.on('time_sync')
def handle_time_sync(client_send_time):
    # 简单类型检查，防止非数字类型导致可能的错误（虽不致命）
    if not isinstance(client_send_time, (int, float)):
        return
        
    emit('time_sync_response', {
        'client_send_time': client_send_time,
        'server_receive_time': get_server_time_ms()
    })

# --- 歌单管理 ---
@socketio.on('add_song')
def handle_add_song(data):
    # 1. 基础数据结构检查
    if not isinstance(data, dict):
        return
        
    url = data.get('url')
    
    # 2. 修复：空值与类型检查
    if not url or not isinstance(url, str):
        return

    # 3. 修复：限制 URL 长度 (防止内存耗尽/DoS)
    if len(url) > MAX_URL_LENGTH:
        return # 或者 emit 错误提示
        
    # 4. 修复：限制歌单总长度 (防止内存耗尽)
    if len(playlist) >= MAX_PLAYLIST_SIZE:
        emit('error_message', {'msg': '歌单已满'}, to=request.sid)
        return

    # 5. 修复：XSS 防御
    # 策略 A: 协议检查 (防止 javascript:alert(1))
    if not (url.startswith('http://') or url.startswith('https://')):
        emit('error_message', {'msg': '仅支持 http/https 链接'}, to=request.sid)
        return
        
    # 策略 B: HTML 转义 (将 < 变为 &lt;，防止注入 <script> 标签)
    # 注意：客户端收到后如果放入 <video src="..."> 通常没问题，
    # 但如果客户端用来 innerHTML 显示标题，这能防止脚本执行。
    safe_url = html.escape(url)

    if safe_url not in playlist:
        playlist.append(safe_url)
        emit('update_playlist', playlist, broadcast=True)

@socketio.on('remove_song')
def handle_remove_song(data):
    if not isinstance(data, dict):
        return
    url = data.get('url')
    # 同样需要转义后才能匹配到列表中的内容
    if url and isinstance(url, str):
        # 尝试移除原始值或转义后的值（取决于客户端传回什么）
        safe_url = html.escape(url)
        if safe_url in playlist:
            playlist.remove(safe_url)
            emit('update_playlist', playlist, broadcast=True)

# --- 核心播放控制 ---
@socketio.on('control_action')
def handle_control(data):
    global room_state
    
    # 基础校验
    if not isinstance(data, dict):
        return

    action = data.get('action')
    value = data.get('value')
    
    now = get_server_time_ms()
    
    # 6. 修复：异常捕获与类型安全
    try:
        # 结算当前状态
        current_pos = room_state['anchor_position']
        if room_state['status'] == 'playing':
            elapsed = (now - room_state['anchor_server_time']) / 1000.0
            current_pos += elapsed * room_state['playback_rate']
        
        if action == 'switch':
            # 同样对切歌的 URL 进行长度和类型限制
            if value and isinstance(value, str) and len(value) <= MAX_URL_LENGTH:
                # 再次进行简单的协议检查
                if value.startswith('http://') or value.startswith('https://'):
                    room_state.update({
                        'url': html.escape(value), # 存入状态也进行转义
                        'status': 'playing',
                        'anchor_position': 0.0,
                        'anchor_server_time': now
                    })
            
        elif action == 'play':
            if room_state['status'] != 'playing':
                room_state.update({
                    'status': 'playing',
                    'anchor_position': current_pos,
                    'anchor_server_time': now
                })
                
        elif action == 'pause':
            if room_state['status'] != 'paused':
                room_state.update({
                    'status': 'paused',
                    'anchor_position': current_pos,
                    'anchor_server_time': now
                })
                
        elif action == 'seek':
            # 7. 修复：seek 动作期望 value 是数字的崩溃问题
            # 如果 value 是 'hello'，float() 会抛出 ValueError
            # 如果 value 是 None，float() 会抛出 TypeError
            seek_to = float(value) 
            
            # 额外的逻辑校验：不允许 seek 到负数
            if seek_to < 0: 
                seek_to = 0.0
                
            room_state.update({
                'anchor_position': seek_to,
                'anchor_server_time': now
            })

        # 广播新状态
        emit('sync_state', room_state, broadcast=True)

    except (ValueError, TypeError):
        # 捕获转换错误，忽略该次非法请求，不让服务器崩溃
        # print(f"Invalid input data: {data}") # 调试用，生产环境可去掉
        pass

if __name__ == '__main__':
    # 监听 0.0.0.0 以便公网访问
    print("Public Server running on port 5001...")
    socketio.run(app, host='0.0.0.0', port=5001)