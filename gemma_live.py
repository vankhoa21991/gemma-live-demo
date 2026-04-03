import asyncio
import base64
import logging
import traceback
from typing import Callable, Optional

import httpx

logger = logging.getLogger(__name__)


class GemmaLive:
    """
    Handles interaction with a local Ollama Gemma 4 model for text + vision inference.
    Mirrors the Gemini Live API pattern: send audio (transcribed by Gemma) + video + text,
    receive text responses.
    """

    def __init__(
        self,
        base_url: str,
        model: str,
        audio_sample_rate: int = 16000,
        system_instruction: str = "You are a helpful AI assistant. Keep your responses concise.",
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.audio_sample_rate = audio_sample_rate
        self.system_instruction = system_instruction
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(120.0))
        return self._client

    async def close(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    async def chat(
        self,
        text: str,
        images: Optional[list[str]] = None,  # base64 encoded images
        audio_transcribed: Optional[str] = None,  # pre-transcribed audio
    ) -> str:
        """
        Send a chat message with optional images.
        Returns the model's text response.
        """
        # Build text content — prepend audio transcription if present
        content = text
        if audio_transcribed:
            content = f"[Audio: {audio_transcribed}]\n\n{text}"

        message = {
            "role": "user",
            "content": content
        }
        # Add images via Ollama's images field
        if images:
            message["images"] = images

        messages = [
            {"role": "system", "content": self.system_instruction},
            message
        ]

        client = await self._get_client()
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": 1.0,
                "top_p": 0.95,
            }
        }

        logger.debug(f"Sending request to Ollama: model={self.model}")
        response = await client.post(f"{self.base_url}/api/chat", json=payload)
        response.raise_for_status()
        data = response.json()

        return data["message"]["content"]

    async def generate(
        self,
        prompt: str,
        images: Optional[list[str]] = None,
    ) -> str:
        """
        Single-generation call (non-chat). Useful for quick inference.
        """
        images_list = []
        if images:
            for img_b64 in images:
                images_list.append(f"data:image/jpeg;base64,{img_b64}")

        client = await self._get_client()
        payload = {
            "model": self.model,
            "prompt": prompt,
            "images": images_list if images_list else None,
            "stream": False,
            "options": {
                "temperature": 1.0,
                "top_p": 0.95,
            }
        }

        logger.debug(f"Sending generate request to Ollama: model={self.model}")
        response = await client.post(f"{self.base_url}/api/generate", json=payload)
        response.raise_for_status()
        data = response.json()

        return data["response"]

    async def start_session(
        self,
        audio_input_queue: asyncio.Queue,
        video_input_queue: asyncio.Queue,
        text_input_queue: asyncio.Queue,
        audio_output_callback: Optional[Callable] = None,
        audio_interrupt_callback: Optional[Callable] = None,
    ):
        """
        Generator that yields events as the session progresses.
        Yields dicts with keys: type, text, error, etc.
        Mirrors the Gemini Live session pattern.
        """
        accumulated_images: list[str] = []
        pending_audio: str = ""

        async def run_inference(text_input: str, audio_transcript: str = "") -> dict:
            """Run inference with accumulated context."""
            try:
                context_parts = []
                if audio_transcript:
                    context_parts.append(f"[Audio: {audio_transcript}]")
                if accumulated_images:
                    context_parts.append(f"[{len(accumulated_images)} video frame(s) attached]")

                prompt = text_input or audio_transcript or "Please respond"
                full_prompt = prompt
                if context_parts:
                    full_prompt = " ".join(context_parts) + "\n\n" + prompt

                logger.info(f"Running inference: text={prompt[:50]}..., audio={bool(audio_transcript)}, images={len(accumulated_images)}")

                response = await self.chat(
                    text=full_prompt,
                    images=accumulated_images if accumulated_images else None,
                    audio_transcribed=audio_transcript if audio_transcript else None,
                )

                # Clear after processing
                accumulated_images.clear()
                return {"type": "gemini", "text": response}

            except Exception as e:
                logger.error(f"Inference error: {e}\n{traceback.format_exc()}")
                return {"type": "error", "error": f"{type(e).__name__}: {e}"}

        # Track whether a turn is in progress
        turn_in_progress = False

        async def handle_input():
            """Handle all input types — text, audio transcript, video frames."""
            nonlocal pending_audio, turn_in_progress

            while True:
                # Wait for ANY input (text or audio)
                text_task = asyncio.create_task(text_input_queue.get())
                audio_task = asyncio.create_task(audio_input_queue.get())

                done, pending = await asyncio.wait(
                    [text_task, audio_task],
                    return_when=asyncio.FIRST_COMPLETED
                )

                if not done:
                    logger.warning("No task completed — retrying")
                    continue

                # Get result from whichever task completed first
                completed = done.pop()
                pending_audio = completed.result()
                logger.info(f"QUEUE → received: {pending_audio[:50]}, from={'text_queue' if completed is text_task else 'audio_queue'}")

                is_text = completed is text_task
                if is_text:
                    logger.info(f"Got text input: {pending_audio[:50]}...")
                else:
                    logger.info(f"Got audio transcript: {pending_audio[:50]}...")

                # Cancel the other pending task
                for t in pending:
                    t.cancel()

                # Drain any pending video frames
                while not video_input_queue.empty():
                    frame = await video_input_queue.get()
                    accumulated_images.append(frame)
                    logger.debug(f"Accumulated video frame: total={len(accumulated_images)}")

                # Run inference — text_input and audio_transcript are exclusive
                turn_in_progress = True
                text_input = pending_audio if is_text else ""
                audio_transcript = pending_audio if not is_text else ""
                pending_audio = ""
                logger.info(f"INPUT → text={bool(text_input)}, audio={bool(audio_transcript)}, images={len(accumulated_images)}")
                result = await run_inference(text_input, audio_transcript)
                turn_in_progress = False
                yield result

                if result.get("type") == "error":
                    break

        try:
            async for event in handle_input():
                yield event
        except Exception as e:
            logger.error(f"handle_input crashed: {e}\n{traceback.format_exc()}")
            yield {"type": "error", "error": f"{type(e).__name__}: {e}"}
        finally:
            logger.info("Cleaning up Gemma Live session")
            await self.close()
