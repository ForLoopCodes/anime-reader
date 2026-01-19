#!/usr/bin/env python3
import os,uuid,asyncio,subprocess,sys,json,base64,re,wave
from pathlib import Path
from typing import Optional

from fastapi import FastAPI,HTTPException,BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import edge_tts

BACKEND_DIR=Path(__file__).parent.resolve()
MODELS_DIR=BACKEND_DIR/"models"
TEMP_DIR=BACKEND_DIR/"temp"

MODELS_DIR.mkdir(exist_ok=True)
TEMP_DIR.mkdir(exist_ok=True)

DEFAULT_TTS_VOICE="en-US-AriaNeural"

app=FastAPI(
    title="Anime Voice Reader API",
    description="Text to Anime Voice using RVC",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SpeakRequest(BaseModel):
    text:str
    character:str
    speed:Optional[float]=1.0

class VoiceInfo(BaseModel):
    name:str
    has_index:bool

def cleanup(*paths):
    for p in paths:
        try:
            if p and p.exists(): p.unlink()
        except Exception:
            pass

def get_available_voices():
    out=[]
    for pth in MODELS_DIR.glob("*.pth"):
        out.append(VoiceInfo(
            name=pth.stem,
            has_index=(MODELS_DIR/f"{pth.stem}.index").exists()
        ))
    return sorted(out,key=lambda v:v.name)

async def tts_with_timings(text,out,speed):
    if speed==1.0:
        c=edge_tts.Communicate(text,DEFAULT_TTS_VOICE)
    else:
        c=edge_tts.Communicate(text,DEFAULT_TTS_VOICE,rate=f"{int((speed-1)*100):+d}%")
    timings=[]
    async for chunk in c.stream():
        if chunk["type"]=="audio":
            with open(out,"ab") as f:
                f.write(chunk["data"])
        elif chunk["type"]=="WordBoundary":
            timings.append({
                "word":chunk["text"],
                "start":chunk["offset"]/1e7,
                "end":(chunk["offset"]+chunk["duration"])/1e7
            })
    return timings

def rvc_convert(inp,out,character):
    pth=MODELS_DIR/f"{character}.pth"
    idx=MODELS_DIR/f"{character}.index"
    if not pth.exists():
        raise HTTPException(404,f"Voice model not found: {character}")
    cmd=[
        sys.executable,"-m","rvc_python","cli",
        "-mp",str(pth),
        "-i",str(inp),
        "-o",str(out),
        "-me","harvest",
        "-de","cuda"
    ]
    if idx.exists(): cmd+=["-ip",str(idx)]
    subprocess.run(cmd,check=True)

def estimate_timings(text,wav_path:Path):
    words=re.findall(r"\S+",text)
    if not words:
        return []
    try:
        with wave.open(str(wav_path),"rb") as wf:
            frames=wf.getnframes()
            rate=wf.getframerate()
            if rate<=0 or frames<=0:
                return []
            duration=frames/float(rate)
    except Exception:
        return []
    per=duration/len(words) if len(words) else 0
    if per<=0:
        return []
    timings=[]
    current=0.0
    for w in words:
        start=current
        end=current+per
        timings.append({"word":w,"start":start,"end":end})
        current=end
    return timings

@app.get("/")
async def root():
    return {"status":"ok"}

@app.get("/voices")
async def voices():
    v=get_available_voices()
    return {"voices":[i.model_dump() for i in v],"count":len(v)}

@app.post("/speak")
async def speak(req:SpeakRequest,background:BackgroundTasks):
    if not req.text.strip():
        raise HTTPException(400,"Text empty")
    if len(req.text)>5000:
        raise HTTPException(400,"Text too long")
    sid=uuid.uuid4().hex[:8]
    base=TEMP_DIR/f"base_{sid}.wav"
    out=TEMP_DIR/f"{req.character}_{sid}.wav"
    try:
        # Get TTS audio and word timings
        timings=await tts_with_timings(req.text,base,req.speed or 1.0)
        rvc_convert(base,out,req.character)
        if not out.exists():
            raise HTTPException(500,"Audio generation failed")

        if not timings:
            timings=estimate_timings(req.text,out)
        
        # Read audio file and convert to base64
        with open(out,"rb") as f:
            audio_data=f.read()
        audio_b64=base64.b64encode(audio_data).decode('utf-8')
        
        background.add_task(cleanup,base,out)
        
        # Return audio and timings together
        return JSONResponse({
            "audio":audio_b64,
            "timings":timings
        })
    except subprocess.CalledProcessError as e:
        cleanup(base,out)
        raise HTTPException(500,"RVC conversion failed")

@app.get("/voices/{character}/preview")
async def preview(character:str,background:BackgroundTasks):
    return await speak(
        SpeakRequest(
            text=f"Hello! I'm {character.replace('_',' ')}",
            character=character
        ),
        background
    )

@app.on_event("startup")
async def startup():
    for f in TEMP_DIR.glob("*"):
        try:f.unlink()
        except Exception:pass
    v=get_available_voices()
    print("\n🎭 Anime Voice Reader Server Starting...")
    print(f"📁 Models: {MODELS_DIR}")
    print(f"🎤 Voices: {len(v)}")
    for i in v[:10]: print(f" • {i.name}")
    print()

if __name__=="__main__":
    import uvicorn
    uvicorn.run("server:app",host="0.0.0.0",port=8000,reload=True)
