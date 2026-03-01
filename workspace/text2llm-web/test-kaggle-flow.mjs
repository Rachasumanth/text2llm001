
// Native fetch is available in Node 18+
// const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
import { spawn } from 'child_process';

async function testKaggleFlow() {
  console.log("Testing Kaggle Flow...");

  let response;
  try {
    response = await fetch('http://localhost:8787/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: "finetune qwen model to make a maths sir ai"
      })
    });

  } catch (error) {
    console.error("Fetch error details:", error);
    return;
  }

  if (!response.ok) {
    console.error("Failed to start chat session:", response.status, response.statusText);
    const text = await response.text();
    console.error("Response body:", text);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep incomplete line

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const dataStr = line.slice(6);
        try {
          const data = JSON.parse(dataStr);
          if (data.text) {
              process.stdout.write(data.text);
          }
          if (data.sessionId) {
              console.log(`\nSession ID: ${data.sessionId}`);
          }
        } catch (e) {
          // Ignore parsing errors for non-JSON data lines
        }
      }
    }
  }

  console.log("\nStream ended.");

   // Keep alive for a bit to receive response
   await new Promise(resolve => setTimeout(resolve, 30000));
   process.exit(0);
}

testKaggleFlow().catch(console.error);
