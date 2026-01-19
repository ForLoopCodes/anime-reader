# 🎭 Anime Voice Screen Reader

Convert selected text in your browser into anime character voices using RVC (Retrieval-based Voice Conversion) technology. This project consists of a Python FastAPI backend for real-time local voice conversion and a Chrome Extension frontend.

## 📁 Project Structure

```
anime-reader/
├── backend/
│   ├── models/                # Cleaned voice models (.pth and .index files)
│   ├── temp/                  # Temporary audio files (auto-cleaned)
│   ├── server.py              # FastAPI server with /voices and /speak endpoints
│   ├── download_reddrumm.py   # Script to download and organize models
│   └── requirements.txt       # Python dependencies
├── extension/
│   ├── icons/                 # Extension icons (you need to add these)
│   ├── manifest.json          # Chrome Extension manifest (Manifest V3)
│   ├── popup.html             # Extension popup UI
│   ├── popup.js               # Popup logic
│   ├── content.js             # Content script (text selection detection)
│   ├── content.css            # Content script styles
│   └── background.js          # Service worker
└── README.md
```

## 🔧 Requirements

- **Python**: 3.10 or higher
- **GPU**: NVIDIA GPU with CUDA support (recommended for fast inference)
  - CPU-only mode works but is significantly slower
- **Chrome**: For the browser extension
- **Storage**: ~5-10 GB for voice models

## 🚀 Setup Instructions

### 1. Backend Setup

#### Step 1: Create a Virtual Environment (Recommended)

```bash
cd anime-reader/backend

# Create virtual environment
python -m venv venv

# Activate it
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate
```

#### Step 2: Install Dependencies

```bash
pip install -r requirements.txt
```

> **Note for GPU users**: If you have an NVIDIA GPU, install PyTorch with CUDA support:
>
> ```bash
> pip install torch torchaudio --index-url https://download.pytorch.org/whl/cu118
> ```

> **Note for Mac M1/M2 users**: PyTorch should auto-detect MPS. No special commands needed.

#### Step 3: Download Voice Models

This will download and organize voice models from `reddrumm/RVCModels`:

```bash
python download_reddrumm.py
```

This process:

1. Downloads the entire Hugging Face repository (~several GB)
2. Extracts and organizes `.pth` (voice weights) and `.index` (feature index) files
3. Cleans up the raw download to save space

**⏱️ This may take 10-30 minutes depending on your internet speed.**

#### Step 4: Start the Server

```bash
python server.py
```

The server will start at `http://localhost:8000`.

You can verify it's working by visiting:

- `http://localhost:8000` - Health check
- `http://localhost:8000/voices` - List available voices
- `http://localhost:8000/docs` - Interactive API documentation

### 2. Chrome Extension Setup

#### Step 1: Add Extension Icons

Create an `icons` folder inside `extension/` and add icon files:

- `icon16.png` (16x16 pixels)
- `icon48.png` (48x48 pixels)
- `icon128.png` (128x128 pixels)

You can use any anime-themed icon or create simple placeholder icons.

#### Step 2: Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the `anime-reader/extension` folder
5. The extension should appear with the 🎭 icon

## 🎮 Usage

1. **Start the backend server** (keep it running):

   ```bash
   cd backend
   python server.py
   ```

2. **Open the extension popup** by clicking the extension icon in Chrome

3. **Select a character voice** from the dropdown

4. **Select text on any webpage** - a floating "🔊 Read" button will appear

5. **Click the button** to hear the text in your selected anime character's voice!

### Keyboard Shortcut

- **Ctrl+Shift+R**: Read the currently selected text (when text is selected)
- **Escape**: Hide the read button

## 🔌 API Endpoints

| Endpoint                      | Method | Description                         |
| ----------------------------- | ------ | ----------------------------------- |
| `/`                           | GET    | Health check                        |
| `/voices`                     | GET    | List all available character voices |
| `/speak`                      | POST   | Convert text to speech              |
| `/voices/{character}/preview` | GET    | Preview a character's voice         |
| `/cache`                      | DELETE | Clear the model cache               |

### POST /speak Request Body

```json
{
  "text": "Hello, how are you?",
  "character": "Frieren",
  "speed": 1.0
}
```

## ⚙️ Configuration

### Backend Configuration

Edit `server.py` to modify:

- `DEFAULT_TTS_VOICE`: The base TTS voice (default: `en-US-AriaNeural`)
- Port number (default: `8000`)

### Extension Configuration

The popup allows you to:

- Select the character voice
- Adjust speech speed (0.5x - 2.0x)

## 🔧 Troubleshooting

### "Server offline" in extension popup

- Make sure the backend server is running (`python server.py`)
- Check if port 8000 is available

### No voices showing up

- Run `python download_reddrumm.py` first
- Check the `backend/models/` folder for `.pth` files

### Voice conversion is slow

- Ensure you have a CUDA-compatible GPU
- Check that PyTorch is using CUDA:
  ```python
  import torch
  print(torch.cuda.is_available())
  ```

### Audio doesn't play

- Check Chrome's audio permissions for the website
- Try the "Test Voice" button in the extension popup first

### RVC Import Error

If you get import errors for RVC, try:

```bash
pip uninstall rvc-python
pip install rvc-python --no-cache-dir
```

## 📝 License

This project is for educational and personal use. Voice models from `reddrumm/RVCModels` may have their own licensing terms.

## 🙏 Credits

- Voice models: [reddrumm/RVCModels](https://huggingface.co/reddrumm/RVCModels)
- TTS Engine: [edge-tts](https://github.com/rany2/edge-tts)
- Voice Conversion: [RVC](https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI)
