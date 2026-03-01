$ErrorActionPreference = "Stop"

$port = 8792
$cwd = (Get-Location).Path
$job = Start-Job -ScriptBlock {
  param($repo, $p)
  Set-Location $repo
  $env:TEXT2LLM_WEB_PORT = [string]$p
  node workspace/text2llm-web/server.mjs
} -ArgumentList $cwd, $port

Start-Sleep -Seconds 3

$base = "http://localhost:$port"
$project = "e2e-" + [string][DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$result = [ordered]@{
  base = $base
  projectId = $project
}

try {
  $hfBody = @{
    projectId = $project
    provider = "huggingface"
    datasetId = "squad"
    name = "hf-squad-e2e"
    format = "auto"
  } | ConvertTo-Json
  $hf = Invoke-RestMethod "$base/api/data-studio/datasets/import/remote" -Method Post -ContentType "application/json" -Body $hfBody
  $dsId = $hf.dataset.id
  $result.hf_import_ok = $hf.ok
  $result.hf_dataset_id = $dsId

  $rows = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/rows?page=1&pageSize=5&projectId=${project}"
  $result.hf_rows_count = $rows.rows.Count
  $first = $rows.rows[0]
  $props = @($first.PSObject.Properties.Name)
  $result.hf_first_row_keys = $props
  $result.hf_has_context = ($props -contains "context")
  $result.hf_has_question = ($props -contains "question")

  $cleanBody = @{ operation = "lowercase"; field = "question"; projectId = $project } | ConvertTo-Json
  $clean = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/clean?projectId=${project}" -Method Post -ContentType "application/json" -Body $cleanBody
  $result.clean_ok = $clean.ok
  $beforeChunk = [int]$clean.dataset.stats.rowCount

  $chunkBody = @{ field = "context"; chunkSize = 120; overlap = 20; projectId = $project } | ConvertTo-Json
  $chunk = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/chunk?projectId=${project}" -Method Post -ContentType "application/json" -Body $chunkBody
  $result.chunk_ok = $chunk.ok
  $result.chunk_before = $beforeChunk
  $result.chunk_after = [int]$chunk.dataset.stats.rowCount

  $tagBody = @{ tagField = "topic"; tagValue = "qa"; matchField = "question"; contains = "what"; projectId = $project } | ConvertTo-Json
  $tag = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/tag?projectId=${project}" -Method Post -ContentType "application/json" -Body $tagBody
  $result.tag_ok = $tag.ok

  $splitBody = @{ trainRatio = 80; evalRatio = 10; testRatio = 10; splitField = "split"; projectId = $project } | ConvertTo-Json
  $split = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/split?projectId=${project}" -Method Post -ContentType "application/json" -Body $splitBody
  $result.split_ok = $split.ok

  $rows2 = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/rows?page=1&pageSize=50&projectId=${project}"
  $splitValues = @()
  foreach ($r in $rows2.rows) {
    $splitValues += [string]$r.split
  }
  $result.split_values_sample = ($splitValues | Select-Object -First 10)

  $verBody = @{ label = "checkpoint-1"; projectId = $project } | ConvertTo-Json
  $ver = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/version?projectId=${project}" -Method Post -ContentType "application/json" -Body $verBody
  $result.version_ok = $ver.ok

  $dsMeta = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}?projectId=${project}"
  $result.versions_count = $dsMeta.dataset.versions.Count
  $initial = $null
  foreach ($v in $dsMeta.dataset.versions) {
    if ($v.label -eq "Initial import") {
      $initial = $v.id
    }
  }
  if (-not $initial) {
    $initial = $dsMeta.dataset.versions[-1].id
  }

  $rollBody = @{ versionId = $initial; projectId = $project } | ConvertTo-Json
  $roll = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/rollback?projectId=${project}" -Method Post -ContentType "application/json" -Body $rollBody
  $result.rollback_ok = $roll.ok
  $result.rollback_row_count = [int]$roll.dataset.stats.rowCount

  $addRowBody = @{ row = @{ text = "manual row"; label = "new" }; projectId = $project } | ConvertTo-Json -Depth 8
  $addRow = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/rows?projectId=${project}" -Method Post -ContentType "application/json" -Body $addRowBody
  $result.add_row_ok = $addRow.ok

  $rows3 = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/rows?page=1&pageSize=200&projectId=${project}"
  $manual = $null
  foreach ($r in $rows3.rows) {
    if ([string]$r.text -eq "manual row") {
      $manual = $r
      break
    }
  }
  $manualId = [string]$manual.__rowId
  $result.manual_row_found = [bool]$manualId

  $patchBody = @{ updates = @{ text = "manual row edited" }; projectId = $project } | ConvertTo-Json -Depth 8
  $patch = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/rows/${manualId}?projectId=${project}" -Method Patch -ContentType "application/json" -Body $patchBody
  $result.patch_row_ok = $patch.ok

  $delRow = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/rows/${manualId}?projectId=${project}" -Method Delete
  $result.delete_row_ok = $delRow.ok

  $addColBody = @{ name = "test_col"; defaultValue = "x"; projectId = $project } | ConvertTo-Json
  $addCol = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/columns?projectId=${project}" -Method Post -ContentType "application/json" -Body $addColBody
  $result.add_col_ok = $addCol.ok

  $renColBody = @{ name = "test_col2"; projectId = $project } | ConvertTo-Json
  $renCol = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/columns/test_col?projectId=${project}" -Method Patch -ContentType "application/json" -Body $renColBody
  $result.rename_col_ok = $renCol.ok

  $delCol = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}/columns/test_col2?projectId=${project}" -Method Delete
  $result.delete_col_ok = $delCol.ok

  $img = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WnK8xQAAAAASUVORK5CYII="
  $imgBody = @{
    projectId = $project
    name = "img-upload-e2e"
    sourceType = "upload"
    format = "auto"
    content = ""
    uploadAsset = @{
      name = "pixel.png"
      type = "image/png"
      size = 68
      source = "upload"
      dataUrl = $img
    }
  } | ConvertTo-Json -Depth 10
  $imgRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $imgBody
  $result.image_upload_ok = $imgRes.ok
  $result.image_stats_cols = $imgRes.dataset.stats.columns

  $urlBody = @{ projectId = $project; name = "url-image-e2e"; sourceType = "url"; format = "auto"; url = "https://httpbin.org/image/png" } | ConvertTo-Json
  $urlRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $urlBody
  $result.url_image_ok = $urlRes.ok

  $graphBody = @{ projectId = $project; name = "graph-e2e"; sourceType = "paste"; format = "graph"; content = "graph G { A -- B }" } | ConvertTo-Json
  $graphRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $graphBody
  $result.graph_ok = $graphRes.ok

  $audioData = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
  $audioBody = @{
    projectId = $project
    name = "audio-upload-e2e"
    sourceType = "upload"
    format = "auto"
    content = ""
    uploadAsset = @{
      name = "tone.wav"
      type = "audio/wav"
      size = 44
      source = "upload"
      dataUrl = $audioData
    }
  } | ConvertTo-Json -Depth 10
  $audioRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $audioBody
  $result.audio_upload_ok = $audioRes.ok
  $audioId = $audioRes.dataset.id
  $audioRows = Invoke-RestMethod "$base/api/data-studio/datasets/${audioId}/rows?page=1&pageSize=1&projectId=${project}"
  $result.audio_asset_kind = [string]$audioRows.rows[0].asset_kind

  $videoData = "data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb20="
  $videoBody = @{
    projectId = $project
    name = "video-upload-e2e"
    sourceType = "upload"
    format = "auto"
    content = ""
    uploadAsset = @{
      name = "clip.mp4"
      type = "video/mp4"
      size = 24
      source = "upload"
      dataUrl = $videoData
    }
  } | ConvertTo-Json -Depth 10
  $videoRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $videoBody
  $result.video_upload_ok = $videoRes.ok
  $videoId = $videoRes.dataset.id
  $videoRows = Invoke-RestMethod "$base/api/data-studio/datasets/${videoId}/rows?page=1&pageSize=1&projectId=${project}"
  $result.video_asset_kind = [string]$videoRows.rows[0].asset_kind

  $pdfData = "data:application/pdf;base64,JVBERi0xLjQKJUVPRg=="
  $pdfBody = @{
    projectId = $project
    name = "pdf-upload-e2e"
    sourceType = "upload"
    format = "auto"
    content = ""
    uploadAsset = @{
      name = "doc.pdf"
      type = "application/pdf"
      size = 12
      source = "upload"
      dataUrl = $pdfData
    }
  } | ConvertTo-Json -Depth 10
  $pdfRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $pdfBody
  $result.pdf_upload_ok = $pdfRes.ok
  $pdfId = $pdfRes.dataset.id
  $pdfRows = Invoke-RestMethod "$base/api/data-studio/datasets/${pdfId}/rows?page=1&pageSize=1&projectId=${project}"
  $result.pdf_asset_kind = [string]$pdfRows.rows[0].asset_kind

  $tsvBody = @{
    projectId = $project
    name = "tsv-e2e"
    sourceType = "paste"
    format = "tsv"
    content = "name`tage`nalice`t30`nbob`t40"
  } | ConvertTo-Json
  $tsvRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $tsvBody
  $result.tsv_ok = $tsvRes.ok
  $result.tsv_row_count = [int]$tsvRes.dataset.stats.rowCount

  $markdownBody = @{
    projectId = $project
    name = "markdown-e2e"
    sourceType = "paste"
    format = "markdown"
    content = "# Heading`n`nThis is a markdown paragraph."
  } | ConvertTo-Json
  $markdownRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $markdownBody
  $result.markdown_ok = $markdownRes.ok
  $result.markdown_row_count = [int]$markdownRes.dataset.stats.rowCount

  $yamlBody = @{
    projectId = $project
    name = "yaml-e2e"
    sourceType = "paste"
    format = "yaml"
    content = "- name: alice`n  score: 1`n- name: bob`n  score: 2"
  } | ConvertTo-Json
  $yamlRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $yamlBody
  $result.yaml_ok = $yamlRes.ok
  $result.yaml_row_count = [int]$yamlRes.dataset.stats.rowCount

  $xmlBody = @{
    projectId = $project
    name = "xml-e2e"
    sourceType = "paste"
    format = "xml"
    content = "<root><item><name>alice</name></item><item><name>bob</name></item></root>"
  } | ConvertTo-Json
  $xmlRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $xmlBody
  $result.xml_ok = $xmlRes.ok
  $result.xml_row_count = [int]$xmlRes.dataset.stats.rowCount

  $htmlBody = @{
    projectId = $project
    name = "html-e2e"
    sourceType = "paste"
    format = "html"
    content = "<html><body><h1>hello</h1><p>world</p></body></html>"
  } | ConvertTo-Json
  $htmlRes = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $htmlBody
  $result.html_ok = $htmlRes.ok
  $result.html_row_count = [int]$htmlRes.dataset.stats.rowCount

  $remoteCsvBody = @{
    projectId = $project
    provider = "url"
    url = "https://raw.githubusercontent.com/cs109/2014_data/master/countries.csv"
    name = "remote-csv-e2e"
    format = "auto"
  } | ConvertTo-Json
  $remoteCsv = Invoke-RestMethod "$base/api/data-studio/datasets/import/remote" -Method Post -ContentType "application/json" -Body $remoteCsvBody
  $result.remote_csv_ok = $remoteCsv.ok
  $result.remote_csv_rows = [int]$remoteCsv.dataset.stats.rowCount

  $dedupeBody = @{ projectId = $project; name = "dedupe-check"; sourceType = "paste"; format = "json"; content = '[{"text":"same"},{"text":"same"}]' } | ConvertTo-Json
  $dedupeDs = Invoke-RestMethod "$base/api/data-studio/datasets" -Method Post -ContentType "application/json" -Body $dedupeBody
  $dedupeId = $dedupeDs.dataset.id
  $dedupeCleanBody = @{ operation = "dedupe"; field = "text"; projectId = $project } | ConvertTo-Json
  $dedupeRes = Invoke-RestMethod "$base/api/data-studio/datasets/${dedupeId}/clean?projectId=${project}" -Method Post -ContentType "application/json" -Body $dedupeCleanBody
  $result.dedupe_after = [int]$dedupeRes.dataset.stats.rowCount

  $delDs = Invoke-RestMethod "$base/api/data-studio/datasets/${dsId}?projectId=${project}" -Method Delete
  $result.delete_dataset_ok = $delDs.ok

  $result | ConvertTo-Json -Depth 12
} finally {
  Stop-Job $job | Out-Null
  Remove-Job $job | Out-Null
}
