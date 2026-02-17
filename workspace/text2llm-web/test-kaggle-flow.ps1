
$postParams = @{
    message = "finetune qwen model to make a maths sir ai"
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "http://localhost:8787/api/chat" -Method POST -Body $postParams -ContentType "application/json" -TimeoutSec 30
    
    # SSE stream handling is tricky in simple Invoke-WebRequest. 
    # Attempting to read stream line by line if possible, or just print content.
    # For now, let's just dump the raw content we get back.
    Write-Host "Response Received:"
    $response.Content
}
catch {
    Write-Host "Error: $_"
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader $_.Exception.Response.GetResponseStream()
        $text = $reader.ReadToEnd()
        Write-Host "Response Body: $text"
    }
}
