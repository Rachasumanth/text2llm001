
const fetch = global.fetch;

async function checkS2() {
  console.log("Checking S2...");
  const query = "large language model"; // Simple query
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&offset=0&limit=10`;
  
  try {
    const resp = await fetch(url);
    if (!resp.ok) {
       console.log("Failed:", resp.status);
       if (resp.status === 429) console.log("Rate limited");
       return;
    }
    const data = await resp.json();
    console.log("Keys:", Object.keys(data));
    console.log("Total:", data.total);
    console.log("Items:", data.data?.length);
  } catch (err) {
    console.error(err);
  }
}

checkS2();
