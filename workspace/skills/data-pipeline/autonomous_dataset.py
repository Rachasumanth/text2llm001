#!/usr/bin/env python3
"""
Autonomous Dataset Creator — "Describe → Collect → Refine → Deliver"

The user types ONE sentence describing the dataset they need. This orchestrator:
  1. Uses an LLM to classify, expand, and plan the collection strategy
  2. Dispatches parallel agents to 9+ sources (Wikipedia, Reddit, YouTube, 
     Kaggle, HuggingFace, arXiv, News, Twitter, GitHub)
  3. Refines the data (dedup, quality scoring, PII removal, schema normalization)
  4. Combines, splits, and delivers a production-ready JSONL dataset

Usage:
  python autonomous_dataset.py \
    --prompt "I need a sentiment analysis dataset on product reviews" \
    --api-key "sk-..." --api-provider "openai" \
    --target-rows 10000 --output-format jsonl

  # Dry-run mode (just emit the plan, no collection):
  python autonomous_dataset.py --prompt "..." --dry-run
"""

import argparse
import json
import os
import sys
import time
import hashlib
import re
import random
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import quote_plus
import ssl

# Fix SSL certificate verification on Windows
try:
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE
except Exception:
    _ssl_ctx = None

# ---------------------------------------------------------------------------
# Logging & Helpers
# ---------------------------------------------------------------------------

def log(msg):
    print(f"[autonomous] {msg}", flush=True)

def progress(phase, detail=""):
    """Emit a machine-readable progress line for the worker to parse."""
    payload = {"phase": phase, "detail": detail, "ts": time.strftime("%H:%M:%S")}
    print(f"@@PROGRESS@@{json.dumps(payload)}", flush=True)

def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]

def http_get_json(url, headers=None, timeout=30):
    import urllib.request
    default_headers = {"User-Agent": "Text2LLM-AutonomousDatasetCreator/2.0"}
    if headers:
        default_headers.update(headers)
    req = urllib.request.Request(url, headers=default_headers)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx) as resp:
        return json.loads(resp.read().decode("utf-8"))

def http_get_text(url, headers=None, timeout=30):
    import urllib.request
    default_headers = {"User-Agent": "Text2LLM-AutonomousDatasetCreator/2.0"}
    if headers:
        default_headers.update(headers)
    req = urllib.request.Request(url, headers=default_headers)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx) as resp:
        return resp.read().decode("utf-8")

def write_jsonl(records, path):
    with open(path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    log(f"Wrote {len(records)} records → {path}")


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 1: AI Query Planner
# ═══════════════════════════════════════════════════════════════════════════

PLAN_SYSTEM_PROMPT = """You are an expert AI dataset architect. Given a user's dataset request, 
produce a JSON collection plan. Be thorough and creative with search queries.

Return ONLY valid JSON with this exact schema:
{
  "task_type": "classification|generation|qa|summarization|translation|ner|other",
  "domain": "short domain description",
  "keywords": ["keyword1", "keyword2", ...],
  "target_sources": ["wikipedia","reddit","youtube","kaggle","huggingface","arxiv","news","github"],
  "search_queries": {
    "wikipedia": "search query for wikipedia",
    "reddit": "subreddit or search query",
    "youtube": "search query for transcripts",
    "kaggle": "dataset search query",
    "huggingface": "dataset search query",
    "arxiv": "academic paper search query",
    "news": "news search query",
    "github": "repository/code search query"
  },
  "expected_schema": {"column_name": "type_description"},
  "quality_criteria": "description of what makes a high-quality record for this dataset"
}"""

def call_llm_api(prompt, system_prompt, api_key, api_provider="openai", max_tokens=2000):
    """Call an LLM API to get a response. Supports OpenAI, Anthropic, and Google."""
    import urllib.request

    if api_provider in ("openai", "openrouter"):
        base_url = "https://api.openai.com/v1" if api_provider == "openai" else "https://openrouter.ai/api/v1"
        model = "gpt-4o-mini" if api_provider == "openai" else "openai/gpt-4o-mini"
        
        payload = json.dumps({
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": max_tokens,
            "temperature": 0.3
        }).encode("utf-8")
        
        req = urllib.request.Request(f"{base_url}/chat/completions", data=payload, headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]

    elif api_provider == "anthropic":
        payload = json.dumps({
            "model": "claude-3-haiku-20240307",
            "max_tokens": max_tokens,
            "system": system_prompt,
            "messages": [{"role": "user", "content": prompt}]
        }).encode("utf-8")
        
        req = urllib.request.Request("https://api.anthropic.com/v1/messages", data=payload, headers={
            "Content-Type": "application/json",
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01"
        })
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["content"][0]["text"]

    elif api_provider in ("google", "gemini"):
        model = "gemini-2.0-flash"
        payload = json.dumps({
            "contents": [{"parts": [{"text": f"{system_prompt}\n\n{prompt}"}]}],
            "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.3}
        }).encode("utf-8")
        
        req = urllib.request.Request(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
            data=payload,
            headers={"Content-Type": "application/json"}
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["candidates"][0]["content"]["parts"][0]["text"]

    else:
        raise ValueError(f"Unsupported API provider: {api_provider}")


def create_collection_plan(user_prompt, api_key, api_provider, target_rows):
    """Phase 1: Use an LLM to expand the user's request into a structured plan."""
    log("Phase 1: AI Query Planning...")
    progress("planning", "Analyzing your request with AI...")

    planning_prompt = f"""The user needs a dataset for the following purpose:
"{user_prompt}"

Target scale: approximately {target_rows} rows.
Generate a comprehensive collection plan to gather training data from multiple internet sources."""

    try:
        raw = call_llm_api(planning_prompt, PLAN_SYSTEM_PROMPT, api_key, api_provider)
        
        # Extract JSON from the response (handle markdown code blocks)
        json_match = re.search(r'```(?:json)?\s*\n?(.*?)\n?```', raw, re.DOTALL)
        if json_match:
            raw = json_match.group(1)
        
        # Try to parse
        plan = json.loads(raw.strip())
        log(f"Plan created: {len(plan.get('target_sources', []))} sources, "
            f"{len(plan.get('keywords', []))} keywords")
        return plan
    
    except json.JSONDecodeError:
        log(f"WARNING: LLM returned invalid JSON. Using fallback plan.")
        return create_fallback_plan(user_prompt)
    except Exception as e:
        log(f"WARNING: LLM API error: {e}. Using fallback plan.")
        return create_fallback_plan(user_prompt)


def create_fallback_plan(user_prompt):
    """Generate a basic plan without LLM (keyword extraction heuristic)."""
    words = user_prompt.lower().split()
    # Remove common stop words
    stops = {"i", "need", "a", "the", "for", "to", "an", "of", "on", "in", "my", "that", "with", "and", "is", "this"}
    keywords = [w.strip(".,!?\"'") for w in words if w not in stops and len(w) > 2][:8]
    query = " ".join(keywords[:5])
    
    return {
        "task_type": "other",
        "domain": query,
        "keywords": keywords,
        "target_sources": ["wikipedia", "reddit", "kaggle", "huggingface", "arxiv", "news", "github"],
        "search_queries": {
            "wikipedia": query,
            "reddit": query,
            "youtube": query,
            "kaggle": query,
            "huggingface": query,
            "arxiv": query,
            "news": query,
            "github": query
        },
        "expected_schema": {"text": "string", "source": "string", "label": "string"},
        "quality_criteria": f"Relevant to: {user_prompt}"
    }


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 2: Multi-Source Collection Adapters
# ═══════════════════════════════════════════════════════════════════════════

def collect_wikipedia(query, max_records=200):
    """Fetch Wikipedia articles and extract text content."""
    records = []
    try:
        url = (f"https://en.wikipedia.org/w/api.php?action=query&list=search"
               f"&srsearch={quote_plus(query)}&srlimit=50&format=json")
        data = http_get_json(url)
        results = data.get("query", {}).get("search", [])

        for item in results[:max_records]:
            page_id = item.get("pageid", "")
            title = item.get("title", "")
            
            # Fetch full extract
            extract_url = (f"https://en.wikipedia.org/w/api.php?action=query&pageids={page_id}"
                          f"&prop=extracts&explaintext=true&exlimit=1&format=json")
            try:
                extract_data = http_get_json(extract_url)
                page = extract_data.get("query", {}).get("pages", {}).get(str(page_id), {})
                text = page.get("extract", "")
                
                if len(text) > 100:
                    # Split long articles into chunks of ~500 words
                    words = text.split()
                    for i in range(0, len(words), 400):
                        chunk = " ".join(words[i:i+400])
                        if len(chunk) > 50:
                            records.append({
                                "text": chunk,
                                "source": "wikipedia",
                                "url": f"https://en.wikipedia.org/wiki/{title.replace(' ', '_')}",
                                "title": title,
                                "metadata": {"page_id": page_id}
                            })
            except Exception:
                continue
    except Exception as e:
        log(f"Wikipedia adapter error: {e}")
    
    return records


def collect_reddit(query, max_records=500):
    """Fetch Reddit posts and comments via public JSON API."""
    records = []
    try:
        # Search posts
        url = f"https://www.reddit.com/search.json?q={quote_plus(query)}&limit=100&sort=relevance&t=all"
        data = http_get_json(url, headers={
            "User-Agent": "Text2LLM-DatasetCreator/2.0 (research)"
        })
        
        posts = data.get("data", {}).get("children", [])
        for post in posts:
            pd = post.get("data", {})
            title = pd.get("title", "")
            selftext = pd.get("selftext", "")
            subreddit = pd.get("subreddit", "")
            
            text = f"{title}\n{selftext}".strip()
            if len(text) > 30:
                records.append({
                    "text": text,
                    "source": "reddit",
                    "url": f"https://reddit.com{pd.get('permalink', '')}",
                    "title": title,
                    "metadata": {
                        "subreddit": subreddit,
                        "score": pd.get("score", 0),
                        "num_comments": pd.get("num_comments", 0)
                    }
                })
        
        # Also fetch top comments from top posts
        for post in posts[:10]:
            try:
                permalink = post.get("data", {}).get("permalink", "")
                if not permalink:
                    continue
                comment_url = f"https://www.reddit.com{permalink}.json?limit=25&sort=top"
                cdata = http_get_json(comment_url, headers={
                    "User-Agent": "Text2LLM-DatasetCreator/2.0 (research)"
                })
                if len(cdata) > 1:
                    comments = cdata[1].get("data", {}).get("children", [])
                    for c in comments:
                        body = c.get("data", {}).get("body", "")
                        if len(body) > 30 and body != "[deleted]" and body != "[removed]":
                            records.append({
                                "text": body,
                                "source": "reddit",
                                "url": f"https://reddit.com{permalink}",
                                "title": f"Comment on: {post.get('data', {}).get('title', '')}",
                                "metadata": {
                                    "type": "comment",
                                    "score": c.get("data", {}).get("score", 0)
                                }
                            })
            except Exception:
                continue
                
    except Exception as e:
        log(f"Reddit adapter error: {e}")
    
    return records[:max_records]


def collect_youtube_transcripts(query, max_records=200):
    """Fetch YouTube video transcripts via youtube-transcript-api or fallback."""
    records = []
    try:
        # Search YouTube via invidious (no API key needed)
        search_url = f"https://vid.puffyan.us/api/v1/search?q={quote_plus(query)}&type=video&sort_by=relevance"
        try:
            videos = http_get_json(search_url)
        except Exception:
            # Fallback: try another invidious instance
            try:
                search_url = f"https://invidious.fdn.fr/api/v1/search?q={quote_plus(query)}&type=video&sort_by=relevance"
                videos = http_get_json(search_url)
            except Exception:
                log("YouTube search unavailable (no Invidious instance reachable)")
                return records

        video_ids = [v.get("videoId") for v in videos[:30] if v.get("videoId")]
        
        # Try youtube-transcript-api
        try:
            from youtube_transcript_api import YouTubeTranscriptApi
            for vid in video_ids:
                try:
                    transcript = YouTubeTranscriptApi.get_transcript(vid, languages=['en'])
                    full_text = " ".join([t["text"] for t in transcript])
                    if len(full_text) > 100:
                        # Chunk long transcripts
                        words = full_text.split()
                        for i in range(0, len(words), 400):
                            chunk = " ".join(words[i:i+400])
                            if len(chunk) > 50:
                                records.append({
                                    "text": chunk,
                                    "source": "youtube",
                                    "url": f"https://www.youtube.com/watch?v={vid}",
                                    "title": next((v.get("title", "") for v in videos if v.get("videoId") == vid), ""),
                                    "metadata": {"type": "transcript", "video_id": vid}
                                })
                except Exception:
                    continue
        except ImportError:
            log("youtube-transcript-api not installed. Storing video metadata only.")
            for v in videos[:30]:
                records.append({
                    "text": f"{v.get('title', '')}. {v.get('description', '')}".strip(),
                    "source": "youtube",
                    "url": f"https://www.youtube.com/watch?v={v.get('videoId', '')}",
                    "title": v.get("title", ""),
                    "metadata": {"type": "metadata_only", "video_id": v.get("videoId", "")}
                })
                
    except Exception as e:
        log(f"YouTube adapter error: {e}")
    
    return records[:max_records]


def collect_kaggle(query, max_records=100):
    """Search Kaggle for relevant datasets."""
    records = []
    try:
        url = f"https://www.kaggle.com/api/v1/datasets/list?search={quote_plus(query)}&sortBy=relevance"
        try:
            datasets = http_get_json(url)
        except Exception:
            datasets = []
        
        for ds in (datasets if isinstance(datasets, list) else []):
            ref = ds.get("ref", "")
            records.append({
                "text": f"Dataset: {ds.get('title', '')}. {ds.get('subtitle', '')}",
                "source": "kaggle",
                "url": f"https://www.kaggle.com/datasets/{ref}",
                "title": ds.get("title", ""),
                "metadata": {
                    "ref": ref,
                    "type": "dataset_catalog",
                    "size_bytes": ds.get("totalBytes", 0),
                    "download_count": ds.get("downloadCount", 0)
                }
            })
    except Exception as e:
        log(f"Kaggle adapter error: {e}")
    
    return records[:max_records]


def collect_huggingface(query, max_records=100):
    """Search HuggingFace Hub for datasets and sample their contents."""
    records = []
    try:
        url = f"https://huggingface.co/api/datasets?search={quote_plus(query)}&limit=50&sort=downloads"
        datasets = http_get_json(url)
        
        for ds in (datasets if isinstance(datasets, list) else []):
            ds_id = ds.get("id", "")
            
            # Try to fetch a preview of the dataset content
            try:
                preview_url = f"https://datasets-server.huggingface.co/first-rows?dataset={quote_plus(ds_id)}&config=default&split=train"
                preview = http_get_json(preview_url, timeout=10)
                rows = preview.get("rows", [])
                for row in rows[:20]:
                    row_data = row.get("row", {})
                    # Find the main text column
                    text = ""
                    for key in ["text", "content", "sentence", "question", "input", "instruction"]:
                        if key in row_data and isinstance(row_data[key], str):
                            text = row_data[key]
                            break
                    if not text:
                        # Take the longest string value
                        str_vals = [(k, v) for k, v in row_data.items() if isinstance(v, str) and len(v) > 20]
                        if str_vals:
                            text = max(str_vals, key=lambda x: len(x[1]))[1]
                    
                    if text and len(text) > 20:
                        records.append({
                            "text": text,
                            "source": "huggingface",
                            "url": f"https://huggingface.co/datasets/{ds_id}",
                            "title": ds_id,
                            "metadata": {"type": "dataset_row", "row_data": {k: str(v)[:200] for k, v in row_data.items()}}
                        })
            except Exception:
                # Just add catalog entry
                records.append({
                    "text": f"Dataset: {ds_id}. Tags: {', '.join(ds.get('tags', [])[:5])}",
                    "source": "huggingface",
                    "url": f"https://huggingface.co/datasets/{ds_id}",
                    "title": ds_id,
                    "metadata": {"type": "catalog", "downloads": ds.get("downloads", 0)}
                })
    except Exception as e:
        log(f"HuggingFace adapter error: {e}")
    
    return records[:max_records]


def collect_arxiv(query, max_records=100):
    """Fetch academic paper abstracts from arXiv."""
    records = []
    try:
        import xml.etree.ElementTree as ET
        url = (f"http://export.arxiv.org/api/query?search_query=all:{quote_plus(query)}"
               f"&max_results=50&sortBy=relevance&sortOrder=descending")
        xml_text = http_get_text(url)
        root = ET.fromstring(xml_text)
        
        ns = {"atom": "http://www.w3.org/2005/Atom"}
        for entry in root.findall("atom:entry", ns):
            title = entry.findtext("atom:title", "", ns).strip()
            summary = entry.findtext("atom:summary", "", ns).strip()
            link_el = entry.find("atom:id", ns)
            link = link_el.text.strip() if link_el is not None else ""
            
            if summary and len(summary) > 50:
                records.append({
                    "text": f"{title}\n\n{summary}",
                    "source": "arxiv",
                    "url": link,
                    "title": title,
                    "metadata": {"type": "paper_abstract"}
                })
    except Exception as e:
        log(f"arXiv adapter error: {e}")
    
    return records[:max_records]


def collect_news(query, max_records=200):
    """Fetch news articles using DuckDuckGo instant answer API and web scraping."""
    records = []
    try:
        # DuckDuckGo instant answers
        url = f"https://api.duckduckgo.com/?q={quote_plus(query)}&format=json&no_redirect=1"
        data = http_get_json(url)
        
        abstract = data.get("Abstract", "")
        if abstract and len(abstract) > 50:
            records.append({
                "text": abstract,
                "source": "news",
                "url": data.get("AbstractURL", ""),
                "title": data.get("Heading", query),
                "metadata": {"type": "instant_answer"}
            })
        
        # Related topics
        for topic in data.get("RelatedTopics", []):
            if isinstance(topic, dict) and topic.get("Text"):
                records.append({
                    "text": topic["Text"],
                    "source": "news",
                    "url": topic.get("FirstURL", ""),
                    "title": topic.get("Text", "")[:80],
                    "metadata": {"type": "related_topic"}
                })
            elif isinstance(topic, dict) and topic.get("Topics"):
                for sub in topic["Topics"]:
                    if sub.get("Text"):
                        records.append({
                            "text": sub["Text"],
                            "source": "news",
                            "url": sub.get("FirstURL", ""),
                            "title": sub.get("Text", "")[:80],
                            "metadata": {"type": "related_subtopic"}
                        })
    except Exception as e:
        log(f"News adapter error: {e}")
    
    return records[:max_records]


def collect_github(query, max_records=100):
    """Search GitHub for relevant repositories and their README content."""
    records = []
    try:
        url = f"https://api.github.com/search/repositories?q={quote_plus(query)}&sort=stars&per_page=30"
        data = http_get_json(url, headers={"Accept": "application/vnd.github.v3+json"})
        
        for repo in data.get("items", []):
            full_name = repo.get("full_name", "")
            description = repo.get("description", "") or ""
            
            # Try to fetch README
            readme_text = ""
            try:
                readme_url = f"https://api.github.com/repos/{full_name}/readme"
                readme_data = http_get_json(readme_url, headers={"Accept": "application/vnd.github.v3+json"})
                if readme_data.get("encoding") == "base64":
                    import base64
                    readme_text = base64.b64decode(readme_data.get("content", "")).decode("utf-8", errors="replace")
                    # Strip markdown images and links, keep text
                    readme_text = re.sub(r'!\[.*?\]\(.*?\)', '', readme_text)
                    readme_text = re.sub(r'\[([^\]]+)\]\(.*?\)', r'\1', readme_text)
                    readme_text = re.sub(r'#{1,6}\s+', '', readme_text)
                    readme_text = readme_text[:5000]
            except Exception:
                pass
            
            text = f"{repo.get('name', '')}: {description}"
            if readme_text:
                text += f"\n\n{readme_text}"
            
            if len(text) > 50:
                # Chunk if large
                words = text.split()
                for i in range(0, len(words), 400):
                    chunk = " ".join(words[i:i+400])
                    if len(chunk) > 50:
                        records.append({
                            "text": chunk,
                            "source": "github",
                            "url": repo.get("html_url", ""),
                            "title": full_name,
                            "metadata": {
                                "stars": repo.get("stargazers_count", 0),
                                "language": repo.get("language", ""),
                                "type": "repository"
                            }
                        })
    except Exception as e:
        log(f"GitHub adapter error: {e}")
    
    return records[:max_records]


# Adapter registry
SOURCE_ADAPTERS = {
    "wikipedia":   collect_wikipedia,
    "reddit":      collect_reddit,
    "youtube":     collect_youtube_transcripts,
    "kaggle":      collect_kaggle,
    "huggingface": collect_huggingface,
    "arxiv":       collect_arxiv,
    "news":        collect_news,
    "github":      collect_github,
}


def run_collection(plan, target_rows):
    """Phase 2: Dispatch parallel agents to all target sources."""
    log("Phase 2: Multi-Source Collection...")
    progress("collecting", "Dispatching agents to internet sources...")
    
    sources = plan.get("target_sources", list(SOURCE_ADAPTERS.keys()))
    queries = plan.get("search_queries", {})
    fallback_query = " ".join(plan.get("keywords", ["data"]))
    
    # Calculate per-source target (overshoot by 3x to account for dedup/filtering)
    per_source = max(50, (target_rows * 3) // max(len(sources), 1))
    
    all_records = []
    source_stats = {}
    
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {}
        for source in sources:
            if source not in SOURCE_ADAPTERS:
                continue
            query = queries.get(source, fallback_query)
            adapter = SOURCE_ADAPTERS[source]
            futures[executor.submit(adapter, query, per_source)] = source
        
        for future in as_completed(futures):
            source = futures[future]
            try:
                records = future.result()
                all_records.extend(records)
                source_stats[source] = len(records)
                progress("collecting", f"✓ {source}: {len(records)} records")
                log(f"  ✓ {source}: {len(records)} records collected")
            except Exception as e:
                source_stats[source] = 0
                progress("collecting", f"✗ {source}: failed ({e})")
                log(f"  ✗ {source} failed: {e}")
    
    log(f"Total raw records collected: {len(all_records)} from {len(source_stats)} sources")
    return all_records, source_stats


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 3: Refine Pipeline
# ═══════════════════════════════════════════════════════════════════════════

# PII patterns
PII_PATTERNS = [
    (re.compile(r'\b[\w.+-]+@[\w-]+\.[\w.-]+\b'), '[EMAIL]'),
    (re.compile(r'\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b'), '[PHONE]'),
    (re.compile(r'\b\d{3}-\d{2}-\d{4}\b'), '[SSN]'),
    (re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'), '[CARD]'),
    (re.compile(r'\b\d{1,5}\s+\w+\s+(?:St|Ave|Blvd|Dr|Rd|Ln|Ct|Way|Pl)\b', re.I), '[ADDRESS]'),
]

def scrub_pii(text):
    """Remove personally identifiable information."""
    for pattern, replacement in PII_PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def deduplicate_records(records, threshold=0.85):
    """
    Remove duplicate and near-duplicate records.
    Uses exact hash dedup + simple Jaccard similarity for near-dedup.
    """
    seen_hashes = set()
    unique = []
    
    for record in records:
        text = record.get("text", "")
        if not text:
            continue
        
        # Exact dedup
        text_hash = sha256(text)
        if text_hash in seen_hashes:
            continue
        seen_hashes.add(text_hash)
        
        # Near-dedup: check Jaccard similarity with a sample of existing records
        text_words = set(text.lower().split())
        is_dup = False
        
        # Only check against last 100 records for performance
        check_against = unique[-100:] if len(unique) > 100 else unique
        for existing in check_against:
            existing_words = set(existing.get("text", "").lower().split())
            if not existing_words or not text_words:
                continue
            intersection = len(text_words & existing_words)
            union = len(text_words | existing_words)
            if union > 0 and (intersection / union) > threshold:
                is_dup = True
                break
        
        if not is_dup:
            unique.append(record)
    
    return unique


def score_quality(record, quality_criteria=""):
    """Score a record's quality 0.0–1.0 using heuristics."""
    text = record.get("text", "")
    score = 1.0
    
    # Length checks
    if len(text) < 30: score -= 0.5
    elif len(text) < 80: score -= 0.2
    
    # Word diversity
    words = text.split()
    if len(words) > 5:
        unique_ratio = len(set(w.lower() for w in words)) / len(words)
        if unique_ratio < 0.3: score -= 0.4
        elif unique_ratio < 0.5: score -= 0.1
    
    # Penalize mostly-URL or code-heavy content
    url_count = len(re.findall(r'https?://', text))
    if url_count > 3: score -= 0.2
    
    # Bonus for natural prose
    if text[0:1].isupper() and text[-1:] in '.!?': score += 0.05
    if len(words) > 10: score += 0.05
    
    # Penalize very short records with no substance
    if len(words) < 5: score -= 0.3
    
    return max(0.0, min(1.0, round(score, 2)))


def refine_records(records, target_rows, min_quality=0.4):
    """Phase 3: Deduplicate, filter, scrub PII, normalize schema."""
    log("Phase 3: Refining collected data...")
    progress("refining", "Deduplicating records...")
    
    initial_count = len(records)
    
    # Step 1: Remove empty/too-short records
    records = [r for r in records if r.get("text") and len(r["text"].strip()) > 20]
    log(f"  After length filter: {len(records)} (removed {initial_count - len(records)} short)")
    
    # Step 2: PII scrubbing
    progress("refining", "Removing personal information...")
    for r in records:
        r["text"] = scrub_pii(r["text"])
    
    # Step 3: Deduplication
    progress("refining", "Removing duplicates...")
    before_dedup = len(records)
    records = deduplicate_records(records)
    log(f"  After dedup: {len(records)} (removed {before_dedup - len(records)} duplicates)")
    
    # Step 4: Quality scoring
    progress("refining", "Scoring quality...")
    for r in records:
        r["quality_score"] = score_quality(r)
    
    # Step 5: Filter by quality
    records = [r for r in records if r.get("quality_score", 0) >= min_quality]
    log(f"  After quality filter (>={min_quality}): {len(records)}")
    
    # Step 6: Sort by quality and take top target_rows
    records.sort(key=lambda r: r.get("quality_score", 0), reverse=True)
    if len(records) > target_rows:
        records = records[:target_rows]
        log(f"  Trimmed to target: {len(records)}")
    
    # Shuffle to mix sources
    random.shuffle(records)
    
    return records


# ═══════════════════════════════════════════════════════════════════════════
# PHASE 4: Assembly & Delivery
# ═══════════════════════════════════════════════════════════════════════════

def split_dataset(records, train=0.8, val=0.1, test=0.1):
    """Stratified split by source."""
    by_source = {}
    for r in records:
        src = r.get("source", "unknown")
        by_source.setdefault(src, []).append(r)
    
    train_set, val_set, test_set = [], [], []
    for source, recs in by_source.items():
        random.shuffle(recs)
        n = len(recs)
        t1 = int(n * train)
        t2 = int(n * (train + val))
        train_set.extend(recs[:t1])
        val_set.extend(recs[t1:t2])
        test_set.extend(recs[t2:])
    
    random.shuffle(train_set)
    random.shuffle(val_set)
    random.shuffle(test_set)
    return train_set, val_set, test_set


def generate_dataset_card(output_dir, records, plan, source_stats, args, train_n, val_n, test_n):
    """Generate a comprehensive dataset card."""
    from collections import Counter
    
    source_dist = Counter(r.get("source", "?") for r in records)
    quality_scores = [r.get("quality_score", 0) for r in records]
    
    card = {
        "dataset_name": f"autonomous_{time.strftime('%Y%m%d_%H%M%S')}",
        "description": args.prompt,
        "generation_method": "autonomous_multi_source",
        "plan": {
            "task_type": plan.get("task_type", "unknown"),
            "domain": plan.get("domain", ""),
            "keywords": plan.get("keywords", []),
            "sources_queried": list(source_stats.keys()),
        },
        "statistics": {
            "total_records": len(records),
            "splits": {"train": train_n, "validation": val_n, "test": test_n},
            "source_distribution": dict(source_dist.most_common()),
            "raw_records_per_source": source_stats,
        },
        "quality": {
            "mean_score": round(sum(quality_scores) / max(len(quality_scores), 1), 3),
            "min_score": round(min(quality_scores) if quality_scores else 0, 3),
            "max_score": round(max(quality_scores) if quality_scores else 0, 3),
        },
        "pipeline": {
            "deduplication": "exact_hash + jaccard_similarity",
            "pii_removal": "regex_patterns",
            "quality_scoring": "heuristic_length_diversity_structure",
        },
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "generator": "Text2LLM Autonomous Dataset Creator v2.0",
    }
    
    card_path = os.path.join(output_dir, "dataset_card.json")
    with open(card_path, "w", encoding="utf-8") as f:
        json.dump(card, f, indent=2, ensure_ascii=False)
    log(f"Dataset card: {card_path}")
    return card


def assemble_and_deliver(records, plan, source_stats, args):
    """Phase 4: Split, write, and generate dataset card."""
    log("Phase 4: Assembling final dataset...")
    progress("assembling", "Splitting into train/val/test...")
    
    train, val, test = split_dataset(records)
    
    output_dir = args.output_dir
    os.makedirs(output_dir, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    
    if args.output_format == "jsonl":
        write_jsonl(train, os.path.join(output_dir, f"train_{ts}.jsonl"))
        write_jsonl(val, os.path.join(output_dir, f"val_{ts}.jsonl"))
        write_jsonl(test, os.path.join(output_dir, f"test_{ts}.jsonl"))
    elif args.output_format in ("parquet", "csv"):
        try:
            import pandas as pd
            for name, split in [("train", train), ("val", val), ("test", test)]:
                flat = [{
                    "text": r.get("text", ""),
                    "source": r.get("source", ""),
                    "url": r.get("url", ""),
                    "title": r.get("title", ""),
                    "quality_score": r.get("quality_score", 0),
                } for r in split]
                df = pd.DataFrame(flat)
                ext = args.output_format
                path = os.path.join(output_dir, f"{name}_{ts}.{ext}")
                if ext == "parquet":
                    df.to_parquet(path, index=False)
                else:
                    df.to_csv(path, index=False)
                log(f"Wrote {len(flat)} records → {path}")
        except ImportError:
            log("pandas not installed. Falling back to JSONL.")
            write_jsonl(train, os.path.join(output_dir, f"train_{ts}.jsonl"))
            write_jsonl(val, os.path.join(output_dir, f"val_{ts}.jsonl"))
            write_jsonl(test, os.path.join(output_dir, f"test_{ts}.jsonl"))
    
    card = generate_dataset_card(output_dir, records, plan, source_stats, args,
                                  len(train), len(val), len(test))
    
    progress("completed", f"Dataset ready: {len(records)} records")
    return card


# ═══════════════════════════════════════════════════════════════════════════
# Main Entry Point
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description="Autonomous Dataset Creator — Describe → Collect → Refine → Deliver"
    )
    parser.add_argument("--prompt", required=True, help="Natural language dataset description")
    parser.add_argument("--api-key", default="", help="LLM API key for query planning")
    parser.add_argument("--api-provider", default="openai",
                        choices=["openai", "anthropic", "google", "gemini", "openrouter"],
                        help="LLM provider for query planning")
    parser.add_argument("--target-rows", type=int, default=5000, help="Target number of rows")
    parser.add_argument("--output-format", default="jsonl", choices=["jsonl", "parquet", "csv"])
    parser.add_argument("--output-dir", default="./output/autonomous", help="Output directory")
    parser.add_argument("--min-quality", type=float, default=0.4, help="Min quality score (0-1)")
    parser.add_argument("--dry-run", action="store_true", help="Only emit the plan, no collection")
    args = parser.parse_args()

    # ── Auto-detect API key from environment variables (set by Infra page) ──
    api_key = args.api_key
    api_provider = args.api_provider

    if not api_key:
        env_key_map = [
            ("OPENROUTER_API_KEY", "openrouter"),
            ("OPENAI_API_KEY", "openai"),
            ("ANTHROPIC_API_KEY", "anthropic"),
            ("GOOGLE_API_KEY", "google"),
            ("GEMINI_API_KEY", "gemini"),
        ]
        for env_name, provider_name in env_key_map:
            val = os.environ.get(env_name, "").strip()
            if val:
                api_key = val
                api_provider = provider_name
                break

    log("═" * 60)
    log("AUTONOMOUS DATASET CREATOR v2.0")
    log("═" * 60)
    log(f"Prompt: {args.prompt}")
    log(f"Target: {args.target_rows} rows | Format: {args.output_format}")
    if api_key:
        masked = api_key[:6] + "..." + api_key[-4:] if len(api_key) > 10 else "***"
        log(f"LLM Provider: {api_provider} (key: {masked})")
    log("")

    # ── Phase 1: Plan ──
    if api_key:
        plan = create_collection_plan(args.prompt, api_key, api_provider, args.target_rows)
    else:
        log("No API key found in args or environment. Using keyword-based fallback planning.")
        plan = create_fallback_plan(args.prompt)
    
    log(f"\nCollection Plan:")
    log(f"  Task Type: {plan.get('task_type', 'unknown')}")
    log(f"  Domain: {plan.get('domain', '')}")
    log(f"  Keywords: {plan.get('keywords', [])}")
    log(f"  Sources: {plan.get('target_sources', [])}")
    log("")
    
    if args.dry_run:
        print(json.dumps(plan, indent=2))
        return

    # ── Phase 2: Collect ──
    raw_records, source_stats = run_collection(plan, args.target_rows)
    
    if not raw_records:
        log("ERROR: No records collected from any source.")
        progress("failed", "No data could be collected")
        sys.exit(1)
    
    # ── Phase 3: Refine ──
    refined = refine_records(raw_records, args.target_rows, args.min_quality)
    
    if not refined:
        log("ERROR: All records were filtered out during refinement.")
        progress("failed", "All collected data was below quality threshold")
        sys.exit(1)
    
    # ── Phase 4: Assemble & Deliver ──
    card = assemble_and_deliver(refined, plan, source_stats, args)
    
    log("")
    log("═" * 60)
    log("DATASET GENERATION COMPLETE")
    log("═" * 60)
    log(f"Total records: {card['statistics']['total_records']}")
    log(f"Sources: {list(card['statistics']['source_distribution'].keys())}")
    log(f"Quality mean: {card['quality']['mean_score']}")
    log(f"Train/Val/Test: {card['statistics']['splits']['train']}"
        f"/{card['statistics']['splits']['validation']}"
        f"/{card['statistics']['splits']['test']}")


if __name__ == "__main__":
    main()
