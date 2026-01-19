/**
 * popup.js
 *
 * Handles the extension popup UI logic.
 * Fetches available voices and saves user preferences.
 */

const API_BASE = "http://localhost:8000";

// DOM Elements
const statusDot = document.getElementById("statusDot");
const statusText = document.getElementById("statusText");
const errorMsg = document.getElementById("errorMsg");
const loading = document.getElementById("loading");
const mainContent = document.getElementById("mainContent");
const voiceSelect = document.getElementById("voiceSelect");
const speedSlider = document.getElementById("speedSlider");
const speedValue = document.getElementById("speedValue");
const testBtn = document.getElementById("testBtn");

/**
 * Show an error message
 */
function showError(message) {
  errorMsg.textContent = message;
  errorMsg.classList.add("show");
}

/**
 * Hide the error message
 */
function hideError() {
  errorMsg.classList.remove("show");
}

/**
 * Update the connection status indicator
 */
function setConnectionStatus(connected, message) {
  if (connected) {
    statusDot.classList.add("connected");
    statusText.textContent = message || "Connected to server";
  } else {
    statusDot.classList.remove("connected");
    statusText.textContent = message || "Server offline";
  }
}

/**
 * Fetch available voices from the backend
 */
async function fetchVoices() {
  loading.classList.add("show");
  hideError();

  try {
    const response = await fetch(`${API_BASE}/voices`, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const data = await response.json();
    setConnectionStatus(true, `Connected • ${data.count} voices available`);

    return data.voices || [];
  } catch (error) {
    console.error("Failed to fetch voices:", error);
    setConnectionStatus(false, "Cannot connect to server");
    showError("Server is not running. Start the backend server first.");
    return [];
  } finally {
    loading.classList.remove("show");
  }
}

/**
 * Populate the voice dropdown
 */
function populateVoices(voices) {
  // Clear existing options (except the placeholder)
  voiceSelect.innerHTML = '<option value="">Select a character...</option>';

  if (voices.length === 0) {
    voiceSelect.innerHTML = '<option value="">No voices available</option>';
    testBtn.disabled = true;
    return;
  }

  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    option.textContent = voice.name.replace(/_/g, " ");
    if (voice.has_index) {
      option.textContent += " ✓"; // Indicate voices with index files
    }
    voiceSelect.appendChild(option);
  });
}

/**
 * Save settings to Chrome storage
 */
async function saveSettings() {
  const settings = {
    character: voiceSelect.value,
    speed: parseFloat(speedSlider.value),
  };

  await chrome.storage.local.set(settings);
  console.log("Settings saved:", settings);
}

/**
 * Load settings from Chrome storage
 */
async function loadSettings() {
  const settings = await chrome.storage.local.get(["character", "speed"]);

  if (settings.character) {
    voiceSelect.value = settings.character;
    testBtn.disabled = !settings.character;
  }

  if (settings.speed) {
    speedSlider.value = settings.speed;
    speedValue.textContent = `${settings.speed.toFixed(1)}x`;
  }
}

/**
 * Test the selected voice
 */
async function testVoice() {
  const character = voiceSelect.value;
  if (!character) {
    showError("Please select a character first");
    return;
  }

  testBtn.disabled = true;
  testBtn.textContent = "⏳ Generating...";
  hideError();

  try {
    const response = await fetch(`${API_BASE}/speak`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: `Hello! This is ${character.replace(/_/g, " ")} speaking. Nice to meet you!`,
        character: character,
        speed: parseFloat(speedSlider.value),
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || "Failed to generate audio");
    }

    const data = await response.json()

    const binary = atob(data.audio)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCode

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      testBtn.disabled = false;
      testBtn.textContent = "🔊 Test Voice";
    };

    audio.onerror = () => {
      URL.revokeObjectURL(audioUrl);
      showError("Failed to play audio");
      testBtn.disabled = false;
      testBtn.textContent = "🔊 Test Voice";
    };

    await audio.play();
  } catch (error) {
    console.error("Test failed:", error);
    showError(error.message);
    testBtn.disabled = false;
    testBtn.textContent = "🔊 Test Voice";
  }
}

// Event Listeners
voiceSelect.addEventListener("change", () => {
  testBtn.disabled = !voiceSelect.value;
  saveSettings();
});

speedSlider.addEventListener("input", () => {
  speedValue.textContent = `${parseFloat(speedSlider.value).toFixed(1)}x`;
});

speedSlider.addEventListener("change", saveSettings);

testBtn.addEventListener("click", testVoice);

// Initialize popup
document.addEventListener("DOMContentLoaded", async () => {
  const voices = await fetchVoices();
  populateVoices(voices);
  await loadSettings();

  // Re-select the saved voice if it exists
  if (voiceSelect.value) {
    testBtn.disabled = false;
  }
});
