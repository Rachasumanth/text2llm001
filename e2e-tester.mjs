import { performance } from 'perf_hooks';

async function testResponseTime() {
  console.log("Starting E2E Test on localhost:8787...");
  
  const start = performance.now();
  let firstChunkTime = null;
  const reqBody = {
    message: "Calculate exactly 15 multiplied by 22. Provide the number.",
    sessionId: "e2e-test-" + Date.now()
  };

  try {
    const res = await fetch("http://localhost:8787/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody)
    });

    if (!res.ok) {
      throw new Error(`HTTP error! status: ${res.status}`);
    }

    const decoder = new TextDecoder();
    let textOut = "";
    
    for await (const value of res.body) {
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line.startsWith('event: chunk')) {
           if (!firstChunkTime) {
               firstChunkTime = performance.now();
           }
        }
        if (line.startsWith('data: ')) {
           try {
              const data = JSON.parse(line.slice(6));
              if (data.text && !line.includes('event: status')) {
                 if (!firstChunkTime) firstChunkTime = performance.now();
                 textOut += data.text;
              }
           } catch (e) {}
        }
      }
    }
    
    const end = performance.now();
    
    console.log("--- E2E Test Results ---");
    console.log(`Prompt: "${reqBody.message}"`);
    console.log(`Full Response: "${textOut.trim()}"`);
    
    const ttft = firstChunkTime ? ((firstChunkTime - start)/1000).toFixed(2) : "N/A";
    const ttc = ((end - start)/1000).toFixed(2);
    
    console.log(`Time to first chunk (TTFT): ${ttft} seconds`);
    console.log(`Total Turnaround Time (TTC): ${ttc} seconds`);
    
    if (textOut.includes("330")) {
       console.log("Accuracy: PASS (Found expected answer 330)");
    } else {
       console.log("Accuracy: FAIL (Answer 330 not found)");
    }
  } catch (error) {
    console.error("Test failed:", error);
  }
}

testResponseTime().catch(e => console.error(e));
