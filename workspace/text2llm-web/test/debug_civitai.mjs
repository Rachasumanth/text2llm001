
const fetch = global.fetch;

async function checkCivitai() {
  console.log("Checking Civitai API...");
  try {
    const url = "https://civitai.com/api/v1/models?query=anime&limit=12&sort=Most%20Downloaded"; 
    console.log(`Fetching ${url}...`);
    const resp = await fetch(url);
    if (!resp.ok) console.log("Civitai fetch failed:", resp.status);
    else {
      const data = await resp.json();
      console.log("Metadata keys:", Object.keys(data.metadata || {}));
      console.log("Total Items:", data.metadata?.totalItems);
      console.log("Next Cursor:", data.metadata?.nextCursor);
      console.log("Items count:", data.items?.length);
      
      if (!data.metadata?.totalItems) {
         console.log("issue: totalItems is missing or undefined");
      }
    }
  } catch (err) {
    console.error(err);
  }
}

checkCivitai();
