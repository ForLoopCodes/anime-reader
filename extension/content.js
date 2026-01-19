const API_BASE = "http://localhost:8000";

let bubbleEl = null;
let bubbleBtn = null;
let bubbleStatus = null;
let selectionCache = null;
let currentAudio = null;
let cachedVoices = null;

// Word highlighting system - using real-time sync
let wordSpans = [];
let animationFrameId = null;
let currentTimings = [];
let lastHighlightedIndex = -1;

const STYLE_ID = "anime-voice-reader-style";
const BUBBLE_ID = "anime-voice-reader-bubble";
const WORD_HIGHLIGHT_CLASS = "anime-voice-word-highlight";
const WORD_SPAN_CLASS = "anime-voice-word";

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
      transition: background 0.15s;
    }
    #${BUBBLE_ID} button:hover {
      background: #7dd3fc;
    }
    #${BUBBLE_ID} .status {
      color: #94a3b8;
      margin-left: 6px;
    }
    .${WORD_SPAN_CLASS} {
      transition: all 0.08s ease-out;
    }
    .${WORD_HIGHLIGHT_CLASS} {
      background: linear-gradient(135deg, #a3eaff 0%, #0bc6f5 100%) !important;
      color: #111827 !important;
      border-radius: 3px;
      padding: 2px 4px;
      margin: -2px -4px;
      box-shadow: 0 2px 12px rgba(69, 187, 255, 0.32);
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
    return { text, range: range.cloneRange(), rect };
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

// ============ REAL-TIME WORD HIGHLIGHTING SYSTEM ============

function normalizeWord(word) {
  return word.toLowerCase().replace(/[^\w]/g, "");
}

/**
 * Stop the highlight animation loop and restore DOM
 */
function stopHighlighting() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  currentTimings = [];
  lastHighlightedIndex = -1;

  // Remove all highlights
  wordSpans.forEach((span) => {
    if (span && span.classList) {
      span.classList.remove(WORD_HIGHLIGHT_CLASS);
    }
  });

  // Restore DOM
  restoreOriginalNodes();
}

/**
 * Restore the original DOM by replacing spans with text nodes
 */
function restoreOriginalNodes() {
  const spansToRestore = [...wordSpans];
  wordSpans = [];

  spansToRestore.forEach((span) => {
    try {
      if (span && span.parentNode) {
        const textNode = document.createTextNode(span.textContent || "");
        span.parentNode.replaceChild(textNode, span);
      }
    } catch (e) {
      // Ignore errors during cleanup
    }
  });

  // Normalize to merge adjacent text nodes
  try {
    document.body.normalize();
  } catch (e) {
    // Ignore
  }
}

/**
 * Get all text nodes within a range
 */
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
      if (!node.nodeValue || !node.nodeValue.trim())
        return NodeFilter.FILTER_REJECT;
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

/**
 * Wrap words in spans for highlighting
 */
function wrapWordsInSpans(range) {
  ensureStyles();
  const spans = [];

  let textNodes;
  try {
    textNodes = getTextNodesInRange(range);
  } catch (e) {
    console.error("Failed to get text nodes:", e);
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
        matches.push({
          word: match[0],
          index: start + match.index,
        });
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
    } catch (e) {
      console.error("Failed to wrap words in node:", e);
    }
  }

  return spans;
}

/**
 * Build a mapping from span index to timing index
 */
function buildTimingMap(timings, spans) {
  const map = []; // map[spanIndex] = timingIndex
  let timingIndex = 0;

  for (
    let spanIndex = 0;
    spanIndex < spans.length && timingIndex < timings.length;
    spanIndex++
  ) {
    const spanWord = normalizeWord(spans[spanIndex].textContent || "");

    // Look for this word in remaining timings
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
      // Skip this span, no matching timing
      map[spanIndex] = -1;
    }
  }

  return map;
}

/**
 * Real-time highlight loop using audio.currentTime
 */
function startHighlightLoop(audio, timings, timingMap) {
  if (!audio || !timings.length || !wordSpans.length) return;

  function updateHighlight() {
    if (!currentAudio || currentAudio.paused || currentAudio.ended) {
      return;
    }

    const currentTime = audio.currentTime;
    let targetSpanIndex = -1;

    // Find which span should be highlighted based on current time
    for (let i = 0; i < wordSpans.length; i++) {
      const timingIdx = timingMap[i];
      if (timingIdx === -1 || timingIdx === undefined) continue;

      const timing = timings[timingIdx];
      if (timing && currentTime >= timing.start && currentTime < timing.end) {
        targetSpanIndex = i;
        break;
      }
    }

    // Also check if we're past a word's start but before the next word starts
    if (targetSpanIndex === -1) {
      for (let i = wordSpans.length - 1; i >= 0; i--) {
        const timingIdx = timingMap[i];
        if (timingIdx === -1 || timingIdx === undefined) continue;

        const timing = timings[timingIdx];
        if (timing && currentTime >= timing.start) {
          // Check if there's a next timing
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

    // Update highlight if changed
    if (targetSpanIndex !== lastHighlightedIndex) {
      // Remove old highlight
      if (
        lastHighlightedIndex >= 0 &&
        lastHighlightedIndex < wordSpans.length
      ) {
        const oldSpan = wordSpans[lastHighlightedIndex];
        if (oldSpan && oldSpan.classList) {
          oldSpan.classList.remove(WORD_HIGHLIGHT_CLASS);
        }
      }

      // Add new highlight
      if (targetSpanIndex >= 0 && targetSpanIndex < wordSpans.length) {
        const span = wordSpans[targetSpanIndex];
        if (span && span.classList) {
          span.classList.add(WORD_HIGHLIGHT_CLASS);
        }
      }

      lastHighlightedIndex = targetSpanIndex;
    }

    animationFrameId = requestAnimationFrame(updateHighlight);
  }

  animationFrameId = requestAnimationFrame(updateHighlight);
}

// ============ END WORD HIGHLIGHTING SYSTEM ============

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

  // Stop any existing audio and highlighting
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  stopHighlighting();

  setBubbleStatus("Loading...");

  const voice = await getSelectedVoice();
  if (!voice) {
    setBubbleStatus("No voices found");
    return;
  }

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

    // Store timings
    currentTimings = data.timings || [];

    // Wrap words in spans
    wordSpans = wrapWordsInSpans(selection.range);

    if (wordSpans.length === 0) {
      setBubbleStatus("No words found");
      return;
    }

    // Build timing map
    const timingMap = buildTimingMap(currentTimings, wordSpans);

    // Create audio
    const audioBytes = Uint8Array.from(atob(data.audio), (c) =>
      c.charCodeAt(0)
    );
    const blob = new Blob([audioBytes], { type: "audio/wav" });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    currentAudio = audio;

    setBubbleStatus("▶ Playing");

    // Start highlight loop when audio plays
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
      setBubbleStatus("⏸ Paused");
      // Stop the animation loop but don't restore DOM
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
    });

    audio.addEventListener("error", () => {
      setBubbleStatus("Audio error");
      stopHighlighting();
      currentAudio = null;
    });

    await audio.play();
  } catch (err) {
    console.error("Speak error:", err);
    stopHighlighting();
    setBubbleStatus("Server not reachable");
  }
}

// Selection handling
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
    } catch {
      // Range may become invalid after DOM changes
    }
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
  if (msg && msg.type === "GET_SELECTION") {
    const selection = window.getSelection()?.toString() || "";
    sendResponse({ text: selection });
    return true;
  }
  return false;
});
