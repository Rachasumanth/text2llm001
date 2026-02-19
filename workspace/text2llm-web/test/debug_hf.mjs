
const fetch = global.fetch;

async function checkHFHeaders() {
  const url = "https://huggingface.co/api/models?search=llama&limit=1&sort=downloads&direction=-1";
  console.log(`Fetching ${url}...`);
  try {
    const resp = await fetch(url);
    console.log("Status:", resp.status);
    console.log("x-total-count:", resp.headers.get("x-total-count"));
    console.log("link:", resp.headers.get("link"));
    
    // Also check without limit
    const url2 = "https://huggingface.co/api/models?search=llama&limit=10&sort=downloads&direction=-1";
    const resp2 = await fetch(url2);
    console.log("x-total-count (limit 10):", resp2.headers.get("x-total-count"));
    
  } catch (err) {
    console.error(err);
  }
}

checkHFHeaders();
