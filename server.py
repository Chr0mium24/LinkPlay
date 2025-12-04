import time
from flask import Flask, request
from flask_socketio import SocketIO, emit

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# --- 内存数据 ---
playlist = [] 
room_state = {
    'url': None,              
    'status': 'paused',       # 'playing' | 'paused'
    'playback_rate': 1.0,     
    'anchor_position': 0.0,   # 动作发生时的视频进度(秒)
    'anchor_server_time': 0,  # 动作发生时的服务器时间(毫秒)
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
    # 收到 Ping，立刻回 Pong，带上服务器当前时间
    emit('time_sync_response', {
        'client_send_time': client_send_time,
        'server_receive_time': get_server_time_ms()
    })

# --- 歌单管理 ---
@socketio.on('add_song')
def handle_add_song(data):
    url = data.get('url')
    if url and url not in playlist:
        playlist.append(url)
        emit('update_playlist', playlist, broadcast=True)

@socketio.on('remove_song')
def handle_remove_song(data):
    url = data.get('url')
    if url in playlist:
        playlist.remove(url)
        emit('update_playlist', playlist, broadcast=True)

# --- 核心播放控制 (相对时间模型) ---
@socketio.on('control_action')
def handle_control(data):
    global room_state
    action = data.get('action') # 'play', 'pause', 'seek', 'switch'
    value = data.get('value')
    
    now = get_server_time_ms()
    
    # 1. 结算当前状态：计算在收到请求这一刻，视频理论上播放到了哪里
    current_pos = room_state['anchor_position']
    if room_state['status'] == 'playing':
        elapsed = (now - room_state['anchor_server_time']) / 1000.0
        current_pos += elapsed * room_state['playback_rate']
    
    # 2. 根据动作更新状态
    if action == 'switch':
        room_state.update({
            'url': value,
            'status': 'playing', # 切歌默认播放
            'anchor_position': 0.0,
            'anchor_server_time': now
        })
        
    elif action == 'play':
        if room_state['status'] != 'playing':
            room_state.update({
                'status': 'playing',
                'anchor_position': current_pos, # 从结算点继续
                'anchor_server_time': now
            })
            
    elif action == 'pause':
        if room_state['status'] != 'paused':
            room_state.update({
                'status': 'paused',
                'anchor_position': current_pos, # 定格在结算点
                'anchor_server_time': now
            })
            
    elif action == 'seek':
        # 拖动进度条，强制设定锚点位置
        seek_to = float(value)
        room_state.update({
            'anchor_position': seek_to,
            'anchor_server_time': now
        })

    # 3. 广播新状态
    emit('sync_state', room_state, broadcast=True)

if __name__ == '__main__':
    print("Public Server running on port 5001...")
    socketio.run(app, host='0.0.0.0', port=5001)