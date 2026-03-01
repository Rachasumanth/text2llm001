"""
Dataset Quality Analyzer – Checks if collected data is training-ready.
Analyzes: structure, text quality, noise, duplicates, diversity, and format compliance.
"""
import json
import os
import re
import hashlib
from collections import Counter

output_dir = r"c:\Users\4HIN\source\openclaw\workspace\skills\data-pipeline\output\dog-speak"

def load_all_records():
    records = []
    sources = {}
    for f in os.listdir(output_dir):
        if not f.endswith(".jsonl"):
            continue
        provider = f.split("_")[0]
        path = os.path.join(output_dir, f)
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
        count = 0
        for line in lines:
            line = line.strip()
            if line:
                try:
                    r = json.loads(line)
                    r["__source_file"] = f
                    r["__provider"] = provider
                    records.append(r)
                    count += 1
                except json.JSONDecodeError:
                    pass
        sources[provider] = count
    return records, sources

def analyze_quality(records):
    print("=" * 70)
    print("DATASET QUALITY ANALYSIS: Dog-to-Speech Training Readiness")
    print("=" * 70)

    # 1. STRUCTURE CHECK
    print("\n1. STRUCTURE & SCHEMA CONSISTENCY")
    print("-" * 40)
    all_keys = Counter()
    has_text = 0
    empty_text = 0
    has_error = 0
    for r in records:
        for k in r.keys():
            if not k.startswith("__"):
                all_keys[k] += 1
        text = r.get("text", "")
        if text:
            has_text += 1
            if len(str(text).strip()) < 10:
                empty_text += 1
        if r.get("error"):
            has_error += 1

    print(f"  Total records: {len(records)}")
    print(f"  Records with 'text' field: {has_text}/{len(records)} ({100*has_text//max(len(records),1)}%)")
    print(f"  Records with errors: {has_error}")
    print(f"  Records with near-empty text (<10 chars): {empty_text}")
    print(f"  Common fields: {', '.join(k for k,v in all_keys.most_common(10))}")

    if has_text < len(records) * 0.5:
        print("  [FAIL] Less than 50% of records have actual text content")
        print("         PubMed returns metadata only (titles, not full articles)")
    else:
        print("  [PASS] Majority of records contain text")

    # 2. TEXT LENGTH DISTRIBUTION
    print("\n2. TEXT LENGTH DISTRIBUTION")
    print("-" * 40)
    lengths = []
    for r in records:
        text = str(r.get("text", ""))
        if text.strip():
            lengths.append(len(text))

    if lengths:
        lengths.sort()
        print(f"  Min: {lengths[0]} chars")
        print(f"  Max: {lengths[-1]} chars")
        print(f"  Median: {lengths[len(lengths)//2]} chars")
        print(f"  Mean: {sum(lengths)//len(lengths)} chars")
        print(f"  Total text: {sum(lengths)//1024} KB")

        short = sum(1 for l in lengths if l < 100)
        medium = sum(1 for l in lengths if 100 <= l < 5000)
        long = sum(1 for l in lengths if l >= 5000)
        print(f"  Short (<100 chars): {short} ({100*short//len(lengths)}%)")
        print(f"  Medium (100-5000): {medium} ({100*medium//len(lengths)}%)")
        print(f"  Long (>5000): {long} ({100*long//len(lengths)}%)")

        if sum(lengths) < 50000:
            print("  [WARN] Total text < 50KB. Too small for meaningful training.")
        elif sum(lengths) < 500000:
            print("  [OK] Total text ~500KB. Enough for fine-tuning, not pretraining.")
        else:
            print("  [GOOD] Total text > 500KB. Reasonable for domain fine-tuning.")

    # 3. DEDUPLICATION CHECK
    print("\n3. DEDUPLICATION ANALYSIS")
    print("-" * 40)
    hashes = set()
    duplicates = 0
    for r in records:
        text = str(r.get("text", "")).strip()
        if not text:
            continue
        h = hashlib.sha256(text.encode("utf-8")).hexdigest()
        if h in hashes:
            duplicates += 1
        else:
            hashes.add(h)

    unique = len(hashes)
    print(f"  Unique text records: {unique}")
    print(f"  Exact duplicates: {duplicates}")
    if duplicates > 0:
        print(f"  [WARN] {duplicates} duplicate records found. Pipeline should dedup.")
    else:
        print(f"  [PASS] No exact duplicates found.")

    # 4. NOISE / BOILERPLATE CHECK
    print("\n4. NOISE & BOILERPLATE ANALYSIS")
    print("-" * 40)
    noisy = 0
    html_noise = 0
    nav_noise = 0
    for r in records:
        text = str(r.get("text", ""))
        if re.search(r'<(div|span|script|style|nav|footer|header)\b', text, re.I):
            html_noise += 1
        if re.search(r'(Cookie Policy|Privacy Policy|Terms of Service|Navigation menu|Jump to content)', text, re.I):
            nav_noise += 1
        # Check for Wikipedia boilerplate
        words = text.lower().split()
        if len(words) > 20:
            unique_ratio = len(set(words)) / len(words)
            if unique_ratio < 0.15:
                noisy += 1

    print(f"  Records with HTML tags: {html_noise}")
    print(f"  Records with navigation/cookie boilerplate: {nav_noise}")
    print(f"  Records with repetitive text (spam-like): {noisy}")

    if html_noise > len(records) * 0.3:
        print("  [FAIL] Heavy HTML contamination. Raw scrape data needs cleaning.")
    elif nav_noise > 0:
        print("  [WARN] Some boilerplate detected. Cleaning pipeline needed.")
    else:
        print("  [PASS] Clean text, minimal noise.")

    # 5. DOMAIN RELEVANCE CHECK
    print("\n5. DOMAIN RELEVANCE (Dog Communication)")
    print("-" * 40)
    dog_keywords = ["dog", "canine", "bark", "howl", "whine", "growl", "vocalization",
                    "puppy", "breed", "tail", "wolf", "wag", "communication", "heartbeat",
                    "animal", "pet", "behavior", "sound", "audio"]
    relevant = 0
    keyword_hits = Counter()
    for r in records:
        text = str(r.get("text", "") or r.get("title", "")).lower()
        hits = [kw for kw in dog_keywords if kw in text]
        if hits:
            relevant += 1
            for h in hits:
                keyword_hits[h] += 1

    print(f"  Relevant records: {relevant}/{len(records)} ({100*relevant//max(len(records),1)}%)")
    print(f"  Top keywords found: {', '.join(f'{k}({v})' for k,v in keyword_hits.most_common(10))}")

    if relevant < len(records) * 0.5:
        print("  [WARN] Less than 50% records are about dogs. Query may need refinement.")
    else:
        print("  [PASS] Good domain relevance.")

    # 6. TRAINING FORMAT READINESS
    print("\n6. TRAINING FORMAT READINESS")
    print("-" * 40)
    has_instruction_format = 0
    has_qa_pairs = 0
    has_plain_text = 0
    for r in records:
        if "instruction" in r and "output" in r:
            has_instruction_format += 1
        elif "question" in r and "answer" in r:
            has_qa_pairs += 1
        elif "text" in r:
            has_plain_text += 1

    print(f"  Instruction format (instruction/output): {has_instruction_format}")
    print(f"  Q&A format (question/answer): {has_qa_pairs}")
    print(f"  Plain text (text field only): {has_plain_text}")

    if has_instruction_format > 0 or has_qa_pairs > 0:
        print("  [PASS] Some records in supervised format.")
    else:
        print("  [INFO] All records are raw text. Need conversion to instruction/QA")
        print("         format before supervised fine-tuning.")
        print("         For continued pretraining, plain text is fine.")

    # 7. VERDICT
    print("\n" + "=" * 70)
    print("OVERALL VERDICT")
    print("=" * 70)

    issues = []
    if has_text < len(records) * 0.5:
        issues.append("Many records lack text content (metadata-only)")
    if html_noise > len(records) * 0.3:
        issues.append("HTML contamination in scraped content")
    if nav_noise > 0:
        issues.append("Boilerplate/navigation text present")
    if duplicates > 0:
        issues.append(f"{duplicates} duplicate records")
    if has_instruction_format == 0 and has_qa_pairs == 0:
        issues.append("No instruction/QA format – needs conversion for SFT")
    if sum(lengths) < 100000 if lengths else True:
        issues.append("Dataset may be too small for robust training")

    if not issues:
        print("  READY TO TRAIN")
    else:
        print(f"  NOT YET READY – {len(issues)} issue(s) found:")
        for i, issue in enumerate(issues, 1):
            print(f"    {i}. {issue}")

        print("\n  RECOMMENDED NEXT STEPS:")
        print("    1. Run the cleaning pipeline: python run.py --input <file>")
        print("    2. Convert to instruction format (e.g., text -> Q&A pairs)")   
        print("    3. Merge all provider outputs into one master JSONL")
        print("    4. Add more data sources (YouTube audio, Kaggle datasets)")
        print("    5. Human review a random sample of 50 records")

if __name__ == "__main__":
    records, sources = load_all_records()
    print(f"Loaded {len(records)} records from {len(sources)} providers: {sources}")
    analyze_quality(records)
