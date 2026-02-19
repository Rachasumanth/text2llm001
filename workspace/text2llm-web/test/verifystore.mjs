
const fetch = global.fetch;

async function testStore() {
  console.log("Testing Store API Providers...");
  const providers = [
    { name: "Hugging Face", source: "huggingface", query: "llama" },
    { name: "GitHub", source: "github", query: "transformer" },
    { name: "Arxiv", source: "arxiv", query: "language model" }
  ];

  try {
    for (const p of providers) {
      console.log(`\nChecking ${p.name}...`);
      const res = await fetch(`http://localhost:8787/api/store/search?q=${p.query}&source=${p.source}&limit=1`);
      if (!res.ok) throw new Error(`${p.name} check failed: ${res.status}`);
      
      const data = await res.json();
      const count = data.totalCount;
      const items = data.results.length;
      
      console.log(`- Items returned: ${items}`);
      console.log(`- Total Available: ${count}`);
      
      if (p.source === 'huggingface') {
         if (items > 0) {
            console.log(`PASS: ${p.name} returned items (Total count not supported by API, using rolling count: ${count}).`);
         } else {
            console.warn(`WARNING: ${p.name} returned 0 items.`);
         }
      } else if (typeof count !== 'number' || count < 100) {
         console.warn(`WARNING: ${p.name} total count seems low or missing (${count}). Expected > 100.`);
      } else {
         console.log(`PASS: ${p.name} seems to return valid total count.`);
      }
    }
    console.log("\nVerification Complete.");
  } catch (err) {
    console.error("Verification Error:", err);
    process.exit(1);
  }
}

testStore();
