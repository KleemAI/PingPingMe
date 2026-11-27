# To-do voice clips (KittenTTS 2)

When a to-do or reminder is saved, the phone asks the backend to say its title out loud. The backend asks this
service, the phone keeps the WAV, and the notification is scheduled with that file as its sound. When the reminder
rings — app closed, phone locked — the phone only plays the saved file. No model is loaded at that moment.

```
phone (on save/sync) ──POST /api/v1/tts/clip {text}──▶ backend (keeps recent clips) ──POST /speak──▶ this service
phone keeps the clip:  Android → files/reminder-voice/*.wav + its own notification channel (modules/reminder-voice)
                       iOS     → Library/Sounds/*.wav (notification sound by name)
```

* Model: KittenTTS 2 **nano** by default (fast, ~1–2 s per title). `TTS_MODEL=mini` for the bigger model.
* Language: Hindi when the title has Devanagari letters (voice Priya), otherwise English (voice Eleanor).
  Change them with `TTS_VOICE_HI` / `TTS_VOICE_EN`.
* Start: `start-tts.bat` (it sets up `.venv` the first time). The first start downloads the model and warms up both
  languages (about 30 s), so no request pays that cost.
* Backend: `TTS_URL` (default `http://127.0.0.1:4100`, empty = off) and optional `TTS_SECRET`.
  When the service is off, phones ring with the normal notification sound.
* The Android part is native code: it needs a new APK build (`mobile\build-apk.bat`). Older builds and Expo Go keep
  ringing with the normal sound.

`make_samples.py` is the listening test used to compare pico / nano / mini.
