from flask import Flask, request
from flask_socketio import SocketIO, emit
import time

app = Flask(__name__)
app.config['SECRET_KEY'] = 'secret!'
socketio = SocketIO(app, cors_allowed_origins="*")

# 数据存储
playlist = [] 
# 核心状态模型
room_state = {
    'url': None,              # 当前播放的URL
    'status': 'paused',       # playing | paused
    'playback_rate': 1.0,     # 播放倍速
    'anchor_position': 0.0,   # 锚点：视频位置 (秒)
    'anchor_server_time': 0,  # 锚点：服务器时间 (毫秒)
    'last_updated': 0         # 最后更新时间
}

def get_server_time_ms():
    return time.time() * 1000

@socketio.on('connect')
def handle_connect():
    emit('update_playlist', playlist)
    emit('sync_state', room_state)

# --- 1. NTP 时间校准接口 ---
@socketio.on('time_sync')
def handle_time_sync(client_send_time):
    # 收到Ping，立刻回Pong，带上当前服务器时间
    emit('time_sync_response', {
        'client_send_time': client_send_time,
        'server_receive_time': get_server_time_ms()
    })

# --- 2. 播放列表管理 ---
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

# --- 3. 核心控制逻辑 ---
@socketio.on('control_action')
def handle_control(data):
    """
    接收客户端的操作请求，计算新状态，广播给所有人。
    data: { 'action': 'play'|'pause'|'seek'|'switch', 'value': ... }
    """
    global room_state
    action = data.get('action')
    current_server_time = get_server_time_ms()
    
    # 根据当前状态，计算出“收到请求这一刻”理论上视频播放到了哪里
    # 这一点非常重要：基于旧状态结算出当前位置，作为新状态的起点
    elapsed = 0
    if room_state['status'] == 'playing':
        elapsed = (current_server_time - room_state['anchor_server_time']) / 1000.0 * room_state['playback_rate']
    
    current_video_pos = room_state['anchor_position'] + elapsed

    if action == 'switch':
        # 切歌：重置所有状态
        room_state.update({
            'url': data.get('value'),
            'status': 'playing', # 切歌后默认播放
            'anchor_position': 0.0,
            'anchor_server_time': current_server_time
        })

    elif action == 'play':
        if room_state['status'] != 'playing':
            room_state.update({
                'status': 'playing',
                'anchor_position': current_video_pos, # 从结算出的当前位置开始
                'anchor_server_time': current_server_time
            })

    elif action == 'pause':
        if room_state['status'] != 'paused':
            room_state.update({
                'status': 'paused',
                'anchor_position': current_video_pos, # 定格在当前位置
                'anchor_server_time': current_server_time
            })

    elif action == 'seek':
        seek_to = float(data.get('value'))
        room_state.update({
            'anchor_position': seek_to, # 强制设定新位置
            'anchor_server_time': current_server_time
        })

    # 广播新状态
    emit('sync_state', room_state, broadcast=True)

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=5001, debug=True)