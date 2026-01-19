const voiceSelect = document.getElementById("voiceSelect");
const textArea = document.getElementById("text");
const statusEl = document.getElementById("status");
const audioEl = document.getElementById("audio");
const speedEl = document.getElementById("speed");
const speedValueEl = document.getElementById("speedValue");
const useSelectionBtn = document.getElementById("useSelection");
const speakBtn = document.getElementById("speak");

const API_BASE = "http://localhost:8000";

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setSpeedLabel() {
  speedValueEl.textContent = `${Number(speedEl.value).toFixed(2)}x`;
}

async function getSelectionText() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return "";
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" }, (resp) => {
      resolve(resp?.text || "");
    });
  });
}

async function loadVoices() {
  setStatus("Loading voices...");
  try {
    const res = await fetch(`${API_BASE}/voices`);
    if (!res.ok) throw new Error("Failed to load voices");
    const data = await res.json();
    const voices = data.voices || [];
    voiceSelect.innerHTML = "";
    for (const v of voices) {
      const opt = document.createElement("option");
      opt.value = v.name;
      opt.textContent = v.name;
      voiceSelect.appendChild(opt);
    }
    if (!voices.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "No voices found";
      voiceSelect.appendChild(opt);
    }
    const stored = await chrome.storage.local.get(["selectedVoice"]);
    if (
      stored.selectedVoice &&
      voices.some((v) => v.name === stored.selectedVoice)
    ) {
      voiceSelect.value = stored.selectedVoice;
    } else if (voices.length) {
      voiceSelect.value = voices[0].name;
      await chrome.storage.local.set({ selectedVoice: voices[0].name });
    }
    setStatus(voices.length ? "Ready" : "No voices available");
  } catch (err) {
    setStatus("Server not reachable. Start backend server.");
  }
}

async function speakText(text) {
  if (!text.trim()) {
    setStatus("No text to speak");
    return;
  }
  const voice = voiceSelect.value;
  if (!voice) {
    setStatus("Select a voice");
    return;
  }

  setStatus("Generating audio...");
  speakBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        character: voice,
        speed: Number(speedEl.value),
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(errText || "TTS failed");
    }
    const data = await res.json();
    const audioB64 = data.audio;
    if (!audioB64) throw new Error("No audio returned");

    const audioBytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
    const blob = new Blob([audioBytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);
    audioEl.src = url;
    await audioEl.play();
    setStatus("Playing");
  } catch (err) {
    setStatus(`Error: ${err.message || err}`);
  } finally {
    speakBtn.disabled = false;
  }
}

useSelectionBtn.addEventListener("click", async () => {
  const text = await getSelectionText();
  textArea.value = text || textArea.value;
  if (text) setStatus("Selection loaded");
  else setStatus("No selection found");
});

speakBtn.addEventListener("click", async () => {
  const text = textArea.value || (await getSelectionText());
  await speakText(text);
});

voiceSelect.addEventListener("change", async () => {
  if (voiceSelect.value) {
    await chrome.storage.local.set({ selectedVoice: voiceSelect.value });
  }
});

speedEl.addEventListener("input", setSpeedLabel);

setSpeedLabel();
loadVoices();
