#!/usr/bin/env python3
"""
Simple test script to verify the API works correctly.
"""

import requests
import json
import time

BASE_URL = "http://localhost:8000"

def test_health():
    """Test health check endpoint."""
    print("Testing health check...")
    response = requests.get(f"{BASE_URL}/")
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}\n")
    return response.status_code == 200

def test_voices():
    """Test voices list endpoint."""
    print("Testing voices list...")
    response = requests.get(f"{BASE_URL}/voices")
    print(f"Status: {response.status_code}")
    data = response.json()
    print(f"Available voices: {data.get('count', 0)}")
    if data.get('voices'):
        for voice in data['voices'][:3]:
            print(f"  - {voice['name']}")
    print()
    return response.status_code == 200

def test_speak():
    """Test speak endpoint."""
    print("Testing speak endpoint...")
    
    # Get first available voice
    response = requests.get(f"{BASE_URL}/voices")
    voices = response.json().get('voices', [])
    
    if not voices:
        print("No voices available!")
        return False
    
    character = voices[0]['name']
    print(f"Using character: {character}")
    
    payload = {
        "text": "Hello, this is a test.",
        "character": character,
        "speed": 1.0
    }
    
    print(f"Sending request: {json.dumps(payload)}")
    response = requests.post(f"{BASE_URL}/speak", json=payload)
    print(f"Status: {response.status_code}")
    
    if response.status_code == 200:
        print(f"✅ Audio received! Size: {len(response.content)} bytes")
        
        # Save the audio for testing
        output_file = "/root/anime-reader/backend/test_output.wav"
        with open(output_file, 'wb') as f:
            f.write(response.content)
        print(f"✅ Audio saved to {output_file}")
        return True
    else:
        print(f"❌ Error: {response.text}")
        return False

if __name__ == "__main__":
    print("=" * 60)
    print("Anime Voice Reader API Test")
    print("=" * 60)
    print()
    
    # Wait for server to start
    print("Waiting for server to start...")
    for i in range(30):
        try:
            requests.get(f"{BASE_URL}/")
            break
        except:
            time.sleep(1)
    else:
        print("❌ Server did not start!")
        exit(1)
    
    # Run tests
    results = []
    results.append(("Health check", test_health()))
    results.append(("List voices", test_voices()))
    results.append(("Speak endpoint", test_speak()))
    
    # Summary
    print("=" * 60)
    print("Test Summary")
    print("=" * 60)
    for test_name, passed in results:
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"{test_name}: {status}")
    
    all_passed = all(result for _, result in results)
    print()
    if all_passed:
        print("✅ All tests passed!")
    else:
        print("❌ Some tests failed!")
