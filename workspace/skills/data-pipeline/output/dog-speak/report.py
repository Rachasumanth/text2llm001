import json
import os

output_dir = r"c:\Users\4HIN\source\openclaw\workspace\skills\data-pipeline\output\dog-speak"

print("=" * 70)
print("DATASET CREATOR TEST REPORT: Dog-to-Speech Use Case")
print("=" * 70)

# 1. Wikipedia
wiki_files = [f for f in os.listdir(output_dir) if f.startswith("wikipedia")]
for wf in wiki_files:
    path = os.path.join(output_dir, wf)
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    print(f"\n--- WIKIPEDIA ({len(lines)} records, {os.path.getsize(path)//1024} KB) ---")
    for i, line in enumerate(lines[:5]):
        r = json.loads(line)
        print(f"  [{i+1}] {r.get('title','?')} ({r.get('content_length',0)} chars)")
        preview = r.get("text", "")[:150].replace("\n", " ")
        print(f"      Preview: {preview}...")

# 2. PubMed
pm_files = [f for f in os.listdir(output_dir) if f.startswith("pubmed")]
for pf in pm_files:
    path = os.path.join(output_dir, pf)
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    print(f"\n--- PUBMED ({len(lines)} records, {os.path.getsize(path)} bytes) ---")
    for i, line in enumerate(lines):
        r = json.loads(line)
        authors = ", ".join(r.get("authors", [])[:3])
        print(f"  [{i+1}] {r.get('title','?')}")
        print(f"      Authors: {authors}")
        print(f"      Journal: {r.get('source','?')} | Date: {r.get('pub_date','?')}")
        print(f"      URL: {r.get('url','?')}")

# 3. HuggingFace
hf_files = [f for f in os.listdir(output_dir) if f.startswith("huggingface")]
for hf in hf_files:
    path = os.path.join(output_dir, hf)
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    print(f"\n--- HUGGING FACE ({len(lines)} records) ---")
    if len(lines) == 0:
        print("  (No matching datasets found on HuggingFace Hub)")
    for i, line in enumerate(lines[:5]):
        r = json.loads(line)
        print(f"  [{i+1}] {r.get('id','?')} | Downloads: {r.get('downloads',0)}")

# 4. Web Scrape
sc_files = [f for f in os.listdir(output_dir) if f.startswith("scraped")]
for sf in sc_files:
    path = os.path.join(output_dir, sf)
    with open(path, encoding="utf-8") as fh:
        lines = fh.readlines()
    print(f"\n--- WEB SCRAPE ({len(lines)} pages, {os.path.getsize(path)//1024} KB) ---")
    for i, line in enumerate(lines):
        r = json.loads(line)
        print(f"  [{i+1}] {r.get('url','?')} ({r.get('content_length',0)} chars)")
        preview = r.get("text", "")[:200].replace("\n", " ")
        print(f"      Preview: {preview}...")

print("\n" + "=" * 70)
print("SUMMARY")
print("=" * 70)
total = 0
for f in os.listdir(output_dir):
    if f.endswith(".jsonl"):
        path = os.path.join(output_dir, f)
        with open(path, encoding="utf-8") as fh:
            count = sum(1 for _ in fh)
        total += count
        print(f"  {f}: {count} records")
print(f"\n  TOTAL RECORDS COLLECTED: {total}")
total_kb = sum(os.path.getsize(os.path.join(output_dir, f)) for f in os.listdir(output_dir) if f.endswith(".jsonl")) // 1024
print(f"  TOTAL DATA SIZE: {total_kb} KB")
