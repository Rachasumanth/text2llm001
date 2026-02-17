$LogFile = "c:\Users\4HIN\source\text2llm\workspace\text2llm-web\e2e_log.txt"
"Starting E2E Test" | Out-File -FilePath $LogFile -Encoding utf8

$baseUrl = "http://localhost:8788"

function Request-API {
    param(
        [string]$Method,
        [string]$Path,
        [hashtable]$Body = @{}
    )
    $uri = "$baseUrl$Path"
    if ($Method -eq "GET") {
        try {
            $response = Invoke-RestMethod -Uri $uri -Method Get -ErrorAction Stop
            "PASS: GET $Path" | Out-File -FilePath $LogFile -Append -Encoding utf8
            return $response
        } catch {
            "FAIL: GET $Path" | Out-File -FilePath $LogFile -Append -Encoding utf8
            $_.Exception.Message | Out-File -FilePath $LogFile -Append -Encoding utf8
            return $null
        }
    } else {
        try {
            $json = $Body | ConvertTo-Json -Depth 10
            $response = Invoke-RestMethod -Uri $uri -Method Post -Body $json -ContentType "application/json" -ErrorAction Stop
            "PASS: POST $Path" | Out-File -FilePath $LogFile -Append -Encoding utf8
            return $response
        } catch {
            "FAIL: POST $Path" | Out-File -FilePath $LogFile -Append -Encoding utf8
            $_.Exception.Message | Out-File -FilePath $LogFile -Append -Encoding utf8
            if ($_.Exception.Response) {
                $stream = $_.Exception.Response.GetResponseStream()
                $reader = New-Object System.IO.StreamReader($stream)
                $body = $reader.ReadToEnd()
                "Response Body: $body" | Out-File -FilePath $LogFile -Append -Encoding utf8
            }
            return $null
        }
    }
}

# 1. Health and Providers
Request-API -Method "GET" -Path "/api/health" | Out-Null
Request-API -Method "GET" -Path "/api/instances/gpu/providers" | Out-Null

# 2. Configure Provider
$creds = @{
    SSH_HOST = "127.0.0.1"
    SSH_USER = "tester"
    SSH_PRIVATE_KEY = "-----BEGIN TEST KEY-----abc"
}
Request-API -Method "POST" -Path "/api/instances/gpu/provider/configure" -Body @{
    providerId = "selfhosted"
    credentials = $creds
} | Out-Null

# 3. Validate Creds
Request-API -Method "POST" -Path "/api/instances/gpu/provider/test" -Body @{
    providerId = "selfhosted"
} | Out-Null

# 4. Launch Instance
$launchRes = Request-API -Method "POST" -Path "/api/instances/gpu/instance/launch" -Body @{
    providerId = "selfhosted"
    region = "custom"
    gpuType = "T4"
    gpuCount = 1
    name = "qa-e2e-instance"
    projectId = "qa-e2e"
    runtime = @{
        templateId = "vllm"
        model = "qa-model"
    }
}

if ($launchRes -and $launchRes.ok) {
    $instanceId = $launchRes.instance.id
    "Instance Launched: $instanceId" | Out-File -FilePath $LogFile -Append -Encoding utf8

    # 5. Set Route
    Request-API -Method "POST" -Path "/api/instances/gpu/routing" -Body @{
        projectId = "qa-e2e"
        instanceId = $instanceId
    } | Out-Null

    # 6. Run Inference
    $inferRes = Request-API -Method "POST" -Path "/api/instances/gpu/inference" -Body @{
        projectId = "qa-e2e"
        prompt = "Hello QA"
    }
    
    if ($inferRes -and $inferRes.json.result.output) {
        "Inference Output: $($inferRes.json.result.output)" | Out-File -FilePath $LogFile -Append -Encoding utf8
    }

    # 7. Stop Instance
    Request-API -Method "POST" -Path "/api/instances/gpu/instance/action" -Body @{
        instanceId = $instanceId
        action = "stop"
    } | Out-Null
    
} else {
    "Skipping subsequent steps due to launch failure" | Out-File -FilePath $LogFile -Append -Encoding utf8
}
