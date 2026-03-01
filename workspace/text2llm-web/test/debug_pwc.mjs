
const fetch = global.fetch;

async function checkPWC() {
  console.log("Checking Papers With Code (via Semantic Scholar)...");
  try {
    const query = "machine learning code implementation";
    const offset = 0;
    const limit = 20;
    const s2Url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}&fields=title,total`;
    // Note: 'total' might not be a valid field in 'fields' param, usually it's in the root response.
    // Let's try fetching with minimal fields to check root response.
    const s2Url2 = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}`;
    
    await new Promise(r => setTimeout(r, 2000)); // Wait 2s
    console.log(`Fetching ${s2Url2}...`);
    let resp = await fetch(s2Url2);
    if (resp.status === 429) {
       console.log("429, waiting longer...");
       await new Promise(r => setTimeout(r, 5000));
       resp = await fetch(s2Url2);
    }
    if (!resp.ok) console.log("S2 fetch failed:", resp.status);
    else {
      const data = await resp.json();
      console.log("Keys:", Object.keys(data));
      console.log("Total:", data.total);
      console.log("Items:", data.data?.length);
    }
  } catch (err) {
    console.error(err);
  }
}

checkPWC();
