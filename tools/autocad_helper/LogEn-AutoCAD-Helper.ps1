param([string]$AutoCAD = $env:LOGEN_AUTOCAD_CONSOLE, [int]$Port = 8765)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Net.Http
$script:AllowedOrigins = @('https://dusanjnkvc.github.io', 'null', 'http://localhost:8000', 'http://127.0.0.1:8000')
if (-not $AutoCAD) {
  $candidates = @(Get-ChildItem -Path "$env:ProgramFiles\Autodesk\AutoCAD*\accoreconsole.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending)
  if ($candidates.Count) { $AutoCAD = $candidates[0].FullName }
}
$script:ConsolePath = $AutoCAD
. (Join-Path $PSScriptRoot 'LayoutJobs.ps1')
function Convert-LogEnDrawing([byte[]]$Drawing) {
  if (-not $script:ConsolePath -or -not (Test-Path -LiteralPath $script:ConsolePath)) { throw 'AutoCAD Core Console was not found. Install licensed AutoCAD or set LOGEN_AUTOCAD_CONSOLE to accoreconsole.exe before starting the helper.' }
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $folder = Join-Path $tempRoot ('LogEnCAD-' + [Guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($folder) | Out-Null
  try {
    $inputPath = Join-Path $folder 'warehouse.dwg'
    $outputPath = Join-Path $folder 'warehouse.pdf'
    $scriptPath = Join-Path $folder 'plot.scr'
    [IO.File]::WriteAllBytes($inputPath, $Drawing)
    $lispOutput = $outputPath.Replace('\','/')
    # Run only our generated commands against a temporary copy. Do not save DWG changes.
    $commands = @(
      '(setvar "FILEDIA" 0)', '(setvar "CMDDIA" 0)', '(setvar "BACKGROUNDPLOT" 0)',
      '(setvar "SECURELOAD" 2)',
      '(setvar "TILEMODE" 1)', '(command "_.UCS" "_World")', '(command "_.PLAN" "_World")',
      '(command "_.ZOOM" "_Extents")',
      ('(command "_.-PLOT" "_Yes" "Model" "DWG To PDF.pc3" "ISO full bleed A3 (420.00 x 297.00 MM)" "_Millimeters" "_Landscape" "_No" "_Extents" "_Fit" "_Center" "_Yes" "" "_Yes" "_Wireframe" "' + $lispOutput + '" "_No" "_Yes")'),
      '(command "_.QUIT" "_No")', ''
    )
    [IO.File]::WriteAllLines($scriptPath, $commands, [Text.Encoding]::ASCII)
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = $script:ConsolePath
    $info.Arguments = '/i "' + $inputPath + '" /s "' + $scriptPath + '" /l en-US'
    $info.WorkingDirectory = $folder
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $process = New-Object Diagnostics.Process
    $process.StartInfo = $info
    $null = $process.Start()
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    if (-not $process.WaitForExit(180000)) { $process.Kill(); throw 'AutoCAD conversion timed out. Check its license and PDF plotter configuration, then retry.' }
    $process.WaitForExit()
    if (-not (Test-Path -LiteralPath $outputPath)) { throw 'AutoCAD did not produce a PDF. Check that its license is active and DWG To PDF.pc3 is installed. Open the DWG in AutoCAD to check external references, fonts, model geometry and plot settings.' }
    $pdf = [IO.File]::ReadAllBytes($outputPath)
    if ($pdf.Length -lt 5 -or [Text.Encoding]::ASCII.GetString($pdf,0,5) -ne '%PDF-') { throw 'AutoCAD output was not a PDF.' }
    return ,$pdf
  } finally {
    $resolved = [IO.Path]::GetFullPath($folder)
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('LogEnCAD-')) {
      Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
    }
  }
}
function Write-Response($Stream, [int]$Status, [string]$Type, [byte[]]$Body, [string]$Origin) {
  $reason = switch ($Status) { 200 {'OK'} 204 {'No Content'} 400 {'Bad Request'} 403 {'Forbidden'} 404 {'Not Found'} 413 {'Payload Too Large'} default {'Conversion Failed'} }
  $headers = "HTTP/1.1 $Status $reason`r`nContent-Type: $Type`r`nContent-Length: $($Body.Length)`r`nConnection: close`r`nCache-Control: no-store`r`nX-Content-Type-Options: nosniff`r`n"
  if ($Origin -and $script:AllowedOrigins -contains $Origin) { $headers += "Access-Control-Allow-Origin: $Origin`r`nVary: Origin`r`nAccess-Control-Allow-Methods: POST, GET, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type, X-LogEn-Client`r`nAccess-Control-Allow-Private-Network: true`r`n" }
  $head = [Text.Encoding]::ASCII.GetBytes($headers + "`r`n")
  $Stream.Write($head,0,$head.Length)
  if ($Body.Length) { $Stream.Write($Body,0,$Body.Length) }
  $Stream.Flush()
}
# Binding exclusively to loopback needs no administrator URL reservation.
$listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { throw "Could not start LogEn on 127.0.0.1:$Port. Another helper may already be running." }
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream(); $stream.ReadTimeout = 30000; $stream.WriteTimeout = 30000
    $origin = ''
    try {
      $headerBytes = New-Object 'Collections.Generic.List[byte]'
      do {
        $byte = $stream.ReadByte(); if ($byte -lt 0) { throw 'Incomplete HTTP request.' }; $headerBytes.Add([byte]$byte)
        if ($headerBytes.Count -gt 16384) { throw 'HTTP headers too large.' }
        $n = $headerBytes.Count
      } until ($n -ge 4 -and $headerBytes[$n-4] -eq 13 -and $headerBytes[$n-3] -eq 10 -and $headerBytes[$n-2] -eq 13 -and $headerBytes[$n-1] -eq 10)
      $lines = [Text.Encoding]::ASCII.GetString($headerBytes.ToArray()) -split "`r`n"
      $request = $lines[0] -split ' '; $headers = @{}
      foreach ($line in $lines[1..($lines.Length-1)]) { $pair = $line -split ':',2; if ($pair.Length -eq 2) { $headers[$pair[0].Trim().ToLowerInvariant()] = $pair[1].Trim() } }
      $origin = $headers['origin']
      if ($headers['host'] -ne "127.0.0.1:$Port" -or ($origin -and $script:AllowedOrigins -notcontains $origin)) { Write-Response $stream 403 'text/plain' ([Text.Encoding]::UTF8.GetBytes('Origin not permitted.')) ''; continue }
      if ($request[0] -eq 'OPTIONS') { Write-Response $stream 204 'text/plain' ([byte[]]@()) $origin; continue }
      if ($request[0] -eq 'GET' -and $request[1] -eq '/health') { $json = @{ service='LogEn AutoCAD helper'; version=3; autoCADAvailable=([bool]($script:ConsolePath -and (Test-Path -LiteralPath $script:ConsolePath))) } | ConvertTo-Json -Compress; Write-Response $stream 200 'application/json' ([Text.Encoding]::UTF8.GetBytes($json)) $origin; continue }
      if ($request[0] -ne 'POST' -or $request[1] -notin @('/convert','/geometry','/layout')) { Write-Response $stream 404 'text/plain' ([byte[]]@()) $origin; continue }
      if (-not $origin -or $headers['x-logen-client'] -ne 'dwg-converter' -or $headers.ContainsKey('transfer-encoding')) { Write-Response $stream 403 'text/plain' ([byte[]]@()) $origin; continue }
      [long]$length = 0
      if (-not [long]::TryParse($headers['content-length'], [ref]$length) -or $length -lt 6 -or $length -gt $(if($request[1] -eq '/layout'){157286400}else{104857600})) { Write-Response $stream 413 'text/plain' ([Text.Encoding]::UTF8.GetBytes('DWG must be 6 bytes to 100 MB.')) $origin; continue }
      $data = New-Object byte[] ([int]$length); $read = 0
      while ($read -lt $length) { $count = $stream.Read($data,$read,[int]($length-$read)); if ($count -eq 0) { throw 'Incomplete DWG upload.' }; $read += $count }
      if($request[1] -eq '/layout'){
        $plan=[Text.Encoding]::UTF8.GetString($data)|ConvertFrom-Json
        $drawing=[Convert]::FromBase64String($plan.dwg)
        if($drawing.Length -gt 104857600 -or [Text.Encoding]::ASCII.GetString($drawing,0,6) -notmatch '^AC\d{4}$'){throw 'Invalid original DWG.'}
        $result=Invoke-LogEnLayoutJob $drawing 'layout' $plan
        Write-Response $stream 200 'application/json' ([Text.Encoding]::UTF8.GetBytes(($result|ConvertTo-Json -Depth 100 -Compress))) $origin
      }else{
        if ([Text.Encoding]::ASCII.GetString($data,0,6) -notmatch '^AC\d{4}$') { throw 'The upload is not a recognized DWG file.' }
        if($request[1] -eq '/geometry'){$result=Invoke-LogEnLayoutJob $data 'geometry';Write-Response $stream 200 'application/json' ([Text.Encoding]::UTF8.GetBytes(($result|ConvertTo-Json -Depth 100 -Compress))) $origin}
        else{$pdf=Convert-LogEnDrawing $data;Write-Response $stream 200 'application/pdf' $pdf $origin}
      }
    } catch {
      try { $errorBody = @{error=$_.Exception.Message} | ConvertTo-Json -Compress; Write-Response $stream 500 'application/json' ([Text.Encoding]::UTF8.GetBytes($errorBody)) $origin } catch {}
    } finally { $stream.Dispose(); $client.Dispose() }
  }
} finally { $listener.Stop() }
