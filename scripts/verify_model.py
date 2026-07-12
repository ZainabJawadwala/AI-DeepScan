"""verify_model.py
Downloads MODEL_URL (if set) and runs a single predict on a sample image.
Usage:
    python scripts/verify_model.py path/to/test_image.jpg

Requires the virtualenv with project dependencies installed.
"""
import os
import sys
from predict import MODEL_PATH, load_model, predict

def main():
    if len(sys.argv) < 2:
        print('Usage: python scripts/verify_model.py path/to/test_image.jpg')
        sys.exit(1)
    img = sys.argv[1]
    print('MODEL_PATH:', MODEL_PATH)
    if os.path.exists(MODEL_PATH):
        print('Model exists, size:', os.path.getsize(MODEL_PATH))
    else:
        print('Model not found locally. load_model() may try to download from MODEL_URL.')
    m = load_model()
    print('Loaded model type:', type(m))
    try:
        res = predict(img)
        print('Prediction result:')
        for k,v in res.items():
            if k.endswith('_b64') and v:
                print(k, '(base64, len)', len(v))
            else:
                print(k, v)
    except Exception as e:
        print('Error during prediction:', type(e).__name__, e)

if __name__ == '__main__':
    main()
