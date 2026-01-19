const voiceSelect = document.getElementById("voiceSelect");
const textArea = document.getElementById("text");
const statusEl = document.getElementById("status");
const audioEl = document.getElementById("audio");
const speedEl = document.getElementById("speed");
const speedValueEl = document.getElementById("speedValue");
const opacityEl = document.getElementById("opacity");
const opacityValueEl = document.getElementById("opacityValue");
const autoScrollEl = document.getElementById("autoScroll");
const idleImageEl = document.getElementById("idleImage");
const speakingImageEl = document.getElementById("speakingImage");
const idlePreviewEl = document.getElementById("idlePreview");
const speakingPreviewEl = document.getElementById("speakingPreview");
const charHeightEl = document.getElementById("charHeight");
const charHeightValueEl = document.getElementById("charHeightValue");
const charMarginEl = document.getElementById("charMargin");
const charMarginValueEl = document.getElementById("charMarginValue");
const useSelectionBtn = document.getElementById("useSelection");
const speakBtn = document.getElementById("speak");

const API_BASE = "http://localhost:8000";

let voiceImages = {};

function setStatus(msg) {
  statusEl.textContent = msg;
}

function setSpeedLabel() {
  speedValueEl.textContent = `${Number(speedEl.value).toFixed(2)}x`;
}

function setOpacityLabel() {
  opacityValueEl.textContent = `${Math.round(opacityEl.value * 100)}%`;
}

function setCharHeightLabel() {
  charHeightValueEl.textContent = `${charHeightEl.value}vh`;
}

function setCharMarginLabel() {
  charMarginValueEl.textContent = `${charMarginEl.value}px`;
}

function updatePreviews() {
  idlePreviewEl.src = idleImageEl.value || "";
  speakingPreviewEl.src = speakingImageEl.value || "";
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
    if (!res.ok) throw new Error();
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
    loadVoiceImages();
    setStatus(voices.length ? "Ready" : "No voices available");
  } catch {
    setStatus("Server offline");
  }
}

async function loadSettings() {
  const stored = await chrome.storage.local.get([
    "highlightOpacity",
    "autoScrollEnabled",
    "voiceImages",
    "characterHeight",
    "characterMargin",
  ]);
  if (stored.highlightOpacity !== undefined) {
    opacityEl.value = stored.highlightOpacity;
    setOpacityLabel();
  }
  if (stored.autoScrollEnabled !== undefined) {
    autoScrollEl.checked = stored.autoScrollEnabled;
  }
  if (stored.voiceImages) {
    voiceImages = stored.voiceImages;
  }
  if (stored.characterHeight !== undefined) {
    charHeightEl.value = stored.characterHeight;
    setCharHeightLabel();
  }
  if (stored.characterMargin !== undefined) {
    charMarginEl.value = stored.characterMargin;
    setCharMarginLabel();
  }
}

function loadVoiceImages() {
  const voice = voiceSelect.value;
  if (!voice) return;
  const images = voiceImages[voice] || {};
  idleImageEl.value = images.idle || "";
  speakingImageEl.value = images.speaking || "";
  updatePreviews();
}

async function saveVoiceImages() {
  const voice = voiceSelect.value;
  if (!voice) return;
  voiceImages[voice] = {
    idle: idleImageEl.value.trim(),
    speaking: speakingImageEl.value.trim(),
  };
  await chrome.storage.local.set({ voiceImages });
}

async function speakText(text) {
  if (!text.trim()) {
    setStatus("No text");
    return;
  }
  const voice = voiceSelect.value;
  if (!voice) {
    setStatus("No voice");
    return;
  }

  setStatus("Generating...");
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
    if (!data.audio) throw new Error("No audio");

    const audioBytes = Uint8Array.from(atob(data.audio), (c) =>
      c.charCodeAt(0)
    );
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
  setStatus(text ? "Loaded" : "No selection");
});

speakBtn.addEventListener("click", async () => {
  const text = textArea.value || (await getSelectionText());
  await speakText(text);
});

voiceSelect.addEventListener("change", async () => {
  if (voiceSelect.value) {
    await chrome.storage.local.set({ selectedVoice: voiceSelect.value });
    loadVoiceImages();
  }
});

speedEl.addEventListener("input", setSpeedLabel);

opacityEl.addEventListener("input", () => {
  setOpacityLabel();
  chrome.storage.local.set({ highlightOpacity: Number(opacityEl.value) });
});

autoScrollEl.addEventListener("change", () => {
  chrome.storage.local.set({ autoScrollEnabled: autoScrollEl.checked });
});

let imageDebounce = null;
function onImageChange() {
  updatePreviews();
  if (imageDebounce) clearTimeout(imageDebounce);
  imageDebounce = setTimeout(saveVoiceImages, 500);
}

idleImageEl.addEventListener("input", onImageChange);
speakingImageEl.addEventListener("input", onImageChange);

charHeightEl.addEventListener("input", () => {
  setCharHeightLabel();
  chrome.storage.local.set({ characterHeight: Number(charHeightEl.value) });
});

charMarginEl.addEventListener("input", () => {
  setCharMarginLabel();
  chrome.storage.local.set({ characterMargin: Number(charMarginEl.value) });
});

setSpeedLabel();
setOpacityLabel();
setCharHeightLabel();
setCharMarginLabel();
loadSettings().then(loadVoices);
