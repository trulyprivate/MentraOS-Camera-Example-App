"""
Qwen3-TTS Voice Agent - FastAPI WebSocket backend
Supports zero-shot voice cloning and leaky-window wake word activation.
"""

import asyncio
import base64
import json
import os
import time
import tempfile
import uuid
from typing import Optional

import numpy as np
try:
    import torch
except ImportError:
    torch = None  # type: ignore

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Qwen3-TTS Voice Agent", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SAMPLE_RATE = 24000
ACTIVATION_TIMEOUT = float(os.environ.get("ACTIVATION_TIMEOUT", "15.0"))

tts_model = None
tts_processor = None
model_load_error: Optional[str] = None


def load_tts_model():
    global tts_model, tts_processor, model_load_error
    model_name = os.environ.get("TTS_MODEL", "Qwen/Qwen3-TTS-0.6B")
    try:
        print(f"Loading Qwen3-TTS model: {model_name}...")
        from transformers import AutoProcessor, AutoModel
        device = "cuda" if (torch and torch.cuda.is_available()) else "cpu"
        dtype = torch.bfloat16 if (torch and torch.cuda.is_available()) else (torch.float32 if torch else None)
        tts_processor = AutoProcessor.from_pretrained(model_name)
        tts_model = AutoModel.from_pretrained(
            model_name,
            torch_dtype=dtype,
            device_map="auto" if (torch and torch.cuda.is_available()) else None,
        )
        if torch and not torch.cuda.is_available():
            tts_model = tts_model.to(device)
        print(f"Qwen3-TTS loaded on {device}")
    except Exception as e:
        model_load_error = str(e)
        print(f"TTS model unavailable ({e}) — using demo audio mode")


@app.on_event("startup")
async def startup():
    if os.environ.get("LOAD_TTS_ON_START", "1") == "1":
        load_tts_model()


class VoiceSession:
    def __init__(self, ws: WebSocket, sid: str):
        self.ws = ws
        self.sid = sid

        # Voice clone
        self.ref_audio_path: Optional[str] = None
        self.ref_text = ""

        # Agent config
        self.hook_word = "assistant"
        self.system_instruction = "Be a helpful and concise voice assistant."
        self.response_mappings: dict = {}
        self.llm_endpoint = os.environ.get("LLM_ENDPOINT")
        self.llm_api_key = os.environ.get("LLM_API_KEY")
        self.llm_model = os.environ.get("LLM_MODEL", "claude-haiku-4-5-20251001")

        # Leaky-window state machine
        self.is_activated = False
        self.last_activation_time = 0.0
        self.conversation_history: list = []

    async def send(self, **data):
        await self.ws.send_json(data)

    def save_ref_audio(self, b64: str) -> str:
        raw = base64.b64decode(b64)
        path = os.path.join(tempfile.gettempdir(), f"ref_{self.sid}.wav")
        with open(path, "wb") as f:
            f.write(raw)
        self.ref_audio_path = path
        return path

    def check_activation(self) -> bool:
        if self.is_activated and time.time() - self.last_activation_time > ACTIVATION_TIMEOUT:
            self.is_activated = False
        return self.is_activated

    async def run(self):
        await self.send(type="status", status="ready", message="Voice agent ready")
        try:
            while True:
                data = await self.ws.receive_json()
                t = data.get("type", "")
                if t == "setup_clone":
                    await self._setup_clone(data)
                elif t == "live_transcript":
                    await self._handle_transcript(data)
                elif t == "interrupt":
                    self.is_activated = False
                    self.conversation_history.clear()
                    await self.send(type="status", status="interrupted", message="Session reset")
                elif t == "update_config":
                    await self._update_config(data)
                elif t == "ping":
                    await self.send(type="pong", ts=data.get("ts"))
        except WebSocketDisconnect:
            print(f"[{self.sid}] disconnected")
        finally:
            if self.ref_audio_path and os.path.exists(self.ref_audio_path):
                try:
                    os.unlink(self.ref_audio_path)
                except OSError:
                    pass

    async def _setup_clone(self, data: dict):
        if "audio_b64" in data and data["audio_b64"]:
            self.save_ref_audio(data["audio_b64"])
        self.ref_text = data.get("ref_text", "")
        self.hook_word = data.get("hook_word", self.hook_word).lower().strip()
        self.system_instruction = data.get("instruction", self.system_instruction)
        self.response_mappings = data.get("response_mappings", self.response_mappings)
        await self.send(
            type="status",
            status="clone_ready",
            message=f"Voice profile configured. Hook: '{self.hook_word}'",
            hook_word=self.hook_word,
            has_ref_audio=self.ref_audio_path is not None,
            tts_available=tts_model is not None,
        )

    async def _handle_transcript(self, data: dict):
        transcript = (data.get("text") or "").strip()
        is_final = data.get("is_final", True)
        if not transcript:
            return

        t_lower = transcript.lower()
        hook_found = self.hook_word in t_lower
        active = self.check_activation()
        will_activate = active or hook_found

        await self.send(
            type="transcript_analysis",
            transcript=transcript,
            is_final=is_final,
            hook_detected=hook_found,
            is_activated=will_activate,
        )

        if not is_final or not will_activate:
            return

        self.is_activated = True
        self.last_activation_time = time.time()

        if hook_found:
            parts = t_lower.split(self.hook_word, 1)
            user_input = (parts[1] if len(parts) > 1 else transcript).strip()
        else:
            user_input = transcript.strip()

        if user_input:
            await self._respond(user_input)

    async def _update_config(self, data: dict):
        if "hook_word" in data:
            self.hook_word = data["hook_word"].lower().strip()
        if "instruction" in data:
            self.system_instruction = data["instruction"]
        if "response_mappings" in data:
            self.response_mappings = data["response_mappings"]
        await self.send(
            type="status", status="config_updated",
            message="Config updated", hook_word=self.hook_word,
        )

    def _build_response_text(self, user_input: str) -> str:
        for trigger, response in self.response_mappings.items():
            if trigger.lower() in user_input.lower():
                return response

        if self.llm_endpoint and self.llm_api_key:
            try:
                import urllib.request
                msgs = [
                    {"role": "system", "content": self.system_instruction},
                    *self.conversation_history,
                    {"role": "user", "content": user_input},
                ]
                payload = json.dumps({
                    "model": self.llm_model,
                    "messages": msgs,
                    "max_tokens": 200,
                }).encode()
                req = urllib.request.Request(
                    self.llm_endpoint, data=payload, method="POST",
                    headers={
                        "Content-Type": "application/json",
                        "Authorization": f"Bearer {self.llm_api_key}",
                    },
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    result = json.loads(resp.read())
                    text = result["choices"][0]["message"]["content"].strip()
                    self.conversation_history.append({"role": "user", "content": user_input})
                    self.conversation_history.append({"role": "assistant", "content": text})
                    self.conversation_history = self.conversation_history[-20:]
                    return text
            except Exception as e:
                print(f"[{self.sid}] LLM error: {e}")

        self.conversation_history.append({"role": "user", "content": user_input})
        resp = f"You said: {user_input}. How can I help you further?"
        self.conversation_history.append({"role": "assistant", "content": resp})
        return resp

    async def _respond(self, user_input: str):
        await self.send(type="generating", input=user_input, message="Generating response...")
        text = self._build_response_text(user_input)
        await self.send(type="response_text", text=text)
        self.last_activation_time = time.time()

        if tts_model is not None and self.ref_audio_path:
            await self._qwen_tts(text)
        else:
            await self._demo_audio(text)

    async def _qwen_tts(self, text: str):
        try:
            inputs = tts_processor(
                text=text,
                ref_audio_path=self.ref_audio_path,
                ref_text=self.ref_text or None,
                return_tensors="pt",
            )
            device = next(tts_model.parameters()).device
            inputs = {k: v.to(device) for k, v in inputs.items()}
            chunk = 4096
            with torch.no_grad():
                if hasattr(tts_model, "generate_streaming"):
                    async for audio_chunk in tts_model.generate_streaming(**inputs, chunk_size=chunk):
                        await self.ws.send_bytes(
                            audio_chunk.cpu().float().numpy().flatten().astype(np.float32).tobytes()
                        )
                        await asyncio.sleep(0)
                else:
                    output = tts_model.generate(**inputs, max_new_tokens=3000)
                    audio = output.cpu().float().numpy().flatten()
                    for i in range(0, len(audio), chunk):
                        await self.ws.send_bytes(audio[i:i + chunk].astype(np.float32).tobytes())
                        await asyncio.sleep(0)
            await self.send(type="audio_complete")
        except Exception as e:
            print(f"[{self.sid}] TTS error: {e}")
            await self._demo_audio(text)

    async def _demo_audio(self, text: str):
        """Sine-wave placeholder audio when TTS model is unavailable."""
        duration = max(1.5, len(text.split()) * 0.45)
        t = np.linspace(0, duration, int(SAMPLE_RATE * duration), dtype=np.float32)
        freq = 220 + (sum(ord(c) for c in text[:4]) % 220)
        audio = (
            0.35 * np.sin(2 * np.pi * freq * t)
            + 0.20 * np.sin(2 * np.pi * freq * 1.5 * t)
            + 0.10 * np.sin(2 * np.pi * freq * 2.0 * t)
        )
        fade = min(int(SAMPLE_RATE * 0.08), len(audio) // 6)
        audio[:fade] *= np.linspace(0, 1, fade)
        audio[-fade:] *= np.linspace(1, 0, fade)
        chunk = 4096
        for i in range(0, len(audio), chunk):
            await self.ws.send_bytes(audio[i:i + chunk].tobytes())
            await asyncio.sleep(0.012)
        await self.send(type="audio_complete", demo=True)


@app.websocket("/ws/voice-agent")
async def ws_endpoint(websocket: WebSocket, sid: str = Query(default="")):
    await websocket.accept()
    session_id = sid or uuid.uuid4().hex[:8]
    print(f"[{session_id}] New session")
    await VoiceSession(websocket, session_id).run()


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "tts_model_loaded": tts_model is not None,
        "tts_model_error": model_load_error,
        "cuda_available": torch.cuda.is_available() if torch else False,
        "sample_rate": SAMPLE_RATE,
        "activation_timeout": ACTIVATION_TIMEOUT,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
