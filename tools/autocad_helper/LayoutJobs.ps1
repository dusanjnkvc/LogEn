function ConvertTo-LogEnLispString([string]$Value) {
  $escaped = $Value.Replace('\','\\').Replace('"','\"').Replace("`r",' ').Replace("`n",' ')
  $builder = New-Object Text.StringBuilder
  foreach ($char in $escaped.ToCharArray()) { if ([int]$char -gt 126) { $null=$builder.Append(('\\U+{0:X4}' -f [int]$char)) } else { $null=$builder.Append($char) } }
  return '"'+$builder.ToString()+'"'
}
function Get-LogEnLispForms {
  $code = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'LayoutGeometry.lsp'))
  $forms = New-Object 'Collections.Generic.List[string]'; $depth=0; $quoted=$false; $escaped=$false; $start=0
  for ($i=0;$i -lt $code.Length;$i++) {
    $char=$code[$i]
    if ($quoted) { if ($escaped) {$escaped=$false} elseif ($char -eq '\') {$escaped=$true} elseif ($char -eq '"') {$quoted=$false}; continue }
    if ($char -eq '"') {$quoted=$true;continue}
    if ($char -eq '(') {if ($depth -eq 0) {$start=$i};$depth++}
    if ($char -eq ')') {$depth--;if ($depth -eq 0) {$form=($code.Substring($start,$i-$start+1) -replace '[\r\n]+',' ');if($form.Length -gt 2000){throw 'A bundled CAD definition exceeds the console command limit.'};$forms.Add($form)}}
  }
  if ($depth -ne 0 -or $quoted) {throw 'Invalid bundled CAD definitions.'}
  return $forms.ToArray()
}
function Invoke-LogEnLayoutJob([byte[]]$Drawing, [string]$Mode, $Plan=$null) {
  if (-not $script:ConsolePath -or -not (Test-Path -LiteralPath $script:ConsolePath)) { throw 'AutoCAD Core Console was not found.' }
  $tempRoot=[IO.Path]::GetFullPath([IO.Path]::GetTempPath());$folder=Join-Path $tempRoot ('LogEnCAD-'+[Guid]::NewGuid().ToString('N'));[IO.Directory]::CreateDirectory($folder)|Out-Null
  try {
    $isDwg=[Text.Encoding]::ASCII.GetString($Drawing,0,[Math]::Min(6,$Drawing.Length)) -match '^AC[0-9]{4}$';$inputPath=Join-Path $folder $(if($isDwg){'warehouse.dwg'}else{'warehouse.dxf'});$resultPath=Join-Path $folder 'result.json';$pdfPath=Join-Path $folder 'warehouse.pdf';$scriptPath=Join-Path $folder 'layout.scr'
    [IO.File]::WriteAllBytes($inputPath,$Drawing)
    $outputPath=if($isDwg){$inputPath}else{Join-Path $folder 'layout.dwg'}
    $openPath=$inputPath
    if(-not $isDwg){$openPath=Join-Path $folder 'bootstrap.dwg';[IO.File]::Copy((Join-Path $PSScriptRoot 'LogEn-Empty.dwg'),$openPath)}
    $commands=New-Object 'Collections.Generic.List[string]'
    foreach($line in @('(setvar "FILEDIA" 0)','(setvar "CMDDIA" 0)','(setvar "BACKGROUNDPLOT" 0)','(setvar "SECURELOAD" 2)','(setvar "TILEMODE" 1)')){$commands.Add($line)}
    if(-not $isDwg){$commands.Add('(command "_.DXFIN" '+(ConvertTo-LogEnLispString $inputPath.Replace('\','/'))+')')}
    if(-not $isDwg){
      $header=[Text.Encoding]::ASCII.GetString($Drawing,0,[Math]::Min($Drawing.Length,1048576));$unitMatch=[regex]::Match($header,'(?m)^\s*9\r?\n\s*\$INSUNITS\r?\n\s*70\r?\n\s*(\d+)');$unit=if($unitMatch.Success){[int]$unitMatch.Groups[1].Value}else{0}
      if($Mode -notin @('geometry','geometry-existing')){foreach($pair in @(@(1,4),@(10,5),@(1000,6),@(25.4,1),@(304.8,2))){if([Math]::Abs([double]$Plan.scale-$pair[0])-lt .000001){$unit=$pair[1];break}}}
      if($unit -ge 0 -and $unit -le 24){$commands.Add('(setvar "INSUNITS" '+$unit+')')}
    }
    foreach($form in Get-LogEnLispForms){$commands.Add($form)}
    if($Mode -in @('geometry','geometry-existing')) {if($Mode -eq 'geometry-existing'){$commands.Add('(setq lg:includeGenerated T)')};$commands.Add('(lg:extract '+(ConvertTo-LogEnLispString $resultPath.Replace('\','/'))+')')}
    else {
      $scale=[double]$Plan.scale
      if ([double]::IsNaN($scale) -or [double]::IsInfinity($scale) -or $scale -le 0 -or $scale -gt 1000000) {throw 'Invalid drawing units.'}
      if (@($Plan.objects).Count -gt 10000 -or @($Plan.aisles).Count -gt 10000 -or @($Plan.clearances).Count -gt 10000 -or @($Plan.markings).Count -gt 60000) {throw 'Generated layout exceeds 10,000 objects or access strips.'}
      if($Plan.version -ge 6){$commands.Add('(setq lg:existing-output T)')};$commands.Add('(lg:init)');$commands.Add('(setq lg:entitycount 0)');$expected=0
      $shapes=(@($Plan.objects)+@($Plan.aisles)+@($Plan.clearances)+@($Plan.markings))|Where-Object {$null -ne $_}
      foreach($shape in $shapes) {
        foreach($key in @('x','y','w','h')) { $n=[double]$shape.$key;if([double]::IsNaN($n)-or[double]::IsInfinity($n)-or[Math]::Abs($n)-gt 1e12){throw 'Non-finite CAD coordinates.'} }
        if($shape.w -le 0 -or $shape.h -le 0){throw 'Invalid generated object dimensions.'}
        if($shape.kind -notin @('rack','ground','aisle','clearance','marking','annotation')){throw 'Unknown layout object type.'}
        if([string]$shape.id -eq '' -or ([string]$shape.id).Length -gt 240){throw 'Invalid layout object identity.'}
        $layer=switch($shape.kind){rack{'LOGEN_RACKS'}ground{'LOGEN_GROUND_STORAGE'}aisle{'LOGEN_GANGWAYS'}clearance{'LOGEN_CLEARANCES'}marking{'LOGEN_GROUND_MARKINGS'}annotation{'LOGEN_EXISTING_OCCUPANCY'}}
        if($Plan.version -ge 6 -and $shape.kind -eq 'rack'){$layer='LOGEN_NEW_RACKS'}
        if($Plan.version -ge 6 -and $shape.kind -eq 'ground'){$layer='LOGEN_NEW_GROUND_STORAGE'}
        $id=ConvertTo-LogEnLispString ([string]$shape.id);$x=[double]$shape.x/$scale;$y=[double]$shape.y/$scale;$w=[double]$shape.w/$scale;$h=[double]$shape.h/$scale
        $numbers=@($x,$y,$w,$h)|ForEach-Object {$_.ToString('R',[Globalization.CultureInfo]::InvariantCulture)}
        if($shape.kind -eq 'annotation'){
          $labels=@(([string]$shape.label) -split '; ');$maximum=($labels|ForEach-Object {$_.Length}|Measure-Object -Maximum).Maximum
          $textHeight=[Math]::Min($h/([Math]::Max(1,$labels.Count)+2),$w/($maximum*0.7+3));$cx=[double]$shape.center[0]/$scale;$cy=[double]$shape.center[1]/$scale;$angle=[double]$shape.drawAngle*[Math]::PI/180
          for($j=0;$j -lt $labels.Count;$j++){$delta=(($labels.Count-1)/2-$j)*$textHeight*1.2;$nums=@(($cx-[Math]::Sin($angle)*$delta),($cy+[Math]::Cos($angle)*$delta),$textHeight,$angle)|ForEach-Object {$_.ToString('R',[Globalization.CultureInfo]::InvariantCulture)};$commands.Add('(lg:textrot '+$id+' "LOGEN_EXISTING_OCCUPANCY" '+($nums -join ' ')+' '+(ConvertTo-LogEnLispString $labels[$j])+')');$expected++}
          continue
        }
        if($shape.kind -eq 'marking'){
          if(@($shape.points).Count -ne 2){throw 'Ground marking needs two endpoints.'}
          $coordinates=foreach($point in $shape.points){if(@($point).Count -ne 2){throw 'Invalid marking point.'};foreach($value in $point){$v=[double]$value;if([double]::IsNaN($v)-or[double]::IsInfinity($v)-or[Math]::Abs($v)-gt 1e12){throw 'Invalid marking coordinate.'};($v/$scale).ToString('R',[Globalization.CultureInfo]::InvariantCulture)}}
          $commands.Add('(lg:markline '+$id+' "LOGEN_GROUND_MARKINGS" '+($coordinates -join ' ')+')')
        }elseif(@($shape.points).Count -ge 3){
          if(@($shape.points).Count -gt 20000){throw 'Polygon vertex limit exceeded.'}
          $poly=foreach($point in $shape.points){foreach($value in $point){if([double]::IsNaN([double]$value)-or[double]::IsInfinity([double]$value)-or[Math]::Abs([double]$value)-gt 1e12){throw 'Invalid polygon coordinate.'}};'('+(([double]$point[0]/$scale).ToString('R',[Globalization.CultureInfo]::InvariantCulture))+' '+(([double]$point[1]/$scale).ToString('R',[Globalization.CultureInfo]::InvariantCulture))+')'}
          $commands.Add("(lg:polygon "+$id+' "'+$layer+'" '+"'("+($poly -join ' ')+'))')
        }else{$commands.Add('(lg:rect '+$id+' "'+$layer+'" '+($numbers -join ' ')+')')};$expected++
        if($shape.kind -eq 'rack') {
          # Clean rack frame with structural divisions; no text labels inside racks.
          if(@($shape.frameLines).Count -gt 0){foreach($line in $shape.frameLines){$nums=@(([double]$line[0][0]/$scale),([double]$line[0][1]/$scale),([double]$line[1][0]/$scale),([double]$line[1][1]/$scale))|ForEach-Object {$_.ToString('R',[Globalization.CultureInfo]::InvariantCulture)};$commands.Add('(lg:line '+$id+' "LOGEN_RACKS" '+($nums -join ' ')+')');$expected++}}else{
          $structural=[double]$shape.structuralLength/2.0/$scale
          if([double]::IsNaN($structural)-or[double]::IsInfinity($structural)-or$structural-lt 0){throw 'Invalid rack structure.'}
          foreach($offset in @($structural,$(if(([int]$shape.rotation % 180)-eq 0){$w-$structural}else{$h-$structural}))){
            if(([int]$shape.rotation % 180) -eq 0){$a=@(($x+$offset),$y,($x+$offset),($y+$h))}else{$a=@($x,($y+$offset),($x+$w),($y+$offset))}
            $nums=$a|ForEach-Object {$_.ToString('R',[Globalization.CultureInfo]::InvariantCulture)}
            $commands.Add('(lg:line '+$id+' "LOGEN_RACKS" '+($nums -join ' ')+')');$expected++
          }
        }
        }
        if($shape.kind -eq 'ground') {
          $labels=@(('PN: '+[string]$shape.pn),('Size: '+[string]$shape.length+' x '+[string]$shape.width+' x '+[string]$shape.height+' mm'),('QTY: '+[string]$shape.quantity),('Stacking: '+[string]$shape.stacking))
          $max=($labels|ForEach-Object {$_.Length}|Measure-Object -Maximum).Maximum
          $textHeight=[Math]::Min($h/7.0,$w/($max*0.7+3));$cx=$x+$w/2.0;$cy=$y+$h/2.0;$angle=0.0
          if(@($shape.center).Count -eq 2){$cx=[double]$shape.center[0]/$scale;$cy=[double]$shape.center[1]/$scale;$angle=[double]$shape.drawAngle*[Math]::PI/180.0}
          for($i=0;$i -lt 4;$i++){
            $delta=(1.5-$i)*$textHeight*1.4
            $nums=@(($cx-[Math]::Sin($angle)*$delta),($cy+[Math]::Cos($angle)*$delta),$textHeight,$angle)|ForEach-Object {$_.ToString('R',[Globalization.CultureInfo]::InvariantCulture)}
            $commands.Add('(lg:textrot '+$id+' "LOGEN_LAYOUT_LABELS" '+($nums -join ' ')+' '+(ConvertTo-LogEnLispString $labels[$i])+')');$expected++
          }
        }
      }
      $resultFile=ConvertTo-LogEnLispString $resultPath.Replace('\','/')
      $commands.Add('(setq lg:status (open '+$resultFile+' "w"))')
      $commands.Add('(write-line (strcat "{\"created\":" (itoa lg:entitycount) "}") lg:status)')
      $commands.Add('(close lg:status)')
      $commands.Add($(if($isDwg){'(command "_.QSAVE")'}else{'(command "_.SAVEAS" "2018" '+(ConvertTo-LogEnLispString $outputPath.Replace('\','/'))+')'}))
      $commands.Add('(command "_.UCS" "_World")');$commands.Add('(command "_.PLAN" "_World")');$commands.Add('(command "_.ZOOM" "_Extents")')
      $commands.Add('(command "_.-PLOT" "_Yes" "Model" "DWG To PDF.pc3" "ISO full bleed A3 (420.00 x 297.00 MM)" "_Millimeters" "_Landscape" "_No" "_Extents" "_Fit" "_Center" "_Yes" "" "_Yes" "_Wireframe" '+(ConvertTo-LogEnLispString $pdfPath.Replace('\','/'))+' "_No" "_Yes")')
    }
    $commands.Add('(command "_.QUIT" "_No")');$commands.Add('')
    [IO.File]::WriteAllLines($scriptPath,$commands,[Text.Encoding]::ASCII)
    $info=New-Object Diagnostics.ProcessStartInfo;$info.FileName=$script:ConsolePath;$info.Arguments='/i "'+$openPath+'" /s "'+$scriptPath+'" /l en-US';$info.WorkingDirectory=$folder;$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
    $process=New-Object Diagnostics.Process;$process.StartInfo=$info;$null=$process.Start();$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
    if(-not $process.WaitForExit(180000)){$process.Kill();throw 'AutoCAD layout job timed out. Check its license and drawing.'};$process.WaitForExit()
    if($env:LOGEN_CAD_KEEP -eq '1'){[IO.File]::WriteAllText((Join-Path $folder 'console.txt'),$stdout.Result);Write-Host $folder}
    if(-not (Test-Path -LiteralPath $resultPath)){throw 'AutoCAD could not read or export the layout. Check the drawing and update/restart the helper.'}
    $result=[IO.File]::ReadAllText($resultPath,[Text.Encoding]::Default)|ConvertFrom-Json
    if($Mode -in @('geometry','geometry-existing')){return $result}
    if($result.created -ne $expected){throw "AutoCAD created $($result.created) of $expected entities. Export stopped to prevent an incomplete layout."}
    $output=@{dwg=[Convert]::ToBase64String([IO.File]::ReadAllBytes($outputPath));created=$result.created}
    if(Test-Path -LiteralPath $pdfPath){$pdf=[IO.File]::ReadAllBytes($pdfPath);if([Text.Encoding]::ASCII.GetString($pdf,0,5) -eq '%PDF-'){$output.pdf=[Convert]::ToBase64String($pdf)}}
    if(-not $output.pdf){$output.pdfError='DWG exported successfully, but AutoCAD could not plot the PDF. Check DWG To PDF.pc3.'}
    return $output
  } finally {
    $resolved=[IO.Path]::GetFullPath($folder)
    if($env:LOGEN_CAD_KEEP -ne '1' -and $resolved.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolved).StartsWith('LogEnCAD-')){Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue}
  }
}
