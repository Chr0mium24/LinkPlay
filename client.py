# (与上一版代码基本一致，略微精简)
import os, json
from flask import Flask, render_template, request, jsonify, send_from_directory
from yt_dlp import YoutubeDL
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

DOWNLOAD_FOLDER = 'downloads'
CACHE_FILE = 'cache_map.json'
if not os.path.exists(DOWNLOAD_FOLDER): os.makedirs(DOWNLOAD_FOLDER)

# 简单的文件存储型缓存
def load_cache():
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r') as f: return json.load(f)
    return {}

def save_cache(cache):
    with open(CACHE_FILE, 'w') as f: json.dump(cache, f, indent=2)

cache_index = load_cache()

@app.route('/')
def index(): return render_template('index.html')

@app.route('/static/<path:path>')
def send_static(path): return send_from_directory('static', path)

@app.route('/api/resolve', methods=['POST'])
def resolve_song():
    url = request.json.get('url')
    if url in cache_index: return jsonify(cache_index[url])
    
    ydl_opts = {'format': 'best[ext=mp4]', 'outtmpl': f'{DOWNLOAD_FOLDER}/%(id)s.%(ext)s', 'quiet': True}
    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            data = {'filename': f"{info['id']}.{info['ext']}", 'title': info.get('title', 'Unknown')}
            cache_index[url] = data
            save_cache(cache_index)
            return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/stream/<path:filename>')
def stream_file(filename): return send_from_directory(DOWNLOAD_FOLDER, filename)

if __name__ == '__main__':
    print("Local Client: http://localhost:8000")
    app.run(port=8000, debug=True)