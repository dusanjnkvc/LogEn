param(
  [Parameter(Mandatory=$true)][string]$Drawing,
  [Parameter(Mandatory=$true)][string]$ResultPrefix,
  [switch]$EditGround,
  [string]$ConsolePath = 'C:\Program Files\Autodesk\AutoCAD 2021\accoreconsole.exe'
)
$ErrorActionPreference = 'Stop'
$drawingPath = [IO.Path]::GetFullPath($Drawing)
$prefixPath = [IO.Path]::GetFullPath($ResultPrefix)
$folder = [IO.Path]::GetDirectoryName($prefixPath)
[IO.Directory]::CreateDirectory($folder) | Out-Null
# Core Console may save its working drawing when exiting. Never open the caller's
# file directly, even for a read-only validation.
$workingPath = Join-Path $folder ('validation-' + [Guid]::NewGuid().ToString('N') + '.dwg')
[IO.File]::Copy($drawingPath, $workingPath, $false)
$inputHash = (Get-FileHash -LiteralPath $drawingPath -Algorithm SHA256).Hash.ToLowerInvariant()
$jsonPath = $prefixPath + '.json'
$scriptPath = $prefixPath + '.scr'
function LispPath([string]$Path) { '"' + $Path.Replace('\','/').Replace('"','\"') + '"' }
$forms = @'
(defun p:num (n) (if (numberp n) (rtos n 2 8) "null"))
(defun p:q (s) (vl-prin1-to-string (if s s "")))
(defun p:point (p) (strcat "[" (p:num (car p)) "," (p:num (cadr p)) "," (p:num (if (caddr p) (caddr p) 0)) "]"))
(defun p:dump (path / f ss i d typ first pair pts block) (setq f (open path "w") ss (ssget "_X" '((410 . "Model"))) i 0 first T) (write-line (strcat "{\"units\":" (itoa (getvar "INSUNITS")) ",\"entities\":[") f) (if ss (repeat (sslength ss) (setq d (entget (ssname ss i)) typ (cdr (assoc 0 d)) i (1+ i)) (if (not first) (write-line "," f)) (setq first nil) (princ (strcat "{\"type\":" (p:q typ) ",\"handle\":" (p:q (cdr (assoc 5 d))) ",\"layer\":" (p:q (cdr (assoc 8 d))) ",\"points\":[") f) (setq pts nil) (foreach pair d (if (member (car pair) '(10 11 12 13 14 15 16)) (progn (if pts (princ "," f)) (princ (strcat "{\"code\":" (itoa (car pair)) ",\"point\":" (p:point (cdr pair)) "}") f) (setq pts T)))) (princ (strcat "],\"text\":" (p:q (cdr (assoc 1 d))) ",\"block\":" (p:q (cdr (assoc 2 d))) ",\"radius\":" (p:num (cdr (assoc 40 d))) ",\"measurement\":" (p:num (cdr (assoc 42 d))) ",\"flags\":" (p:num (cdr (assoc 70 d))) "}") f))) (write-line "]}" f) (close f) (princ "POC_GEOMETRY_DUMP_OK"))
'@
$commands = New-Object 'Collections.Generic.List[string]'
foreach ($command in @('(setvar "FILEDIA" 0)','(setvar "CMDDIA" 0)','(setvar "SECURELOAD" 2)','(setvar "TILEMODE" 1)','(setvar "LUNITS" 2)','(setvar "LUPREC" 8)','_.AUDIT','_No')) { $commands.Add($command) }
foreach ($form in ($forms -split '[\r\n]+' | Where-Object { $_ })) { $commands.Add($form) }
if ($EditGround) {
  $commands.Add('(entmakex ''((0 . "LAYER") (100 . "AcDbSymbolTableRecord") (100 . "AcDbLayerTableRecord") (2 . "POC_GROUND_EDITED") (70 . 0) (62 . 3)))')
  $commands.Add('(setq p:ss (ssget "_X" ''((8 . "POC_GROUND"))))')
  $commands.Add('(if p:ss (progn (setq p:e (ssname p:ss 0) p:d (entget p:e)) (entmod (subst (cons 8 "POC_GROUND_EDITED") (assoc 8 p:d) p:d)) (princ "POC_EDIT_OK")) (princ "POC_EDIT_MISSING"))')
  $commands.Add('_.QSAVE')
}
$commands.Add('(p:dump ' + (LispPath $jsonPath) + ')')
$commands.Add('_.QUIT')
$commands.Add('_Yes')
[IO.File]::WriteAllLines($scriptPath, $commands, [Text.Encoding]::ASCII)
$info = New-Object Diagnostics.ProcessStartInfo
$info.FileName = $ConsolePath
$info.Arguments = '/i "' + $workingPath + '" /s "' + $scriptPath + '" /l en-US'
$info.WorkingDirectory = $folder
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$process = New-Object Diagnostics.Process
$process.StartInfo = $info
$null = $process.Start()
$stdout = $process.StandardOutput.ReadToEndAsync()
$stderr = $process.StandardError.ReadToEndAsync()
if (-not $process.WaitForExit(120000)) { $process.Kill(); throw 'AutoCAD validation timed out.' }
$process.WaitForExit()
$log = ($stdout.Result + "`n" + $stderr.Result) -replace "`0", ''
[IO.File]::WriteAllText($prefixPath + '.log', $log)
if (-not (Test-Path -LiteralPath $jsonPath)) { Write-Output $log; throw 'AutoCAD did not produce a geometry report.' }
if ((Get-FileHash -LiteralPath $drawingPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $inputHash) { throw 'Validation input was changed.' }
if ($EditGround) { [IO.File]::Copy($workingPath, $prefixPath + '-edited.dwg', $true) }
[IO.File]::WriteAllText($prefixPath + '-input.sha256', $inputHash)
$result = Get-Content -Raw -LiteralPath $jsonPath | ConvertFrom-Json
Write-Output ('AutoCAD exit: ' + $process.ExitCode + '; units: ' + $result.units + '; model entities: ' + @($result.entities).Count)
Write-Output (($log -split '[\r\n]+' | Where-Object { $_ -match 'error|fixed|POC_|Unable|invalid|recover' }) -join "`n")
