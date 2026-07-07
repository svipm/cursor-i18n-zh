Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Cli = Join-Path $Root 'src\cli.js'

function Quote-Arg([string]$Value) {
  return '"' + ($Value -replace '"', '\"') + '"'
}

function Stop-Cursor {
  Start-Process -FilePath 'taskkill.exe' -ArgumentList '/IM Cursor.exe /F /T' -WindowStyle Hidden -Wait -ErrorAction SilentlyContinue | Out-Null
}

function Invoke-Cli([string[]]$Args) {
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'node.exe'
  $quoted = @((Quote-Arg $Cli)) + $Args
  $psi.Arguments = ($quoted -join ' ')
  $psi.WorkingDirectory = $Root
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $psi.StandardErrorEncoding = [System.Text.Encoding]::UTF8

  $process = [System.Diagnostics.Process]::Start($psi)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  return [PSCustomObject]@{ Code = $process.ExitCode; Output = ($stdout + $stderr) }
}

function Add-Log([string]$Text) {
  $log.AppendText($Text + [Environment]::NewLine)
  $log.SelectionStart = $log.TextLength
  $log.ScrollToCaret()
  [System.Windows.Forms.Application]::DoEvents()
}

function Set-Buttons([bool]$Enabled) {
  foreach ($button in $buttons) { $button.Enabled = $Enabled }
}

function Run-Action([string]$Name, [scriptblock]$Action) {
  Set-Buttons $false
  Add-Log ""
  Add-Log "== $Name =="
  try {
    & $Action
    Add-Log "完成."
  } catch {
    Add-Log ("[错误] " + $_.Exception.Message)
  } finally {
    Set-Buttons $true
  }
}

function Run-CliAction([string]$Name, [string[]]$Args) {
  Run-Action $Name {
    $result = Invoke-Cli $Args
    Add-Log $result.Output.TrimEnd()
    if ($result.Code -ne 0) { throw "命令失败: node src/cli.js $($Args -join ' ')" }
  }
}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Cursor 汉化助手'
$form.Size = New-Object System.Drawing.Size(860, 560)
$form.StartPosition = 'CenterScreen'
$form.MinimumSize = New-Object System.Drawing.Size(760, 460)

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Cursor 汉化助手'
$title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 15, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(16, 14)
$title.Size = New-Object System.Drawing.Size(360, 30)
$form.Controls.Add($title)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = '支持一键检查, 安装汉化, 恢复原版. 安装和恢复会先关闭 Cursor.'
$hint.Location = New-Object System.Drawing.Point(18, 50)
$hint.Size = New-Object System.Drawing.Size(720, 22)
$form.Controls.Add($hint)

$panel = New-Object System.Windows.Forms.FlowLayoutPanel
$panel.Location = New-Object System.Drawing.Point(16, 82)
$panel.Size = New-Object System.Drawing.Size(810, 44)
$panel.Anchor = 'Top,Left,Right'
$form.Controls.Add($panel)

$buttons = New-Object System.Collections.Generic.List[System.Windows.Forms.Button]
function New-Button([string]$Text) {
  $button = New-Object System.Windows.Forms.Button
  $button.Text = $Text
  $button.Size = New-Object System.Drawing.Size(130, 34)
  $button.Margin = New-Object System.Windows.Forms.Padding(0, 0, 10, 0)
  $button.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
  $buttons.Add($button)
  $panel.Controls.Add($button)
  return $button
}

$statusButton = New-Button '查看状态'
$checkButton = New-Button '安全检查'
$installButton = New-Button '一键安装'
$restoreButton = New-Button '一键恢复'
$scanButton = New-Button '扫描残留'

$log = New-Object System.Windows.Forms.TextBox
$log.Location = New-Object System.Drawing.Point(16, 136)
$log.Size = New-Object System.Drawing.Size(810, 368)
$log.Anchor = 'Top,Bottom,Left,Right'
$log.Multiline = $true
$log.ScrollBars = 'Both'
$log.WordWrap = $false
$log.ReadOnly = $true
$log.Font = New-Object System.Drawing.Font('Consolas', 10)
$form.Controls.Add($log)

$statusButton.Add_Click({ Run-CliAction '查看状态' @('status') })
$checkButton.Add_Click({ Run-CliAction '安全检查' @('check') })
$scanButton.Add_Click({ Run-CliAction '扫描残留' @('scan') })
$installButton.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show('即将关闭 Cursor, 安装官方中文语言包并应用汉化补丁. 是否继续?', '确认安装', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { return }
  Run-Action '一键安装' {
    Stop-Cursor
    foreach ($args in @(@('check'), @('lang'), @('apply'))) {
      $result = Invoke-Cli $args
      Add-Log $result.Output.TrimEnd()
      if ($result.Code -ne 0) { throw "命令失败: node src/cli.js $($args -join ' ')" }
    }
  }
})
$restoreButton.Add_Click({
  $answer = [System.Windows.Forms.MessageBox]::Show('即将关闭 Cursor, 并使用本项目备份恢复原版文件. 是否继续?', '确认恢复', 'YesNo', 'Question')
  if ($answer -ne 'Yes') { return }
  Run-Action '一键恢复' {
    Stop-Cursor
    $result = Invoke-Cli @('restore')
    Add-Log $result.Output.TrimEnd()
    if ($result.Code -ne 0) { throw '恢复失败' }
  }
})

Add-Log "项目目录: $Root"
Add-Log '点击 查看状态 或 安全检查 开始.'
[void]$form.ShowDialog()
