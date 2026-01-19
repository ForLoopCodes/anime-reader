const API_BASE = "http://localhost:8000";

let bubbleEl = null;
let bubbleBtn = null;
let bubbleStatus = null;
let selectionCache = null;
let currentAudio = null;
let cachedVoices = null;

let wordSpans = [];
let animationFrameId = null;
let currentTimings = [];
let lastHighlightedIndex = -1;

let characterContainer = null;
let characterImg = null;
let currentVoice = null;
let isReading = false;
let currentWordForLipSync = "";
let lipSyncLetterIndex = 0;
let lipSyncAnimationId = null;
let lastLipSyncTime = 0;
let isCurrentlyInWord = false;
let mouthOpenUntil = 0;
let darkenOverlay = null;

let settings = {
  highlightOpacity: 0.7,
  autoScrollEnabled: true,
  voiceImages: {},
  characterHeight: 50,
  characterMargin: 24,
};

const STYLE_ID = "anime-voice-reader-style";
const BUBBLE_ID = "anime-voice-reader-bubble";
const CHARACTER_ID = "anime-voice-reader-character";
const WORD_HIGHLIGHT_CLASS = "anime-voice-word-highlight";
const WORD_SPAN_CLASS = "anime-voice-word";
const PAGE_DIM_CLASS = "anime-voice-reader-dimmed";

async function loadSettings() {
  try {
    const stored = await chrome.storage.local.get([
      "highlightOpacity",
      "autoScrollEnabled",
      "voiceImages",
      "characterHeight",
      "characterMargin",
    ]);
    if (stored.highlightOpacity !== undefined)
      settings.highlightOpacity = stored.highlightOpacity;
    if (stored.autoScrollEnabled !== undefined)
      settings.autoScrollEnabled = stored.autoScrollEnabled;
    if (stored.voiceImages) settings.voiceImages = stored.voiceImages;
    if (stored.characterHeight !== undefined)
      settings.characterHeight = stored.characterHeight;
    if (stored.characterMargin !== undefined)
      settings.characterMargin = stored.characterMargin;
  } catch {}
}

chrome.storage.onChanged.addListener((changes) => {
  if (changes.highlightOpacity) {
    settings.highlightOpacity = changes.highlightOpacity.newValue;
    if (isReading) applyPageDim();
  }
  if (changes.autoScrollEnabled) {
    settings.autoScrollEnabled = changes.autoScrollEnabled.newValue;
  }
  if (changes.voiceImages) {
    settings.voiceImages = changes.voiceImages.newValue || {};
  }
  if (changes.characterHeight) {
    settings.characterHeight = changes.characterHeight.newValue;
    updateCharacterPosition();
  }
  if (changes.characterMargin) {
    settings.characterMargin = changes.characterMargin.newValue;
    updateCharacterPosition();
  }
});

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    #${BUBBLE_ID} {
      position: fixed;
      z-index: 2147483647;
      display: none;
      background: #09090b;
      color: #fafafa;
      border: 1px solid #27272a;
      border-radius: 8px;
      padding: 6px 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font-family: ui-monospace, monospace;
      font-size: 12px;
      gap: 6px;
      align-items: center;
    }
    #${BUBBLE_ID} button {
      background: #fafafa;
      border: none;
      color: #09090b;
      font-weight: 600;
      padding: 6px 12px;
      border-radius: 6px;
      cursor: pointer;
      font-family: inherit;
      transition: opacity 0.15s;
    }
    #${BUBBLE_ID} button:hover {
      opacity: 0.8;
    }
    #${BUBBLE_ID} .status {
      color: #71717a;
      margin-left: 6px;
      font-family: inherit;
    }
    #anime-voice-reader-darken {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: #000;
      pointer-events: none;
      z-index: 2147483640;
      display: none;
      transition: opacity 0.2s;
    }
    #${CHARACTER_ID} {
      position: fixed;
      bottom: 0;
      right: 24px;
      height: 50vh;
      z-index: 2147483646;
      display: none;
      pointer-events: none;
    }
    #${CHARACTER_ID} img {
      height: 100%;
      width: auto;
      object-fit: contain;
    }
    .${WORD_SPAN_CLASS} {
      position: relative;
      z-index: 2147483641;
    }
    .${WORD_HIGHLIGHT_CLASS} {
      background: linear-gradient(135deg, #a3eaff 0%, #0bc6f5 100%) !important;
      color: #09090b !important;
      border-radius: 3px;
      padding: 2px 4px;
      margin: -2px -4px;
      box-shadow: 0 2px 16px rgba(69, 187, 255, 0.6);
      z-index: 2147483642;
    }
  `;
  document.head.appendChild(style);
}

function ensureDarkenOverlay() {
  if (darkenOverlay) return;
  ensureStyles();
  darkenOverlay = document.createElement("div");
  darkenOverlay.id = "anime-voice-reader-darken";
  document.body.appendChild(darkenOverlay);
}

function applyPageDim() {
  ensureDarkenOverlay();
  darkenOverlay.style.opacity = settings.highlightOpacity;
  darkenOverlay.style.display = "block";
}

function removePageDim() {
  if (darkenOverlay) {
    darkenOverlay.style.display = "none";
  }
}

function ensureCharacterContainer() {
  if (characterContainer) return;
  ensureStyles();
  characterContainer = document.createElement("div");
  characterContainer.id = CHARACTER_ID;
  characterImg = document.createElement("img");
  characterImg.alt = "";
  characterContainer.appendChild(characterImg);
  document.body.appendChild(characterContainer);
}

function showCharacter() {
  ensureCharacterContainer();
  const images = settings.voiceImages[currentVoice];
  if (!images?.idle && !images?.speaking) {
    characterContainer.style.display = "none";
    return;
  }
  characterContainer.style.display = "block";
  updateCharacterPosition();
  if (images.idle) {
    characterImg.src = images.idle;
  } else if (images.speaking) {
    characterImg.src = images.speaking;
  }
}

function updateCharacterPosition() {
  if (!characterContainer) return;
  characterContainer.style.height = `${settings.characterHeight}vh`;
  characterContainer.style.right = `${settings.characterMargin}px`;
}

function hideCharacter() {
  if (characterContainer) {
    characterContainer.style.display = "none";
  }
  stopLipSync();
}

function isVowel(char) {
  return "aeiouyAEIOUY1234567890".includes(char);
}

function setMouthState(open) {
  const images = settings.voiceImages[currentVoice];
  if (!characterImg || !images) return;
  if (open && images.speaking) {
    characterImg.src = images.speaking;
  } else if (images.idle) {
    characterImg.src = images.idle;
  }
}

function updateLipSyncForWord(word, wordProgress) {
  const now = Date.now();

  if (now < mouthOpenUntil) {
    return;
  }

  if (!word || word.length === 0) {
    setMouthState(false);
    return;
  }

  const letters = word.replace(/[^a-zA-Z]/g, "");
  if (letters.length === 0) {
    setMouthState(false);
    return;
  }

  const letterIndex =
    Math.floor(wordProgress * letters.length * 2) % letters.length;
  const currentLetter = letters[letterIndex];
  const shouldOpen = isVowel(currentLetter) && Math.random() < 1;

  if (shouldOpen) {
    setMouthState(true);
    mouthOpenUntil = now + 150;
  } else {
    setMouthState(false);
  }
}

function startLipSync() {
  const images = settings.voiceImages[currentVoice];
  if (!images?.idle || !images?.speaking) return;
  setMouthState(false);
}

function stopLipSync() {
  if (lipSyncAnimationId) {
    cancelAnimationFrame(lipSyncAnimationId);
    lipSyncAnimationId = null;
  }
  currentWordForLipSync = "";
  lipSyncLetterIndex = 0;
  isCurrentlyInWord = false;
  mouthOpenUntil = 0;
  setMouthState(false);
}

function ensureBubble() {
  if (bubbleEl) return;
  ensureStyles();
  bubbleEl = document.createElement("div");
  bubbleEl.id = BUBBLE_ID;
  bubbleEl.style.display = "none";

  bubbleBtn = document.createElement("button");
  bubbleBtn.textContent = "Read";
  bubbleBtn.addEventListener("click", () => {
    if (selectionCache?.text) {
      speakSelection(selectionCache);
      window.getSelection().removeAllRanges();
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
  const top = Math.max(8, rect.top - 36);
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - 140);
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
    return { text, range: range.cloneRange(), rect };
  } catch {
    return null;
  }
}

async function loadVoices() {
  if (cachedVoices) return cachedVoices;
  try {
    const res = await fetch(`${API_BASE}/voices`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    cachedVoices = data.voices || [];
  } catch {
    cachedVoices = [];
  }
  return cachedVoices;
}

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^\w]/g, "");
}

function stopHighlighting() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  currentTimings = [];
  lastHighlightedIndex = -1;
  isReading = false;

  wordSpans.forEach((span) => {
    if (span?.classList) {
      span.classList.remove(WORD_HIGHLIGHT_CLASS);
    }
  });

  restoreOriginalNodes();
  removePageDim();
  hideCharacter();
}

function restoreOriginalNodes() {
  const spansToRestore = [...wordSpans];
  wordSpans = [];

  spansToRestore.forEach((span) => {
    try {
      if (span?.parentNode) {
        const textNode = document.createTextNode(span.textContent || "");
        span.parentNode.replaceChild(textNode, span);
      }
    } catch {}
  });

  try {
    document.body.normalize();
  } catch {}
}

function getTextNodesInRange(range) {
  const textNodes = [];
  const root = range.commonAncestorContainer;

  if (root.nodeType === Node.TEXT_NODE) {
    textNodes.push({
      node: root,
      start: range.startOffset,
      end: range.endOffset,
    });
    return textNodes;
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!node.nodeValue?.trim()) return NodeFilter.FILTER_REJECT;
      if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let node;
  while ((node = walker.nextNode())) {
    const start = node === range.startContainer ? range.startOffset : 0;
    const end =
      node === range.endContainer ? range.endOffset : node.nodeValue.length;
    textNodes.push({ node, start, end });
  }

  return textNodes;
}

function wrapWordsInSpans(range) {
  ensureStyles();
  const spans = [];

  let textNodes;
  try {
    textNodes = getTextNodesInRange(range);
  } catch {
    return spans;
  }

  for (const { node, start, end } of textNodes) {
    try {
      const text = node.nodeValue || "";
      const segment = text.slice(start, end);
      const regex = /\S+/g;
      const matches = [];
      let match;
      while ((match = regex.exec(segment))) {
        matches.push({ word: match[0], index: start + match.index });
      }

      if (matches.length === 0) continue;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;

      for (const m of matches) {
        if (m.index > lastIndex) {
          fragment.appendChild(
            document.createTextNode(text.slice(lastIndex, m.index))
          );
        }
        const span = document.createElement("span");
        span.className = WORD_SPAN_CLASS;
        span.textContent = m.word;
        spans.push(span);
        fragment.appendChild(span);
        lastIndex = m.index + m.word.length;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
      }

      if (node.parentNode) {
        node.parentNode.replaceChild(fragment, node);
      }
    } catch {}
  }

  return spans;
}

function buildTimingMap(timings, spans) {
  const map = [];
  let timingIndex = 0;

  for (
    let spanIndex = 0;
    spanIndex < spans.length && timingIndex < timings.length;
    spanIndex++
  ) {
    const spanWord = normalizeWord(spans[spanIndex].textContent || "");
    let found = false;

    for (let t = timingIndex; t < timings.length && t < timingIndex + 3; t++) {
      const timingWord = normalizeWord(timings[t].word || "");
      if (
        spanWord === timingWord ||
        spanWord.includes(timingWord) ||
        timingWord.includes(spanWord)
      ) {
        map[spanIndex] = t;
        timingIndex = t + 1;
        found = true;
        break;
      }
    }

    if (!found) {
      map[spanIndex] = -1;
    }
  }

  return map;
}

function scrollToWord(span) {
  if (!settings.autoScrollEnabled || !span) return;
  const rect = span.getBoundingClientRect();
  const buffer = 100;
  if (rect.top < buffer || rect.bottom > window.innerHeight - buffer) {
    span.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function startHighlightLoop(audio, timings, timingMap) {
  if (!audio || !timings.length || !wordSpans.length) return;

  function updateHighlight() {
    if (!currentAudio || currentAudio.paused || currentAudio.ended) {
      setMouthState(false);
      return;
    }

    const currentTime = audio.currentTime;
    let targetSpanIndex = -1;
    let currentTiming = null;
    let insideWordTiming = false;

    for (let i = 0; i < wordSpans.length; i++) {
      const timingIdx = timingMap[i];
      if (timingIdx === -1 || timingIdx === undefined) continue;

      const timing = timings[timingIdx];
      if (timing && currentTime >= timing.start && currentTime < timing.end) {
        targetSpanIndex = i;
        currentTiming = timing;
        insideWordTiming = true;
        break;
      }
    }

    if (targetSpanIndex === -1) {
      for (let i = wordSpans.length - 1; i >= 0; i--) {
        const timingIdx = timingMap[i];
        if (timingIdx === -1 || timingIdx === undefined) continue;

        const timing = timings[timingIdx];
        if (timing && currentTime >= timing.start) {
          const nextTimingIdx = timingIdx + 1;
          if (
            nextTimingIdx >= timings.length ||
            currentTime < timings[nextTimingIdx].start
          ) {
            targetSpanIndex = i;
            break;
          }
        }
      }
    }

    if (targetSpanIndex !== lastHighlightedIndex) {
      if (
        lastHighlightedIndex >= 0 &&
        lastHighlightedIndex < wordSpans.length
      ) {
        const oldSpan = wordSpans[lastHighlightedIndex];
        if (oldSpan?.classList) {
          oldSpan.classList.remove(WORD_HIGHLIGHT_CLASS);
        }
      }

      if (targetSpanIndex >= 0 && targetSpanIndex < wordSpans.length) {
        const span = wordSpans[targetSpanIndex];
        if (span?.classList) {
          span.classList.add(WORD_HIGHLIGHT_CLASS);
          scrollToWord(span);
        }
      }

      lastHighlightedIndex = targetSpanIndex;
    }

    if (insideWordTiming && currentTiming) {
      const wordDuration = currentTiming.end - currentTiming.start;
      const wordProgress = (currentTime - currentTiming.start) / wordDuration;
      const word = currentTiming.word || "";
      updateLipSyncForWord(word, Math.min(1, Math.max(0, wordProgress)));
    } else {
      setMouthState(false);
    }

    animationFrameId = requestAnimationFrame(updateHighlight);
  }

  animationFrameId = requestAnimationFrame(updateHighlight);
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
  stopHighlighting();

  setBubbleStatus("Loading...");

  const voice = await getSelectedVoice();
  if (!voice) {
    setBubbleStatus("No voice");
    return;
  }

  currentVoice = voice;

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

    if (!res.ok) throw new Error();
    const data = await res.json();
    if (!data?.audio) throw new Error();

    currentTimings = data.timings || [];
    wordSpans = wrapWordsInSpans(selection.range);

    if (wordSpans.length === 0) {
      setBubbleStatus("No words");
      return;
    }

    const timingMap = buildTimingMap(currentTimings, wordSpans);
    const audioBytes = Uint8Array.from(atob(data.audio), (c) =>
      c.charCodeAt(0)
    );
    const blob = new Blob([audioBytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    currentAudio = audio;

    isReading = true;
    applyPageDim();
    showCharacter();
    startLipSync();
    setBubbleStatus("▶ Playing");

    audio.addEventListener("play", () => {
      startHighlightLoop(audio, currentTimings, timingMap);
    });

    audio.addEventListener("ended", () => {
      setBubbleStatus("");
      stopHighlighting();
      URL.revokeObjectURL(url);
      currentAudio = null;
    });

    audio.addEventListener("pause", () => {
      if (audio.ended) return;
      setBubbleStatus("⏸");
      stopLipSync();
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    });

    audio.addEventListener("error", () => {
      setBubbleStatus("Error");
      stopHighlighting();
      currentAudio = null;
    });

    await audio.play();
  } catch {
    stopHighlighting();
    setBubbleStatus("Server error");
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
  if (selectionCache?.range) {
    try {
      const rect = selectionCache.range.getBoundingClientRect();
      if (rect.width > 0) {
        showBubbleAt(rect);
      }
    } catch {}
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideBubble();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    stopHighlighting();
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "GET_SELECTION") {
    const selection = window.getSelection()?.toString() || "";
    sendResponse({ text: selection });
    return true;
  }
  return false;
});

loadSettings();
