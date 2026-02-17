import os
from datasets import load_dataset

# Configuration
LANG_PAIR = "te" # Samanantar uses the target language code for English-X pairs
DATASET_NAME = "ai4bharat/samanantar"
LIMIT = 10000  # Start small to verify everything works

def download_data():
    print(f"Loading {LIMIT} samples from {DATASET_NAME} for {LANG_PAIR}...")
    try:
        # Samanantar on HF is structured by language
        dataset = load_dataset(DATASET_NAME, LANG_PAIR, split='train', streaming=True)
        
        data_list = []
        for i, example in enumerate(dataset):
            if i >= LIMIT:
                break
            data_list.append(example)
            if (i + 1) % 1000 == 0:
                print(f"Downloaded {i + 1} samples...")

        # Save to a local JSONL for inspection and training
        import json
        output_file = "telugu_english_pairs.jsonl"
        with open(output_file, 'w', encoding='utf-8') as f:
            for item in data_list:
                f.write(json.dumps(item, ensure_ascii=False) + '\n')
        
        print(f"Successfully saved {len(data_list)} pairs to {output_file}")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    download_data()
