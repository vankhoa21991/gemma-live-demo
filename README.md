# Gemma Live Demo

A real-time multimodal chat demo using **Gemma 4** locally via **Ollama**, inspired by Google's Gemini Live API structure.

## Features

- **Text chat** with Gemma 4
- **Camera input** — video frames sent to Gemma for vision reasoning
- **Voice input** — Web Speech API transcription, then sent as text to Gemma
- **WebSocket streaming** between frontend and FastAPI backend

## Architecture

```
Frontend (browser)
  ├── media-handler.js   — camera + mic access
  ├── pcm-processor.js   — audio capture + Web Speech API transcription
  ├── gemma-client.js    — WebSocket client
  └── main.js            — app logic

Backend (FastAPI)
  ├── main.py            — WebSocket endpoint
  └── gemma_live.py      — Ollama API wrapper

Model (Ollama)
  └── gemma4:e2b        — running locally (7.2GB, fits RTX 2070)
```

## Prerequisites

- **Ollama v0.20.0-rc1 or later** (Gemma 4 requires a recent pre-release): https://github.com/ollama/ollama/releases
- Python 3.10+
- NVIDIA GPU with 8GB+ VRAM (RTX 2070 recommended)

## Setup

### 1. Install/Upgrade Ollama

```bash
# Download the pre-release (required for Gemma 4)
curl -L https://github.com/ollama/ollama/releases/download/v0.20.0-rc1/ollama-linux-amd64.tar.zst -o /tmp/ollama.tar.zst
tar -xf /tmp/ollama.tar.zst -C /tmp
sudo cp /tmp/bin/ollama /usr/local/bin/ollama
sudo systemctl restart ollama
```

### 2. Pull Gemma 4 E2B

```bash
ollama pull gemma4:e2b
```

This model is 7.2GB and fits on an RTX 2070 (8GB VRAM).

Verify it's installed:
```bash
ollama list
```

### 3. Install Python dependencies

```bash
cd projects/gemma-live-demo
python -m venv .venv
source .venv/bin/activate      # Linux/Mac
# .\.venv\Scripts\Activate.ps1  # Windows
pip install -r requirements.txt
```

### 4. Start the server

```bash
cd projects/gemma-live-demo
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Start on default port 8000 (or set PORT env var)
python main.py
# or with uvicorn
uv run uvicorn main:app --host localhost --port 8000
```

Open http://localhost:8000 in your browser.

### 5. Troubleshooting

**Ollama not reachable?**
```bash
ollama serve  # in a separate terminal
```

**Camera/mic not working?**
- Allow browser permissions for camera and microphone
- Test on Chrome or Edge for best WebRTC support

**Slow inference?**
- Reduce frame capture interval in `main.js` (line `startFrameCapture(3000)`)
- Use CPU-only: set `OLLAMA_HOST=http://localhost:11434` and ensure no GPU usage

## Controls

- **Type + Enter** — send text message
- **Click mic or hold Space** — record audio (transcribed via Web Speech API)
- **Toggle Camera** — enable/disable camera feed
- Video frames are automatically captured and sent with your messages

## How It Works

1. The browser connects to FastAPI via WebSocket
2. Camera frames are captured every 3 seconds and sent to the backend
3. Audio is transcribed using the Web Speech API (browser-native, no server needed)
4. Backend forwards text + images to Ollama's Gemma 4
5. Responses stream back via WebSocket and appear in the chat

## Adapting from Gemini Live

This project reuses the structure from `gemini-live-genai-python-sdk`:

| Gemini Live | Gemma Live |
|------------|-----------|
| `google-genai` SDK | Ollama REST API |
| `session.send_realtime_input(audio=...)` | Web Speech API → text transcript |
| `session.send_realtime_input(video=...)` | Canvas capture → base64 JPEG |
| `session.receive()` | WebSocket JSON events |
| Built-in TTS | Not included (text only) |
| Native audio streaming | AudioWorklet capture |

## License

Apache 2.0 — adapt freely for your projects.
