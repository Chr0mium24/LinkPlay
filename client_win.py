import os
import sys
import json
import webbrowser
from flask import Flask, render_template, request, jsonify, send_from_directory
from yt_dlp import YoutubeDL
from flask_cors import CORS

# --- 核心路径处理逻辑 ---
def get_base_path():
    """获取内部资源的基础路径 (用于 templates/static)"""
    if getattr(sys, 'frozen', False):
        # 如果是打包后的 exe，资源在临时文件夹 _MEIPASS 中
        return sys._MEIPASS
    # 如果是脚本运行，就在当前目录
    return os.path.dirname(os.path.abspath(__file__))

def get_exe_dir():
    """获取外部存储的基础路径 (用于 downloads/cache)"""
    if getattr(sys, 'frozen', False):
        # 如果是 exe，返回 exe 所在的目录
        return os.path.dirname(sys.executable)
    # 如果是脚本，返回脚本所在的目录
    return os.path.dirname(os.path.abspath(__file__))

# 1. 设置 Flask 路径
base_path = get_base_path()
template_dir = os.path.join(base_path, 'templates')
static_dir = os.path.join(base_path, 'static')

app = Flask(__name__, template_folder=template_dir, static_folder=static_dir)
CORS(app)

# 2. 设置外部存储路径
exe_dir = get_exe_dir()
DOWNLOAD_FOLDER = os.path.join(exe_dir, 'downloads')
CACHE_FILE = os.path.join(exe_dir, 'cache_map.json')

if not os.path.exists(DOWNLOAD_FOLDER):
    os.makedirs(DOWNLOAD_FOLDER)
    print(f"已创建下载目录: {DOWNLOAD_FOLDER}")

# --- 业务逻辑 ---

def load_cache():
    if os.path.exists(CACHE_FILE):
        try:
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                return json.load(f)
        except:
            return {}
    return {}

def save_cache(data):
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

cache_index = load_cache()

@app.route('/')
def index():
    return render_template('index.html')

# 显式处理 JS 文件的路由 (确保打包后能找到)
@app.route('/static/js/<path:filename>')
def serve_js(filename):
    return send_from_directory(os.path.join(static_dir, 'js'), filename)

@app.route('/api/resolve', methods=['POST'])
def resolve_song():
    url = request.json.get('url')
    if url in cache_index:
        # 检查文件是否真的存在
        local_path = os.path.join(DOWNLOAD_FOLDER, cache_index[url]['filename'])
        if os.path.exists(local_path):
            return jsonify(cache_index[url])
    
    # yt-dlp 配置 (注意 ffmpeg 位置)
    ydl_opts = {
        'format': 'best[ext=mp4]',
        'outtmpl': f'{DOWNLOAD_FOLDER}/%(id)s.%(ext)s',
        'quiet': False, # 开启日志，方便在CMD看进度
        'no_warnings': True,
        # 如果 ffmpeg 和 exe 在同一目录，通常不需要额外配置，系统会自动找
    }
    
    print(f"正在下载: {url} ...")
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            entry = {
                'filename': f"{info['id']}.{info['ext']}",
                'title': info.get('title', 'Unknown Title')
            }
            cache_index[url] = entry
            save_cache(cache_index)
            print(f"下载完成: {entry['title']}")
            return jsonify(entry)
    except Exception as e:
        print(f"下载出错: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/stream/<path:filename>')
def stream_file(filename):
    return send_from_directory(DOWNLOAD_FOLDER, filename)

if __name__ == '__main__':
    port = 8000
    print("-" * 50)
    print(f" 本地客户端已启动")
    print(f" 存储目录: {exe_dir}")
    print(f" 访问地址: http://localhost:{port}")
    print("-" * 50)
    
    # 自动打开浏览器
    webbrowser.open(f'http://localhost:{port}')
    
    # host='0.0.0.0' 允许局域网访问，但为了安全通常只开 localhost
    app.run(port=port, debug=False)