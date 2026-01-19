/**
 * content.js
 *
 * Injected into web pages to detect text selection
 * and display the floating "Read" button.
 */

// Configuration
const BUTTON_OFFSET = 10; // Pixels from cursor
const MIN_SELECTION_LENGTH = 3;
const MAX_SELECTION_LENGTH = 5000;

// State
let floatingButton = null;
let lastSelection = "";
let highlayerElement = null;
let wordTimings = [];
let currentPlaybackTime = 0;

/**
 * Create the floating read button element
 */
function createFloatingButton() {
  const button = document.createElement("div");
  button.id = "anime-voice-reader-btn";
  button.innerHTML = "🔊 Read";
  button.style.cssText = `
    position: fixed;
    z-index: 2147483647;
    background: linear-gradient(135deg, #ff6b9d 0%, #c44569 100%);
    color: white;
    padding: 8px 14px;
    border-radius: 20px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    display: none;
    user-select: none;
    transition: transform 0.15s ease, box-shadow 0.15s ease;
  `;

  button.addEventListener("mouseenter", () => {
    button.style.transform = "scale(1.05)";
    button.style.boxShadow = "0 6px 16px rgba(0, 0, 0, 0.4)";
  });

  button.addEventListener("mouseleave", () => {
    button.style.transform = "scale(1)";
    button.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.3)";
  });

  button.addEventListener("click", handleReadClick);

  document.body.appendChild(button);
  return button;
}

/**
 * Show the floating button at the specified position
 */
function showButton(x, y) {
  if (!floatingButton) {
    floatingButton = createFloatingButton();
  }

  // Ensure button stays within viewport
  const buttonWidth = 100; // Approximate
  const buttonHeight = 36;

  const maxX = window.innerWidth - buttonWidth - 10;
  const maxY = window.innerHeight - buttonHeight - 10;

  const posX = Math.min(Math.max(10, x + BUTTON_OFFSET), maxX);
  const posY = Math.min(Math.max(10, y + BUTTON_OFFSET), maxY);

  floatingButton.style.left = `${posX}px`;
  floatingButton.style.top = `${posY}px`;
  floatingButton.style.display = "block";
  floatingButton.innerHTML = "🔊 Read";
}

/**
 * Hide the floating button
 */
function hideButton() {
  if (floatingButton) {
    floatingButton.style.display = "none";
  }
}

/**
 * Create a highlight layer overlay for the selected text
 */
function createHighlightLayer(selection) {
  // Remove existing highlight layer
  if (highlayerElement && highlayerElement.parentNode) {
    highlayerElement.parentNode.removeChild(highlayerElement);
  }

  // Create container for highlights
  highlayerElement = document.createElement("div");
  highlayerElement.id = "anime-voice-reader-highlight-layer";
  highlayerElement.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2147483646;
  `;

  // Get all ranges from selection
  const ranges = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    ranges.push(selection.getRangeAt(i));
  }

  // Create highlights for each range
  ranges.forEach((range) => {
    const rect = range.getBoundingClientRect();
    const highlight = document.createElement("div");
    highlight.className = "anime-voice-reader-word-highlight";
    highlight.style.cssText = `
      position: fixed;
      top: ${window.scrollY + rect.top}px;
      left: ${window.scrollX + rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      background-color: rgba(255, 215, 0, 0.4);
      border-radius: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.1s ease;
    `;
    highlayerElement.appendChild(highlight);
  });

  document.body.appendChild(highlayerElement);
}

/**
 * Update word highlighting based on current playback time
 */
function updateWordHighlight(currentTime) {
  currentPlaybackTime = currentTime;

  if (!highlayerElement) return;

  const highlights = highlayerElement.querySelectorAll(
    ".anime-voice-reader-word-highlight",
  );
  highlights.forEach((highlight, index) => {
    if (wordTimings[index]) {
      const timing = wordTimings[index];
      const isActive = currentTime >= timing.start && currentTime < timing.end;
      highlight.style.opacity = isActive ? "1" : "0.2";
      if (isActive) {
        highlight.style.backgroundColor = "rgba(255, 69, 0, 0.6)"; // Orange-red for active
      } else {
        highlight.style.backgroundColor = "rgba(255, 215, 0, 0.4)"; // Gold for upcoming
      }
    }
  });
}

/**
 * Clean up highlight layer
 */
function removeHighlightLayer() {
  if (highlayerElement && highlayerElement.parentNode) {
    highlayerElement.parentNode.removeChild(highlayerElement);
    highlayerElement = null;
    wordTimings = [];
  }
}

/**
 * Handle the read button click
 */
async function handleReadClick(event) {
  event.preventDefault();
  event.stopPropagation();

  if (!lastSelection) {
    hideButton();
    return;
  }

  // Update button to show loading state
  floatingButton.innerHTML = "⏳ Loading...";
  floatingButton.style.pointerEvents = "none";

  try {
    // Send message to background script
    const response = await chrome.runtime.sendMessage({
      type: "READ_TEXT",
      text: lastSelection,
    });

    if (response && response.error) {
      console.error("Error from background:", response.error);
      floatingButton.innerHTML = "❌ Error";
      setTimeout(hideButton, 1500);
    } else {
      floatingButton.innerHTML = "🔊 Playing...";
      // Button will be hidden after audio finishes (handled by background)
      setTimeout(() => {
        hideButton();
        floatingButton.style.pointerEvents = "auto";
      }, 1000);
    }
  } catch (error) {
    console.error("Failed to send message:", error);
    floatingButton.innerHTML = "❌ Failed";
    setTimeout(() => {
      hideButton();
      floatingButton.style.pointerEvents = "auto";
    }, 1500);
  }
}

/**
 * Handle text selection
 */
function handleSelection(event) {
  // Small delay to allow selection to complete
  setTimeout(() => {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    // Validate selection
    if (
      selectedText.length >= MIN_SELECTION_LENGTH &&
      selectedText.length <= MAX_SELECTION_LENGTH
    ) {
      lastSelection = selectedText;
      showButton(event.clientX, event.clientY);
    } else {
      lastSelection = "";
    }
  }, 10);
}

/**
 * Handle clicks outside the button (to hide it)
 */
function handleDocumentClick(event) {
  if (floatingButton && !floatingButton.contains(event.target)) {
    // Check if there's still a selection
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length < MIN_SELECTION_LENGTH) {
      hideButton();
      lastSelection = "";
    }
  }
}

/**
 * Handle keyboard shortcuts
 */
function handleKeydown(event) {
  // Hide button on Escape
  if (event.key === "Escape") {
    hideButton();
    lastSelection = "";
  }

  // Read selection on Ctrl+Shift+R (optional hotkey)
  if (event.ctrlKey && event.shiftKey && event.key === "R") {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length >= MIN_SELECTION_LENGTH) {
      lastSelection = selectedText;
      handleReadClick(event);
    }
  }
}

/**
 * Listen for messages from background script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_READING") {
    // Text is about to be read - create highlight layer
    const selection = window.getSelection();
    createHighlightLayer(selection);
    wordTimings = message.timings || [];
    console.log("📖 Started reading with", wordTimings.length, "word timings");
  } else if (message.type === "PLAYBACK_UPDATE") {
    // Update highlight based on current playback time
    updateWordHighlight(message.currentTime);
  } else if (message.type === "AUDIO_FINISHED") {
    // Clean up highlights
    removeHighlightLayer();
    hideButton();
    if (floatingButton) {
      floatingButton.style.pointerEvents = "auto";
      floatingButton.innerHTML = "🔊 Read";
    }
  } else if (message.type === "AUDIO_ERROR") {
    // Clean up on error
    removeHighlightLayer();
    if (floatingButton) {
      floatingButton.innerHTML = "❌ " + (message.error || "Error");
      floatingButton.style.pointerEvents = "auto";
      setTimeout(hideButton, 2000);
    }
  }
  sendResponse({ received: true });
});

// Event Listeners
document.addEventListener("mouseup", handleSelection);
document.addEventListener("click", handleDocumentClick);
document.addEventListener("keydown", handleKeydown);

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  if (floatingButton && floatingButton.parentNode) {
    floatingButton.parentNode.removeChild(floatingButton);
  }
});

console.log("🎭 Anime Voice Reader content script loaded");
