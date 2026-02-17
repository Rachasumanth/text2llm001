import json

with open('telugu_english_pairs.jsonl', 'r', encoding='utf-8') as f:
    for i in range(3):
        line = f.readline()
        if not line:
            break
        item = json.loads(line)
        # Check lengths to guess which is which
        # Usually English is shorter or uses ASCII
        src = item.get('src', '')
        tgt = item.get('tgt', '')
        
        print(f"Sample {i}:")
        print(f"  SRC: {src[:50]}")
        # print(f"  TGT: {tgt[:50]}...") # Skip printing Telugu to avoid encoding errors
        has_telugu_tgt = any('\u0c00' <= char <= '\u0c7f' for char in tgt)
        has_telugu_src = any('\u0c00' <= char <= '\u0c7f' for char in src)
        print(f"  TGT has Telugu: {has_telugu_tgt}")
        print(f"  SRC has Telugu: {has_telugu_src}")
