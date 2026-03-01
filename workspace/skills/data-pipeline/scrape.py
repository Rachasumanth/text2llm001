#!/usr/bin/env python3
"""
Dataset Creator – Web Scraping Engine
Orchestrates Playwright, Scrapy, or Firecrawl to gather data from seed URLs.
Called by dataset-worker.mjs when a scraping job is dispatched.

Usage:
  python scrape.py --engine playwright --urls "https://a.com,https://b.com" \
                   --depth 3 --focus text --output-format jsonl
"""

import argparse
import json
import os
import sys
import time
import hashlib
from pathlib import Path
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def log(msg):
    print(f"[scrape] {msg}", flush=True)

def sha256_hash(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()

def write_jsonl(records, output_path):
    with open(output_path, "w", encoding="utf-8") as fh:
        for record in records:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    log(f"Wrote {len(records)} records to {output_path}")

# ---------------------------------------------------------------------------
# Playwright-based scraper (JS-heavy pages, SPA rendering)
# ---------------------------------------------------------------------------

def scrape_with_playwright(urls, max_depth, focus):
    """
    Uses Playwright to render pages and extract content.
    Requires: pip install playwright && python -m playwright install chromium
    """
    records = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("WARNING: playwright not installed. Using fallback HTTP scraper.")
        return scrape_with_fallback(urls, max_depth, focus)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        page = browser.new_page()

        visited = set()
        queue = [(url.strip(), 0) for url in urls if url.strip()]

        while queue:
            current_url, depth = queue.pop(0)
            if current_url in visited or depth > max_depth:
                continue
            visited.add(current_url)

            try:
                log(f"Scraping (depth={depth}): {current_url}")
                page.goto(current_url, timeout=30000, wait_until="domcontentloaded")
                time.sleep(1)  # Let JS render

                if focus == "text":
                    content = page.inner_text("body")
                elif focus == "audio":
                    # Extract audio src attributes
                    audio_els = page.query_selector_all("audio source, audio[src]")
                    content = json.dumps([
                        el.get_attribute("src") for el in audio_els if el.get_attribute("src")
                    ])
                elif focus == "sensor":
                    # Look for JSON/CSV download links
                    links = page.query_selector_all("a[href$='.json'], a[href$='.csv']")
                    content = json.dumps([
                        el.get_attribute("href") for el in links if el.get_attribute("href")
                    ])
                else:  # multimodal
                    content = page.content()

                records.append({
                    "url": current_url,
                    "depth": depth,
                    "focus": focus,
                    "content_hash": sha256_hash(content),
                    "content_length": len(content),
                    "text": content[:50000],  # Cap at 50k chars per page
                    "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

                # Discover child links for deeper crawling
                if depth < max_depth:
                    anchors = page.query_selector_all("a[href]")
                    for anchor in anchors[:50]:  # Limit link discovery per page
                        href = anchor.get_attribute("href")
                        if href and href.startswith("http"):
                            parsed = urlparse(href)
                            if parsed.netloc == urlparse(current_url).netloc:
                                queue.append((href, depth + 1))

            except Exception as e:
                log(f"Error scraping {current_url}: {e}")
                records.append({
                    "url": current_url,
                    "depth": depth,
                    "error": str(e),
                    "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

        browser.close()

    return records

# ---------------------------------------------------------------------------
# Scrapy cluster-based scraper (high-volume crawling)
# ---------------------------------------------------------------------------

def scrape_with_scrapy(urls, max_depth, focus):
    """
    Uses Scrapy via CrawlerProcess for high-volume crawling.
    Requires: pip install scrapy
    """
    records = []
    try:
        import scrapy
        from scrapy.crawler import CrawlerProcess
        from scrapy.utils.project import get_project_settings

        class DatasetSpider(scrapy.Spider):
            name = "dataset_spider"
            start_urls = [u.strip() for u in urls if u.strip()]
            custom_settings = {
                "DEPTH_LIMIT": max_depth,
                "CONCURRENT_REQUESTS": 8,
                "DOWNLOAD_DELAY": 0.5,
                "ROBOTSTXT_OBEY": True,
                "LOG_LEVEL": "WARNING",
            }

            def parse(self, response):
                if focus == "text":
                    text = " ".join(response.css("body *::text").getall()).strip()
                elif focus == "audio":
                    text = json.dumps(response.css("audio source::attr(src), audio::attr(src)").getall())
                elif focus == "sensor":
                    text = json.dumps(response.css("a[href$='.json']::attr(href), a[href$='.csv']::attr(href)").getall())
                else:
                    text = response.text

                records.append({
                    "url": response.url,
                    "depth": response.meta.get("depth", 0),
                    "focus": focus,
                    "content_hash": sha256_hash(text),
                    "content_length": len(text),
                    "text": text[:50000],
                    "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                })

                # Follow links
                for next_page in response.css("a::attr(href)").getall()[:50]:
                    if next_page.startswith("http"):
                        yield response.follow(next_page, callback=self.parse)

        process = CrawlerProcess()
        process.crawl(DatasetSpider)
        process.start()

    except ImportError:
        log("WARNING: scrapy not installed. Using fallback HTTP scraper.")
        return scrape_with_fallback(urls, max_depth, focus)

    return records

# ---------------------------------------------------------------------------
# Firecrawl AI-powered extraction
# ---------------------------------------------------------------------------

def scrape_with_firecrawl(urls, max_depth, focus):
    """
    Uses the Firecrawl API for AI-powered web extraction.
    Requires: FIRECRAWL_API_KEY env var and pip install firecrawl-py
    """
    records = []
    api_key = os.environ.get("FIRECRAWL_API_KEY", "")

    try:
        from firecrawl import FirecrawlApp
        app = FirecrawlApp(api_key=api_key)

        for url in urls:
            url = url.strip()
            if not url:
                continue
            log(f"Firecrawl extracting: {url}")
            try:
                result = app.crawl_url(url, params={
                    "limit": max_depth * 10,
                    "scrapeOptions": {"formats": ["markdown", "html"]}
                })
                for page in (result.get("data", []) if isinstance(result, dict) else []):
                    content = page.get("markdown", page.get("html", ""))
                    records.append({
                        "url": page.get("metadata", {}).get("sourceURL", url),
                        "focus": focus,
                        "content_hash": sha256_hash(content),
                        "content_length": len(content),
                        "text": content[:50000],
                        "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    })
            except Exception as e:
                log(f"Firecrawl error for {url}: {e}")
                records.append({"url": url, "error": str(e)})

    except ImportError:
        log("WARNING: firecrawl-py not installed. Using fallback HTTP scraper.")
        return scrape_with_fallback(urls, max_depth, focus)

    return records

# ---------------------------------------------------------------------------
# Fallback: simple urllib-based scraper (no deps needed)
# ---------------------------------------------------------------------------

def scrape_with_fallback(urls, max_depth, focus):
    """Minimal scraper using only stdlib – always available."""
    import urllib.request
    from html.parser import HTMLParser

    class TextExtractor(HTMLParser):
        def __init__(self):
            super().__init__()
            self.texts = []
        def handle_data(self, data):
            self.texts.append(data)
        def get_text(self):
            return " ".join(self.texts)

    records = []
    visited = set()
    queue = [(u.strip(), 0) for u in urls if u.strip()]

    while queue:
        url, depth = queue.pop(0)
        if url in visited or depth > max_depth:
            continue
        visited.add(url)

        try:
            log(f"Fallback scraping (depth={depth}): {url}")
            req = urllib.request.Request(url, headers={"User-Agent": "Text2LLM-DatasetCreator/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                html = resp.read().decode("utf-8", errors="replace")

            extractor = TextExtractor()
            extractor.feed(html)
            text = extractor.get_text().strip()

            records.append({
                "url": url,
                "depth": depth,
                "focus": focus,
                "content_hash": sha256_hash(text),
                "content_length": len(text),
                "text": text[:50000],
                "scraped_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            })
        except Exception as e:
            log(f"Fallback error for {url}: {e}")
            records.append({"url": url, "depth": depth, "error": str(e)})

    return records

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

ENGINE_MAP = {
    "playwright": scrape_with_playwright,
    "scrapy": scrape_with_scrapy,
    "firecrawl": scrape_with_firecrawl,
    "fallback": scrape_with_fallback,
}

def main():
    parser = argparse.ArgumentParser(description="Dataset Creator – Web Scraping Engine")
    parser.add_argument("--engine", default="playwright", choices=ENGINE_MAP.keys())
    parser.add_argument("--urls", required=True, help="Comma-separated seed URLs")
    parser.add_argument("--depth", type=int, default=3, help="Max crawl depth")
    parser.add_argument("--focus", default="text", choices=["text", "audio", "sensor", "multimodal"])
    parser.add_argument("--output-format", default="jsonl", choices=["jsonl", "parquet", "csv"])
    parser.add_argument("--output-dir", default="./output", help="Directory to write results")
    args = parser.parse_args()

    urls = [u for u in args.urls.split(",") if u.strip()]
    if not urls:
        log("ERROR: No seed URLs provided.")
        sys.exit(1)

    log(f"Starting scrape: engine={args.engine}, urls={len(urls)}, depth={args.depth}, focus={args.focus}")

    scrape_fn = ENGINE_MAP[args.engine]
    records = scrape_fn(urls, args.depth, args.focus)

    log(f"Scraped {len(records)} records total.")

    # Write output
    os.makedirs(args.output_dir, exist_ok=True)
    timestamp = time.strftime("%Y%m%d_%H%M%S")

    if args.output_format == "jsonl":
        output_path = os.path.join(args.output_dir, f"scraped_{timestamp}.jsonl")
        write_jsonl(records, output_path)
    elif args.output_format == "parquet":
        try:
            import pandas as pd
            df = pd.DataFrame(records)
            output_path = os.path.join(args.output_dir, f"scraped_{timestamp}.parquet")
            df.to_parquet(output_path, index=False)
            log(f"Wrote {len(records)} records to {output_path}")
        except ImportError:
            log("WARNING: pandas/pyarrow not installed. Falling back to JSONL.")
            output_path = os.path.join(args.output_dir, f"scraped_{timestamp}.jsonl")
            write_jsonl(records, output_path)
    elif args.output_format == "csv":
        try:
            import pandas as pd
            df = pd.DataFrame(records)
            output_path = os.path.join(args.output_dir, f"scraped_{timestamp}.csv")
            df.to_csv(output_path, index=False)
            log(f"Wrote {len(records)} records to {output_path}")
        except ImportError:
            log("WARNING: pandas not installed. Falling back to JSONL.")
            output_path = os.path.join(args.output_dir, f"scraped_{timestamp}.jsonl")
            write_jsonl(records, output_path)

    log("Scrape complete.")

if __name__ == "__main__":
    main()
