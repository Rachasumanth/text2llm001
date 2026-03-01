import fs from "fs";

async function run() {
  const result = await fetch("http://localhost:8787/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: "hello there",
      model: "llama-3.3-70b-versatile",
      provider: "google",
    }),
  });
  const text = await result.text();
  console.log("Response:", text.substring(0, 500));
}

run().catch(console.error);
