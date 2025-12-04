import os
import json
from flask import Flask, render_template, request, jsonify, send_from_directory
from yt_dlp import YoutubeDL
from flask_cors import CORS

app = Flask(__name__)
CORS(app) # 允许前端跨域fetch

DOWNLOAD_FOLDER = 'downloads'
CACHE_FILE = 'cache_map.json'

if not os.path.exists(DOWNLOAD_FOLDER):
    os.makedirs(DOWNLOAD_FOLDER)

def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    return {}

def save_cache(data):
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

cache_index = load_cache()

@app.route('/')
def index():
    return render_template('index.html')

# 提供静态JS文件服务 (因为使用了ES Module，MIME类型很重要，Flask默认处理通常没问题)
@app.route('/static/js/<path:filename>')
def serve_js(filename):
    return send_from_directory('static/js', filename)

@app.route('/api/resolve', methods=['POST'])
def resolve_song():
    url = request.json.get('url')
    if url in cache_index:
        return jsonify(cache_index[url])
    
    # yt-dlp 配置
    ydl_opts = {
        # 'format': 'best[ext=mp4]',
        'outtmpl': f'{DOWNLOAD_FOLDER}/%(id)s.%(ext)s',
        'quiet': True,
        'no_warnings': True
    }
    
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            entry = {
                'filename': f"{info['id']}.{info['ext']}",
                'title': info.get('title', 'Unknown Title')
            }
            cache_index[url] = entry
            save_cache(cache_index)
            return jsonify(entry)
    except Exception as e:
        print(f"Download Error: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/stream/<path:filename>')
def stream_file(filename):
    return send_from_directory(DOWNLOAD_FOLDER, filename)

if __name__ == '__main__':
    print("Local Client running at http://localhost:8000")
    app.run(port=8000, debug=True)