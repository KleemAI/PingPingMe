"""Listening test: the same to-do titles spoken by KittenTTS 2 pico / nano / mini (Hindi + English).

Run:  .venv\\Scripts\\python make_samples.py
Writes samples/<model>/<nn>-<voice>.wav and samples/index.json (for samples/index.html).
"""
import json
import os
import sys
import time

import soundfile as sf
from kittenml import KittenTTS2Tiny

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "samples")

# real-looking to-do titles: Devanagari Hindi, English, and two Hinglish ones (Latin letters) to hear the difference
TITLES = [
    ("hi", "दूध लाना"),
    ("hi", "बिजली का बिल भरना"),
    ("hi", "शाम को माँ को फ़ोन करना"),
    ("hi", "कल सुबह दस बजे डॉक्टर के पास जाना"),
    ("hi", "राहुल को पैसे भेजना"),
    ("hi", "मीटिंग की तैयारी करना"),
    ("hi", "दवाई लेना मत भूलना"),
    ("hi", "ग्राहक को कोटेशन भेजना"),
    ("en", "Call the bank"),
    ("en", "Send the invoice to Priya"),
    ("en", "Team meeting at five"),
    ("en", "Pick up the parcel from the courier office"),
    ("en", "Renew the shop licence"),
    ("en", "Pay the electricity bill"),
    ("en", "doodh lana"),            # Hinglish, read by the English model
    ("en", "bijli ka bill bharna"),  # Hinglish
]
MODELS = ["pico", "nano", "mini"]
HI_VOICES = ["Priya", "Arjun"]


def main():
    os.makedirs(OUT, exist_ok=True)
    index = {"titles": [{"n": i + 1, "lang": l, "text": t} for i, (l, t) in enumerate(TITLES)], "models": {}}
    for name in MODELS:
        t0 = time.time()
        m = KittenTTS2Tiny(f"KittenML/kitten-tts-2-{name}")
        names = lambda lang: [v["name"] if isinstance(v, dict) else v for v in m.voices(lang)]  # noqa: E731
        en_all = names("en")
        en_voices = [v for v in ("Eleanor", "Max") if v in en_all] or en_all[:2]
        print(f"{name}: loaded in {time.time() - t0:.1f}s; hi voices {names('hi')}; en voices {en_all}", flush=True)
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        clips = []
        for i, (lang, text) in enumerate(TITLES):
            for voice in (HI_VOICES if lang == "hi" else en_voices):
                t1 = time.time()
                audio = m.generate(text, voice=voice, language=lang)
                file = f"{i + 1:02d}-{voice}.wav"
                sf.write(os.path.join(d, file), audio, m.sample_rate, subtype="PCM_16")
                secs = len(audio) / m.sample_rate
                clips.append({"n": i + 1, "voice": voice, "file": f"{name}/{file}", "seconds": round(secs, 2),
                              "made_in": round(time.time() - t1, 2)})
                print(f"  {name} {i + 1:02d} {voice:8s} {secs:4.1f}s audio in {time.time() - t1:.2f}s  {text}", flush=True)
        index["models"][name] = clips
    with open(os.path.join(OUT, "index.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print("done")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
