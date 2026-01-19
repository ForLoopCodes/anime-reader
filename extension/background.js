/**
 * background.js
 *
 * Service worker for the Anime Voice Reader extension.
 * Handles communication between content scripts and the backend API.
 */

const API_BASE = "http://localhost:8000";

// Keep track of current audio
let currentAudio = null;

// Keep track of active ports to prevent service worker termination
let activePorts = new Set();

/**
 * Stop any currently playing audio
 */
function stopCurrentAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

/**
 * Get saved settings from storage
 */
async function getSettings() {
  const settings = await chrome.storage.local.get(["character", "speed"]);
  return {
    character: settings.character || null,
    speed: settings.speed || 1.0,
  };
}

/**
 * Send message to content script in the active tab
 */
async function notifyContentScript(message) {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, message);
      } catch (sendError) {
        // Silently fail if content script is not ready or context is invalid
        if (!sendError.message?.includes("Could not establish connection")) {
          console.debug(
            "Content script notification failed:",
            sendError.message,
          );
        }
      }
    }
  } catch (error) {
    console.debug("Could not notify content script:", error.message);
  }
}

/**
 * Convert text to speech using the backend API
 * Returns {audio: Blob, timings: Array}
 */
async function textToSpeech(text, character, speed) {
  const response = await fetch(`${API_BASE}/speak`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: text,
      character: character,
      speed: speed,
    }),
  });

  if (!response.ok) {
    const error = await response
      .json()
      .catch(() => ({ detail: "Unknown error" }));
    throw new Error(error.detail || `Server returned ${response.status}`);
  }

  const data = await response.json();

  // Convert base64 audio back to blob
  const binaryString = atob(data.audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBlob = new Blob([bytes], { type: "audio/wav" });

  return {
    audio: audioBlob,
    timings: data.timings || [],
  };
}

/**
 * Play audio from a blob and track playback time
 * Returns a promise that resolves when audio finishes
 */
async function playAudioBlob(blob, onTimeUpdate = null) {
  return new Promise((resolve, reject) => {
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);

    currentAudio = audio;

    // Call onTimeUpdate with current time and duration
    if (onTimeUpdate) {
      audio.ontimeupdate = () => {
        onTimeUpdate(audio.currentTime, audio.duration);
      };
    }

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      resolve();
    };

    audio.onerror = (error) => {
      URL.revokeObjectURL(audioUrl);
      currentAudio = null;
      reject(new Error("Failed to play audio"));
    };

    audio.play().catch(reject);
  });
}

/**
 * Handle read text request from content script
 */
async function handleReadText(text, sendResponse) {
  try {
    // Stop any currently playing audio
    stopCurrentAudio();

    // Get user settings
    const settings = await getSettings();

    if (!settings.character) {
      sendResponse({
        error:
          "No character selected. Open the extension popup to choose a voice.",
      });
      await notifyContentScript({
        type: "AUDIO_ERROR",
        error: "No voice selected",
      });
      return;
    }

    console.log(`Converting text to ${settings.character}'s voice...`);

    // Get audio and timings from backend
    const result = await textToSpeech(text, settings.character, settings.speed);

    // Send timings to content script
    await notifyContentScript({
      type: "START_READING",
      timings: result.timings,
    });

    // Play the audio
    sendResponse({ success: true });

    try {
      await playAudioBlob(result.audio, async (currentTime, duration) => {
        // Send current playback time to content script
        await notifyContentScript({
          type: "PLAYBACK_UPDATE",
          currentTime: currentTime,
          duration: duration,
        });
      });
      await notifyContentScript({ type: "AUDIO_FINISHED" });
    } catch (playError) {
      console.error("Playback error:", playError);
      await notifyContentScript({
        type: "AUDIO_ERROR",
        error: "Playback failed",
      });
    }
  } catch (error) {
    console.error("TTS Error:", error);
    sendResponse({ error: error.message });
    await notifyContentScript({ type: "AUDIO_ERROR", error: error.message });
  }
}

/**
 * Port connection handler - keeps service worker alive
 */
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === "content-script") {
    console.log("✓ Content script connected via port");
    activePorts.add(port);

    port.onMessage.addListener((message, sender) => {
      if (message.type === "READ_TEXT") {
        handleReadText(message.text, (response) => {
          try {
            port.postMessage(response);
          } catch (error) {
            console.debug("Port closed before response:", error.message);
          }
        });
      } else if (message.type === "STOP_AUDIO") {
        stopCurrentAudio();
        try {
          port.postMessage({ success: true });
        } catch (error) {
          console.debug("Port closed");
        }
      }
    });

    port.onDisconnect.addListener(() => {
      console.log("✓ Content script port disconnected");
      activePorts.delete(port);
    });
  }
});

/**
 * Message listener (for backward compatibility)
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "READ_TEXT") {
    // Handle asynchronously
    handleReadText(message.text, sendResponse);
    return true; // Keep the message channel open for async response
  }

  if (message.type === "STOP_AUDIO") {
    stopCurrentAudio();
    sendResponse({ success: true });
    return false;
  }

  if (message.type === "GET_STATUS") {
    // Return current status
    getSettings().then((settings) => {
      sendResponse({
        isPlaying: currentAudio !== null,
        settings: settings,
      });
    });
    return true;
  }
});

/**
 * Handle extension install/update
 */
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("🎭 Anime Voice Reader installed!");

    // Set default settings
    chrome.storage.local.set({
      character: null,
      speed: 1.0,
    });
  } else if (details.reason === "update") {
    console.log(
      "🎭 Anime Voice Reader updated to version",
      chrome.runtime.getManifest().version,
    );
  }
});

/**
 * Initialize service worker
 */
console.log("🎭 Anime Voice Reader service worker initialized");
console.log("📡 Ready to receive messages from content scripts");
