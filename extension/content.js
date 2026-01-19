const API_BASE = "http://localhost:8000";

let bubbleEl = null;
let bubbleBtn = null;
let bubbleStatus = null;
let selectionCache = null;
let currentAudio = null;
let highlightRanges = [];
let highlightSet = null;
let highlightTimeouts = [];
let cachedVoices = null;

const STYLE_ID = "anime-voice-reader-style";
const BUBBLE_ID = "anime-voice-reader-bubble";
const HIGHLIGHT_NAME = "anime-voice";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUBBLE_ID} {
      position: fixed;
      z-index: 2147483647;
      display: none;
      background: #0f172a;
      color: #e2e8f0;
      border: 1px solid #1f2937;
      border-radius: 10px;
      padding: 6px 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      font-family: "Segoe UI", system-ui, sans-serif;
      font-size: 12px;
      gap: 6px;
      align-items: center;
    }
    #${BUBBLE_ID} button {
      background: #38bdf8;
      border: none;
      color: #0b1220;
      font-weight: 600;
      padding: 6px 10px;
      border-radius: 8px;
      cursor: pointer;
    }
    #${BUBBLE_ID} .status {
      color: #94a3b8;
      margin-left: 6px;
    }
    ::highlight(${HIGHLIGHT_NAME}) {
      background: #fde047;
      color: #111827;
      border-radius: 4px;
    }
  `;
  document.head.appendChild(style);
}

function ensureBubble() {
  if (bubbleEl) return;
  ensureStyles();
  bubbleEl = document.createElement("div");
  bubbleEl.id = BUBBLE_ID;
  bubbleEl.style.display = "none";

  bubbleBtn = document.createElement("button");
  bubbleBtn.textContent = "Read this";
  bubbleBtn.addEventListener("click", () => {
    if (selectionCache?.text) {
      speakSelection(selectionCache);
    }
  });

  bubbleStatus = document.createElement("span");
  bubbleStatus.className = "status";
  bubbleStatus.textContent = "";

  bubbleEl.appendChild(bubbleBtn);
  bubbleEl.appendChild(bubbleStatus);
  document.body.appendChild(bubbleEl);
}

function setBubbleStatus(msg) {
  if (bubbleStatus) bubbleStatus.textContent = msg || "";
}

function showBubbleAt(rect) {
  ensureBubble();
  const padding = 8;
  const top = Math.max(8, rect.top - 36);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 160);
  bubbleEl.style.top = `${top}px`;
  bubbleEl.style.left = `${left}px`;
  bubbleEl.style.display = "flex";
}

function hideBubble() {
  if (bubbleEl) bubbleEl.style.display = "none";
  setBubbleStatus("");
}

function isEditableSelection(sel) {
  const anchor = sel?.anchorNode;
  if (!anchor) return false;
  const el =
    anchor.nodeType === Node.ELEMENT_NODE ? anchor : anchor.parentElement;
  if (!el) return false;
  return el.closest("input, textarea, [contenteditable='true']") !== null;
}

function getSelectionData() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return null;
  if (isEditableSelection(sel)) return null;
  const text = sel.toString().trim();
  if (!text) return null;
  try {
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    return { text, range, rect };
  } catch {
    return null;
  }
}

async function loadVoices() {
  if (cachedVoices) return cachedVoices;
  try {
    const res = await fetch(`${API_BASE}/voices`);
    if (!res.ok) throw new Error("Failed to load voices");
    const data = await res.json();
    cachedVoices = data.voices || [];
  } catch {
    cachedVoices = [];
  }
  return cachedVoices;
}

function clearHighlights() {
  highlightTimeouts.forEach((t) => clearTimeout(t));
  highlightTimeouts = [];
  if (highlightSet) highlightSet.clear();
  highlightRanges = [];
}

function initHighlights() {
  if (!("highlights" in CSS)) return null;
  if (!highlightSet) {
    highlightSet = new Highlight();
    CSS.highlights.set(HIGHLIGHT_NAME, highlightSet);
  }
  return highlightSet;
}

function getWordRanges(range) {
  const ranges = [];
  const root = range.commonAncestorContainer;
  if (root.nodeType === Node.TEXT_NODE) {
    const text = root.nodeValue || "";
    let start = 0;
    let end = text.length;
    if (root === range.startContainer) start = range.startOffset;
    if (root === range.endContainer) end = range.endOffset;
    if (start < end) {
      const segment = text.slice(start, end);
      const regex = /\S+/g;
      let match;
      while ((match = regex.exec(segment))) {
        const wordStart = start + match.index;
        const wordEnd = wordStart + match[0].length;
        const wordRange = document.createRange();
        wordRange.setStart(root, wordStart);
        wordRange.setEnd(root, wordEnd);
        ranges.push(wordRange);
      }
    }
    return ranges;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue || "";
    let start = 0;
    let end = text.length;
    if (node === range.startContainer) start = range.startOffset;
    if (node === range.endContainer) end = range.endOffset;
    if (start < end) {
      const segment = text.slice(start, end);
      const regex = /\S+/g;
      let match;
      while ((match = regex.exec(segment))) {
        const wordStart = start + match.index;
        const wordEnd = wordStart + match[0].length;
        const wordRange = document.createRange();
        wordRange.setStart(node, wordStart);
        wordRange.setEnd(node, wordEnd);
        ranges.push(wordRange);
      }
    }
    node = walker.nextNode();
  }
  return ranges;
}

function scheduleHighlights(timings) {
  clearHighlights();
  if (!timings || !timings.length || !highlightRanges.length) return;
  const highlight = initHighlights();
  if (!highlight) return;
  const length = Math.min(timings.length, highlightRanges.length);
  for (let i = 0; i < length; i += 1) {
    const t = timings[i];
    const startMs = Math.max(0, Math.floor(t.start * 1000));
    const endMs = Math.max(startMs + 10, Math.floor(t.end * 1000));
    highlightTimeouts.push(
      setTimeout(() => {
        highlight.clear();
        if (highlightRanges[i]) highlight.add(highlightRanges[i]);
      }, startMs),
    );
    highlightTimeouts.push(
      setTimeout(() => {
        highlight.clear();
      }, endMs),
    );
  }
}

async function getSelectedVoice() {
  const stored = await chrome.storage.local.get(["selectedVoice"]);
  if (stored.selectedVoice) return stored.selectedVoice;
  const voices = await loadVoices();
  const fallback = voices[0]?.name;
  if (fallback) await chrome.storage.local.set({ selectedVoice: fallback });
  return fallback;
}

async function speakSelection(selection) {
  if (!selection?.text) return;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  clearHighlights();
  setBubbleStatus("Loading...");

  const voice = await getSelectedVoice();
  if (!voice) {
    setBubbleStatus("No voices found");
    return;
  }
  highlightRanges = getWordRanges(selection.range);

  try {
    const res = await fetch(`${API_BASE}/speak`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: selection.text,
        character: voice,
        speed: 1.0,
      }),
    });
    if (!res.ok) throw new Error("TTS failed");
    const data = await res.json();
    if (!data?.audio) throw new Error("No audio returned");

    const audioBytes = Uint8Array.from(atob(data.audio), (c) =>
      c.charCodeAt(0),
    );
    const blob = new Blob([audioBytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    currentAudio = audio;
    scheduleHighlights(data.timings || []);
    setBubbleStatus("Playing");
    audio.addEventListener("ended", () => {
      setBubbleStatus("");
      clearHighlights();
    });
    audio.addEventListener("pause", () => {
      setBubbleStatus("");
    });
    await audio.play();
  } catch (err) {
    clearHighlights();
    setBubbleStatus("Server not reachable");
  }
}

let selectionTimer = null;
document.addEventListener("selectionchange", () => {
  if (selectionTimer) clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    const data = getSelectionData();
    selectionCache = data;
    if (!data) {
      hideBubble();
      return;
    }
    showBubbleAt(data.rect);
  }, 120);
});

document.addEventListener("scroll", () => {
  if (selectionCache?.rect) {
    const rect = selectionCache.range.getBoundingClientRect();
    showBubbleAt(rect);
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideBubble();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "GET_SELECTION") {
    const selection = window.getSelection()?.toString() || "";
    sendResponse({ text: selection });
    return true;
  }
  return false;
});
