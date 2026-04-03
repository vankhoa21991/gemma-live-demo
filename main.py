import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from gemma_live import GemmaLive

load_dotenv()

logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)
logging.getLogger("gemma_live").setLevel(logging.DEBUG)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
MODEL = os.getenv("MODEL", "gemma4:e2b")
SYSTEM_INSTRUCTION = os.getenv(
    "SYSTEM_INSTRUCTION",
    "You are a helpful AI assistant. Keep your responses concise. "
    "You can see the user's camera which is shared as video frames. "
    "If the user sends audio, it will be transcribed and shown to you."
)

_ollama_client: GemmaLive | None = None


def get_ollama() -> GemmaLive:
    global _ollama_client
    if _ollama_client is None:
        _ollama_client = GemmaLive(
            base_url=OLLAMA_BASE_URL,
            model=MODEL,
            system_instruction=SYSTEM_INSTRUCTION,
        )
    return _ollama_client


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    if _ollama_client:
        await _ollama_client.close()


app = FastAPI(title="Gemma Live Demo", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="frontend"), name="static")


@app.get("/")
async def root():
    return FileResponse("frontend/index.html")


@app.get("/health")
async def health():
    """Check if Ollama is reachable."""
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{OLLAMA_BASE_URL}/api/tags", timeout=5.0)
            models = [m["name"] for m in resp.json().get("models", [])]
            return {"status": "ok", "ollama": "connected", "models": models}
    except Exception as e:
        return {"status": "degraded", "ollama": "unreachable", "error": str(e)}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for Gemma Live."""
    await websocket.accept()
    logger.info("WebSocket connection accepted")

    audio_input_queue = asyncio.Queue()
    video_input_queue = asyncio.Queue()
    text_input_queue = asyncio.Queue()

    async def audio_output_callback(data: bytes):
        """Placeholder — audio output not yet implemented."""
        pass

    async def audio_interrupt_callback():
        pass

    gemma = get_ollama()

    async def receive_from_client():
        """Receive messages from the WebSocket client."""
        try:
            while True:
                message = await websocket.receive()

                if message.get("bytes"):
                    # Raw audio bytes — treat as audio input
                    await audio_input_queue.put(message["bytes"])
                elif message.get("text"):
                    text = message["text"]
                    try:
                        payload = json.loads(text)
                    except json.JSONDecodeError:
                        # Plain text — send as text input
                        await text_input_queue.put(text)
                        continue

                    msg_type = payload.get("type")

                    if msg_type == "text":
                        await text_input_queue.put(payload.get("content", ""))

                    elif msg_type == "image":
                        # base64-encoded image
                        await video_input_queue.put(payload.get("data", ""))

                    elif msg_type == "audio_transcript":
                        # Pre-transcribed audio from frontend
                        await audio_input_queue.put(payload.get("transcript", ""))

                    elif msg_type == "ping":
                        await websocket.send_json({"type": "pong"})

        except WebSocketDisconnect:
            logger.info("WebSocket disconnected")
        except Exception as e:
            logger.error(f"Error receiving from client: {e}")

    receive_task = asyncio.create_task(receive_from_client())

    async def run_session():
        async for event in gemma.start_session(
            audio_input_queue=audio_input_queue,
            video_input_queue=video_input_queue,
            text_input_queue=text_input_queue,
            audio_output_callback=audio_output_callback,
            audio_interrupt_callback=audio_interrupt_callback,
        ):
            if event:
                await websocket.send_json(event)

    try:
        await run_session()
    except Exception as e:
        import traceback
        logger.error(f"Error in session: {type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        receive_task.cancel()
        try:
            await websocket.close()
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="localhost", port=port)
