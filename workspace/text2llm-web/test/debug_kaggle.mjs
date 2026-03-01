
const fetch = global.fetch;

async function checkKaggle() {
  console.log("Checking Kaggle API...");
  try {
    // Check datasets
    const url = "https://www.kaggle.com/api/v1/datasets/list?search=chocolate&page=1&maxSize=&minSize=&filetype=all"; 
    // "chocolate" matches the user screenshot example
    console.log(`Fetching ${url}...`);
    const resp = await fetch(url);
    if (!resp.ok) console.log("Dataset fetch failed:", resp.status);
    else {
      const data = await resp.json();
      const items = Array.isArray(data) ? data : data.datasets || [];
      console.log(`Datasets found: ${items.length}`);
      if (!Array.isArray(data)) {
        console.log("Keys in response object:", Object.keys(data));
        console.log("Total count in response?", data.totalDatasets || data.total || "No");
      } else {
        console.log("Response is an array (no metadata/total count).");
      }
    }

    // Check kernels
    const url2 = "https://www.kaggle.com/api/v1/kernels/list?search=chocolate&page=1&pageSize=12&sortBy=voteCount";
    console.log(`\nFetching ${url2}...`);
    const resp2 = await fetch(url2);
    if (!resp2.ok) console.log("Kernel fetch failed:", resp2.status);
    else {
      const data2 = await resp2.json();
      const items = Array.isArray(data2) ? data2 : data2.kernels || [];
      console.log(`Kernels found: ${items.length}`);
       if (!Array.isArray(data2)) {
        console.log("Keys:", Object.keys(data2));
      } else {
        console.log("Response is an array.");
      }
    }

  } catch (err) {
    console.error(err);
  }
}

checkKaggle();
