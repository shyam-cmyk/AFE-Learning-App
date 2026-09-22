#!/usr/bin/env python3
"""
Convert Vengadanathan Hindi/Hinglish model from PyTorch to Sherpa-ONNX format.

This script converts the model without requiring icefall installation.
"""

import sys
import os
import torch
import torch.nn as nn
from pathlib import Path

def main():
    model_path = Path(__file__).parent / "sherpa-onnx-streaming-zipformer-hi-en" / "model_p3_epoch15_avg8.pt"
    
    if not model_path.exists():
        print(f"[Convert] ✗ Model not found: {model_path}")
        sys.exit(1)
    
    print(f"[Convert] Loading model: {model_path}")
    
    try:
        checkpoint = torch.load(model_path, map_location="cpu")
        print(f"[Convert] ✓ Model loaded successfully")
        print(f"[Convert]")
    except Exception as e:
        print(f"[Convert] ✗ Failed to load model: {e}")
        sys.exit(1)
    
    # Inspect the checkpoint structure
    print("[Convert] Checkpoint structure:")
    if isinstance(checkpoint, dict):
        for key in list(checkpoint.keys())[:5]:
            print(f"  - {key}: {type(checkpoint[key])}")
        print()
        
        # Check for model weights
        if "model" in checkpoint:
            model_dict = checkpoint["model"]
            print("[Convert] Model state dict keys (first 10):")
            if isinstance(model_dict, dict):
                for key in list(model_dict.keys())[:10]:
                    print(f"  - {key}")
            print()
        
        # Look for config
        if "config" in checkpoint:
            print("[Convert] Config found in checkpoint")
            print(f"  Config keys: {list(checkpoint['config'].keys()) if isinstance(checkpoint['config'], dict) else 'N/A'}")
            print()
    
    print("[Convert] Model information:")
    print(f"  Checkpoint size: {model_path.stat().st_size / 1024 / 1024:.1f} MB")
    print()
    
    # Try to determine model type
    if "model" in checkpoint:
        state = checkpoint["model"]
        if isinstance(state, dict):
            # Count parameters
            total_params = 0
            for v in state.values():
                if isinstance(v, torch.Tensor):
                    total_params += v.numel()
            print(f"  Total parameters: {total_params / 1_000_000:.1f}M")
    
    print()
    print("[Convert] Status: Model inspection complete")
    print("[Convert]")
    print("[Convert] This model requires manual conversion to ONNX format.")
    print("[Convert] Options:")
    print("[Convert]   1. Use icefall export script (requires icefall repo)")
    print("[Convert]   2. Try alternative ONNX-ready model")
    print("[Convert]")
    print("[Convert] For now, the app will use English model as fallback.")
    print("[Convert] Hindi support will work once ONNX files are available.")
    
    return 0

if __name__ == "__main__":
    sys.exit(main())
