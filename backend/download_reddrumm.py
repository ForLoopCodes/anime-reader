#!/usr/bin/env python3
"""
download_reddrumm.py

Downloads and organizes RVC voice models from the Hugging Face repository:
https://huggingface.co/reddrumm/RVCModels

Usage:
    python download_reddrumm.py
"""

import os
import shutil
import re
import zipfile
from pathlib import Path
from huggingface_hub import snapshot_download

# Configuration
REPO_ID = "reddrumm/RVCModels"
BACKEND_DIR = Path(__file__).parent.resolve()
RAW_DOWNLOAD_DIR = BACKEND_DIR / "raw_download"
MODELS_DIR = BACKEND_DIR / "models"

def sanitize_name(name: str) -> str:
    """
    Clean up a character name for use as a filename.
    Removes special characters and normalizes spacing.
    """
    # Remove file extension if present
    name = re.sub(r'\.(pth|index)$', '', name, flags=re.IGNORECASE)
    # Remove common suffixes like _v1, _v2, etc.
    name = re.sub(r'_v\d+$', '', name, flags=re.IGNORECASE)
    # Remove RVC-related suffixes
    name = re.sub(r'_(rvc|40k|48k|32k).*$', '', name, flags=re.IGNORECASE)
    # Replace underscores and hyphens with spaces, then title case
    name = re.sub(r'[_-]+', ' ', name).strip()
    # Remove any remaining special characters
    name = re.sub(r'[^\w\s]', '', name)
    # Title case and remove extra spaces
    name = ' '.join(name.split()).title()
    # Convert back to a safe filename (spaces to underscores)
    name = name.replace(' ', '_')
    return name


def extract_character_name(file_path: Path) -> str:
    """
    Extract character name from the file path.
    Tries filename first, then parent folder name.
    """
    # Try to get name from filename
    filename = file_path.stem
    name = sanitize_name(filename)
    
    # If name is too generic, try parent folder
    generic_names = ['model', 'weights', 'voice', 'rvc', 'added', 'index']
    if name.lower() in generic_names or len(name) < 3:
        parent_name = file_path.parent.name
        name = sanitize_name(parent_name)
    
    return name if name else "Unknown"


def find_matching_index(pth_path: Path) -> Path | None:
    """
    Find a matching .index file for a given .pth file.
    Looks in the same directory and subdirectories.
    """
    pth_stem = pth_path.stem.lower()
    search_dir = pth_path.parent
    
    # Search for .index files in the same directory and subdirectories
    for index_file in search_dir.rglob("*.index"):
        index_stem = index_file.stem.lower()
        # Check if the index file matches the pth file
        if pth_stem in index_stem or index_stem in pth_stem:
            return index_file
    
    # Also check parent directory
    if search_dir.parent != RAW_DOWNLOAD_DIR:
        for index_file in search_dir.parent.rglob("*.index"):
            index_stem = index_file.stem.lower()
            if pth_stem in index_stem or index_stem in pth_stem:
                return index_file
    
    return None


def download_repository():
    """
    Download the entire reddrumm/RVCModels repository.
    """
    print(f"📥 Downloading repository: {REPO_ID}")
    print(f"   This may take a while depending on your connection...")
    print()
    
    try:
        snapshot_download(
            repo_id=REPO_ID,
            local_dir=str(RAW_DOWNLOAD_DIR),
            repo_type="model",
            ignore_patterns=["*.md", "*.txt", "*.json", ".gitattributes"],
        )
        print(f"✅ Download complete!")
        return True
    except Exception as e:
        print(f"❌ Download failed: {e}")
        return False


def organize_models():
    """
    Scan the downloaded repository and organize models into the clean structure.
    Handles both .pth files and .zip archives containing .pth files.
    """
    print()
    print("🔍 Scanning for voice models...")
    
    # Verify the raw download directory exists
    if not RAW_DOWNLOAD_DIR.exists():
        print(f"   ⚠️ Raw download directory not found: {RAW_DOWNLOAD_DIR}")
        print(f"   Make sure download_repository() ran successfully.")
        return []
    
    # Create models directory
    MODELS_DIR.mkdir(exist_ok=True)
    
    # Track what we've processed to avoid duplicates
    processed_names = set()
    models_found = []
    
    # First, extract any .zip files
    zip_files = list(RAW_DOWNLOAD_DIR.glob("*.zip"))
    if zip_files:
        print(f"   Found {len(zip_files)} .zip archives to extract...")
        for zip_path in zip_files:
            try:
                print(f"   📦 Extracting: {zip_path.name}")
                with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                    zip_ref.extractall(RAW_DOWNLOAD_DIR)
            except Exception as e:
                print(f"      ⚠️ Error extracting {zip_path.name}: {e}")
    
    # Find all .pth files (including ones just extracted)
    pth_files = list(RAW_DOWNLOAD_DIR.rglob("*.pth"))
    print(f"   Found {len(pth_files)} .pth files")
    
    if len(pth_files) == 0:
        print("   ⚠️ No .pth files found in raw_download folder!")
        print(f"   Checked: {RAW_DOWNLOAD_DIR}")
        # List what's in the directory for debugging
        if RAW_DOWNLOAD_DIR.exists():
            print("   Contents of raw_download:")
            for item in list(RAW_DOWNLOAD_DIR.iterdir())[:10]:
                print(f"     • {item.name}")
        return []
    print()
    
    for pth_path in pth_files:
        try:
            # Extract character name
            char_name = extract_character_name(pth_path)
            
            # Handle duplicates by adding a suffix
            original_name = char_name
            counter = 1
            while char_name in processed_names:
                counter += 1
                char_name = f"{original_name}_{counter}"
            
            processed_names.add(char_name)
            
            # Define target paths
            target_pth = MODELS_DIR / f"{char_name}.pth"
            
            # Copy the .pth file
            print(f"   📦 Processing: {char_name}")
            shutil.copy2(pth_path, target_pth)
            
            # Look for matching .index file
            index_path = find_matching_index(pth_path)
            if index_path:
                target_index = MODELS_DIR / f"{char_name}.index"
                shutil.copy2(index_path, target_index)
                print(f"      ✓ Found matching .index file")
            
            models_found.append(char_name)
            
        except Exception as e:
            print(f"   ⚠️ Error processing {pth_path.name}: {e}")
    
    return models_found


def cleanup_raw_download():
    """
    Remove the raw_download directory to save space.
    """
    print()
    print("🧹 Cleaning up temporary files...")
    
    try:
        shutil.rmtree(RAW_DOWNLOAD_DIR)
        print("   ✓ Removed raw_download folder")
    except Exception as e:
        print(f"   ⚠️ Could not remove raw_download: {e}")


def main():
    print("=" * 60)
    print("  Anime Voice Model Downloader")
    print("  Source: reddrumm/RVCModels (Hugging Face)")
    print("=" * 60)
    print()
    
    # Step 1: Download
    if not download_repository():
        print("Aborting due to download failure.")
        return
    
    # Step 2: Organize
    models = organize_models()
    
    # Step 3: Cleanup
    cleanup_raw_download()
    
    # Summary
    print()
    print("=" * 60)
    print(f"  ✅ Setup Complete!")
    print(f"  📁 Models directory: {MODELS_DIR}")
    print(f"  🎭 Total voices available: {len(models)}")
    print("=" * 60)
    print()
    
    if models:
        print("Available characters:")
        for name in sorted(models):
            print(f"  • {name}")
    print()
    print("You can now start the server with: python server.py")


if __name__ == "__main__":
    main()
