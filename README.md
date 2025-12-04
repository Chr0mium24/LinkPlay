## Init

`pip install uv`

`uv sync`

## Server

`cd server`

`uv run server.py`

## Client

`cd client`

`uv run client.py`

## build Client

### Windows(use semicolon):

`cd client`

`uv run pyinstaller -F --name "LinkPlay" --add-data "templates;templates" --add-data "static;static" client.py`

folded with `ffmpeg.exe`, `ffprobe.exe`

### Mac(use colon):

`cd client`

`uv run pyinstaller -F --name "LinkPlay" --add-data "templates:templates" --add-data "static:static" client.py`

`chmod +x LinkPlay`
