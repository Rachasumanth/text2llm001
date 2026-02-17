const http = require('http');

const BASE_URL = 'http://localhost:8788';

async function request(method, path, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(BASE_URL + path, {
      method,
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function runReliabilityTests() {
  console.log("Starting Reliability Tests...");

  // Setup: Configure provider
  await request('POST', '/api/instances/gpu/provider/configure', {
    providerId: 'selfhosted',
    credentials: { SSH_HOST: '127.0.0.1', SSH_USER: 'test', SSH_PRIVATE_KEY: 'key' }
  });

  // 1. Queue Saturation
  console.log("\n--- Queue Saturation ---");
  const launchSat = await request('POST', '/api/instances/gpu/instance/launch', {
    providerId: 'selfhosted', region: 'custom', gpuType: 'T4', name: 'sat-instance', projectId: 'sat'
  });
  if (!launchSat.body.ok) { console.error("Launch failed for saturation:", launchSat.body); return; }
  const satId = launchSat.body.instance.id;
  console.log("Launched instance:", satId);

  // Send 15 concurrent requests
  const promises = [];
  for (let i = 0; i < 15; i++) {
    promises.push(request('POST', '/api/instances/gpu/inference', {
      projectId: 'sat', instanceId: satId, prompt: `Req ${i}`
    }));
  }
  const results = await Promise.all(promises);
  const statusCodes = results.map(r => r.status);
  const has429 = statusCodes.includes(429);
  console.log("Status codes:", statusCodes);
  console.log("Queue Saturation (expect 429):", has429 ? "PASS" : "FAIL");

  // 2. Budget Cap
  console.log("\n--- Budget Cap ---");
  const launchBudget = await request('POST', '/api/instances/gpu/instance/launch', {
    providerId: 'selfhosted', region: 'custom', gpuType: 'T4', name: 'budget-instance', projectId: 'budget',
    budgetPolicy: { hardSpendCapUsd: 0.0001, alertThresholds: [0.5, 0.9] }
  });
  // T4 cost is ~0.35/hr. 0.0001 cap is very low.
  // Wait, launch happens first. Pre-launch check: estimateLaunchHourlyCostUsd(T4, 1) = 0.35.
  // 0.35 > 0.0001 -> Launch should fail with 400.
  console.log("Budget Launch Status:", launchBudget.status);
  if (launchBudget.status === 400 && launchBudget.body.error.includes("budget cap")) {
    console.log("Budget Cap (expect launch blocked): PASS");
  } else {
    console.log("Budget Cap: FAIL", launchBudget.body);
  }

  // 3. Fallback Route
  console.log("\n--- Fallback Route ---");
  // Configure fallback routes is not an API endpoint in server.mjs I saw earlier?
  // Let me check. resolveFallbackInstance uses config.gpu.fallbackRoutes.
  // Is there a POST endpoint to set it?
  // I didn't verify it in server.mjs.
  // I'll check if I can just assume it works if I had access, but for now I'll skip setting it via API if API doesn't exist.
  // Wait, server.mjs has `ensureInferenceProfile` etc but `fallbackRoutes` are in config.
  // Looking at server.mjs, I don't see `app.post("/api/instances/gpu/fallback-route")`.
  // User's plan says: `Verify fallback route behavior via GET/POST /api/instances/gpu/fallback-route`.
  // If user says so, it might exist in the code I haven't seen (lines 1600+).
  // I'll check for that route.


  // 3. Fallback Route
  console.log("\n--- Fallback Route ---");
  // Configure Primary and Secondary
  const launchPri = await request('POST', '/api/instances/gpu/instance/launch', {
    providerId: 'selfhosted', region: 'custom', gpuType: 'T4', name: 'primary', projectId: 'fallback-test'
  });
  const launchSec = await request('POST', '/api/instances/gpu/instance/launch', {
    providerId: 'selfhosted', region: 'custom', gpuType: 'T4', name: 'secondary', projectId: 'fallback-test'
  });
  
  const priId = launchPri.body.instance.id;
  const secId = launchSec.body.instance.id;
  
  // Set Primary as route
  await request('POST', '/api/instances/gpu/routing', { projectId: 'fallback-test', instanceId: priId });
  
  // Set Secondary as fallback
  await request('POST', '/api/instances/gpu/fallback-route', { projectId: 'fallback-test', fallbackInstanceId: secId });
  
  // Verify route
  const routeCheck = await request('GET', '/api/instances/gpu/fallback-route?projectId=fallback-test');
  console.log("Fallback configured:", routeCheck.body.fallbackInstanceId === secId ? "PASS" : "FAIL");

  // Force Primary failure (using FORCE_FAILURE)
  // Logic: 
  // 1. Send request "FORCE_FAILURE" to Primary.
  // 2. runInferenceWithRetry fails.
  // 3. Server resolves fallback -> Secondary.
  // 4. Server retries on Secondary.
  // 5. Secondary succeeds (if prompt doesn't cause failure there too? prompt is same.)
  // Wait, if prompt is "FORCE_FAILURE", it will fail on Secondary too!
  // I need to make Primary fail but Secondary succeed.
  // My modification to `gpu-phase2.mjs` checks `prompt`.
  // I cannot distinguish instances by prompt easily.
  // But wait, circuit breaker opens after threshold.
  // If I trip the breaker on Primary, then subsequent requests (even valid ones) should go to Fallback.
  
  console.log("--- Circuit Breaker & Fallback ---");
  // Trip breaker on Primary
  // Default threshold is 3.
  for (let i = 0; i < 4; i++) {
    await request('POST', '/api/instances/gpu/inference', {
      projectId: 'fallback-test', instanceId: priId, prompt: "FORCE_FAILURE"
    });
  }
  
  // Now Primary breaker should be OPEN.
  // Request with VALID prompt to Primary (via routing or explicit ID).
  // If routed to Primary, server checks breaker. If open, it uses fallback.
  // Fallback (Secondary) should handle valid prompt.
  
  const recoverReq = await request('POST', '/api/instances/gpu/inference', {
    projectId: 'fallback-test', prompt: "Healthy Request" // Routed to Primary -> Breaker -> Fallback -> Success
  });
  
  console.log("Fallback Recovery:", recoverReq.body.ok ? "PASS" : "FAIL");
  if (recoverReq.body.ok) {
     console.log("Routed Instance:", recoverReq.body.routedInstanceId); // Should be same as requested? No.
     // Response doesn't explicitly say "executed on X" effectively unless I check logs or something.
     // But `routedInstanceId` in response seems to be the *intended* one (Primary), or the one it actually ran on?
     // server.mjs line 2283: `routedInstanceId: instance.id`. `instance` is updated to fallback instance.
     console.log("Executed on:", recoverReq.body.requestLog.instanceId);
     console.log("Secondary ID:", secId);
     if (recoverReq.body.requestLog.instanceId === secId) {
         console.log("Traffic correctly diverted to Fallback: PASS");
     } else {
         console.log("Traffic stayed on Primary: FAIL");
     }
  }

}

runReliabilityTests().catch(console.error);
