
const fetch = global.fetch;

async function testStore() {
  console.log("Testing Store API Providers...");
  const providers = [
    { name: "Hugging Face", source: "huggingface", query: "llama" },
    { name: "GitHub", source: "github", query: "transformer" },
    { name: "Arxiv", source: "arxiv", query: "language model" },
    { name: "Kaggle", source: "kaggle", query: "chocolate" },
    { name: "Civitai", source: "civitai", query: "anime" },
    { name: "Papers With Code", source: "paperswithcode", query: "machine learning" }
  ];

  try {
    for (const p of providers) {
      console.log(`\nChecking ${p.name}...`);
      const res = await fetch(`http://localhost:8787/api/store/search?q=${p.query}&source=${p.source}&limit=1`);
      if (!res.ok) throw new Error(`${p.name} check failed: ${res.status}`);
      
      const results = await res.json(); // Renamed 'data' to 'results' to match the instruction's usage
      const items = results.results.length; // Corrected from results.data.results.length
      const count = results.totalCount; // Corrected from results.data.totalCount
      const hasMore = results.hasMore; // Corrected from results.data.hasMore

      console.log(`- Items returned: ${items}`);
      console.log(`- Total Available: ${count ?? "Unknown (Honest Mode)"}`);
      console.log(`- Has More: ${hasMore}`);

      if (items > 0) {
          if (count > 0 || hasMore) {
              console.log(`PASS: ${p.name} allocated items. Valid behavior.`);
          } else {
              console.warn(`WARNING: ${p.name} returned items but no more pages indicated.`);
          }
      } else {
         if (p.source === 'paperswithcode') {
             // PWC might fail due to rate limits without errors, just empty
             console.warn(`NOTE: ${p.name} returned 0 items. S2 API might be rate limited or strict.`);
         } else {
             console.warn(`WARNING: ${p.name} returned 0 items.`);
         }
      }
      console.log("");
    }
    console.log("\nVerification Complete.");
  } catch (err) {
    console.error("Verification Error:", err);
    process.exit(1);
  }
}

testStore();
