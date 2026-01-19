/**
 * background.js
 *
 * Service worker for the Anime Voice Reader extension.
 * Handles communication between content scripts and the backend API.
 */

const API_BASE = "http://localhost:8000";

// Keep track of current audio
let currentAudio = null;

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
      await chrome.tabs.sendMessage(tab.id, message);
    }
  } catch (error) {
    console.log("Could not notify content script:", error);
  }
}

/**
 * Convert text to speech using the backend API
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

  return await response.blob();
}

/**
 * Play audio from a blob
 */
async function playAudioBlob(blob) {
  return new Promise((resolve, reject) => {
    const audioUrl = URL.createObjectURL(blob);
    const audio = new Audio(audioUrl);

    currentAudio = audio;

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

    // Get audio from backend
    const audioBlob = await textToSpeech(
      text,
      settings.character,
      settings.speed,
    );

    // Play the audio
    sendResponse({ success: true });

    try {
      await playAudioBlob(audioBlob);
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
 * Message listener
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
    sendResponse({
      isPlaying: currentAudio !== null,
      settings: getSettings(),
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

console.log("🎭 Anime Voice Reader background service started");
