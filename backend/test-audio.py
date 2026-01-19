import asyncio,edge_tts,subprocess,uuid,os,sys

MODEL="Frierenfrierenv3_E150_S15000"
TEXT="hello i'm frieren"
VOICE="en-US-AriaNeural"

base=f"base_{uuid.uuid4().hex[:6]}.wav"
out=f"{MODEL}.wav"
pth=f"models/{MODEL}.pth"
idx=f"models/{MODEL}.index"

async def tts():
    await edge_tts.Communicate(TEXT,VOICE).save(base)

asyncio.run(tts())

cmd=[
    sys.executable,"-m","rvc_python","cli",
    "-mp",pth,
    "-i",base,
    "-o",out,
    "-me","rmvpe",
    "-de","cpu"
]

if os.path.exists(idx):
    cmd+=["-ip",idx]

subprocess.run(cmd,check=True)

os.remove(base)
print(out)
