"""KittenTTS 2 clip service: speaks a to-do / reminder title (Hindi or English) and answers with a WAV file.

The model is loaded ONCE when the service starts, never per request, so a clip comes back in a second or two.
The backend calls this when a to-do is saved; the phone keeps the WAV and plays it when the reminder rings,
so nothing has to load at notification time.

Run:   .venv\\Scripts\\python server.py            (or start-tts.bat)
Env:   TTS_MODEL=nano|mini (default nano)   TTS_PORT=4100   TTS_HOST=127.0.0.1
       TTS_VOICE_HI=Priya   TTS_VOICE_EN=Eleanor   TTS_SECRET=<shared secret the backend sends in x-tts-secret>

POST /speak  {"text": "दूध लाना", "lang": "hi"|"en" (optional, guessed from the letters)}  → audio/wav (PCM 16-bit, mono)
GET  /health → {"ok": true, "model": ..., "voices": {...}}
"""
import io
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import soundfile as sf
from kittenml import KittenTTS2Tiny

MODEL = os.environ.get("TTS_MODEL", "nano").strip().lower()
HOST = os.environ.get("TTS_HOST", "127.0.0.1")
PORT = int(os.environ.get("TTS_PORT", "4100"))
SECRET = os.environ.get("TTS_SECRET", "")
MAX_CHARS = 160
DEVANAGARI = re.compile(r"[ऀ-ॿ]")
# emoji, symbols and the like are not spoken
NOT_SPOKEN = re.compile(r"[🀀-🫿⌀-⏿☀-➿⬀-⯿️‍]")

if MODEL not in ("nano", "mini"):
    sys.exit(f"TTS_MODEL must be nano or mini (got {MODEL!r})")

t0 = time.time()
tts = KittenTTS2Tiny(f"KittenML/kitten-tts-2-{MODEL}")
lock = threading.Lock()  # one synthesis at a time: the ONNX session is shared


def _names(lang):
    return [v["name"] if isinstance(v, dict) else v for v in tts.voices(lang)]


def _pick(lang, wanted, fallback):
    have = _names(lang)
    for v in (wanted, fallback):
        if v and v in have:
            return v
    return have[0]


VOICES = {
    "hi": _pick("hi", os.environ.get("TTS_VOICE_HI"), "Priya"),
    "en": _pick("en", os.environ.get("TTS_VOICE_EN"), "Eleanor"),
}
# warm up both languages now: the first Hindi call loads its text front-end (about a minute the very first time)
for _lang, _text in (("hi", "नमस्ते"), ("en", "Hello")):
    tts.generate(_text, voice=VOICES[_lang], language=_lang)
print(f"KittenTTS 2 {MODEL} loaded and warmed up in {time.time() - t0:.1f}s, voices {VOICES}", flush=True)


def clean(text):
    text = NOT_SPOKEN.sub("", text or "")
    return re.sub(r"\s+", " ", text).strip()[:MAX_CHARS]


def guess_lang(text):
    return "hi" if DEVANAGARI.search(text) else "en"


def speak(text, lang):
    with lock:
        audio = np.asarray(tts.generate(text, voice=VOICES[lang], language=lang), dtype=np.float32).reshape(-1)
    rate = tts.sample_rate
    # a little silence around it: some phones cut the first moment of a notification sound
    pad = np.zeros(int(rate * 0.25), dtype=np.float32)
    audio = np.concatenate([pad, audio, pad])
    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    if peak > 0:
        audio = audio * (0.95 / peak)  # even loudness from clip to clip
    buf = io.BytesIO()
    sf.write(buf, audio, rate, subtype="PCM_16", format="WAV")
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "kitten-tts-clips/1"

    def _send(self, code, body, ctype="application/json"):
        self.send_response(code)
        self.send_header("content-type", ctype)
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _json(self, code, obj):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"))

    def do_GET(self):
        if self.path == "/health":
            return self._json(200, {"ok": True, "model": MODEL, "voices": VOICES})
        self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/speak":
            return self._json(404, {"error": "not found"})
        if SECRET and self.headers.get("x-tts-secret") != SECRET:
            return self._json(401, {"error": "bad secret"})
        try:
            size = int(self.headers.get("content-length") or 0)
            body = json.loads(self.rfile.read(min(size, 8192)) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "send JSON: {\"text\": \"...\"}"})
        text = clean(str(body.get("text", "")))
        if not text:
            return self._json(400, {"error": "text is empty"})
        lang = body.get("lang") if body.get("lang") in VOICES else guess_lang(text)
        t1 = time.time()
        try:
            wav = speak(text, lang)
        except Exception as e:  # noqa: BLE001 — answer, don't crash the service
            print(f"speak failed for {text!r}: {e}", flush=True)
            return self._json(500, {"error": "could not speak this text"})
        print(f"{lang} {len(wav) // 1024} KB in {time.time() - t1:.2f}s  {text}", flush=True)
        self.send_response(200)
        self.send_header("content-type", "audio/wav")
        self.send_header("content-length", str(len(wav)))
        self.send_header("x-tts-lang", lang)
        self.send_header("x-tts-voice", VOICES[lang])
        self.send_header("x-tts-model", MODEL)
        self.end_headers()
        self.wfile.write(wav)

    def log_message(self, *_):  # the speak() line above is enough
        pass


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"listening on http://{HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
