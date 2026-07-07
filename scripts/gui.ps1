Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$Root = Resolve-Path (Join-Path $PSScriptRoot '..')
$Cli = Join-Path $Root 'src\cli.js'
$AgreementText = '我已仔细阅读上述规则并同意继续使用'

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
$hint.Text = '请先阅读声明并输入同意文字. 安装和恢复会先关闭 Cursor.'
$hint.Location = New-Object System.Drawing.Point(18, 50)
$hint.Size = New-Object System.Drawing.Size(720, 22)
$form.Controls.Add($hint)

$notice = New-Object System.Windows.Forms.TextBox
$notice.Location = New-Object System.Drawing.Point(16, 82)
$notice.Size = New-Object System.Drawing.Size(810, 160)
$notice.Anchor = 'Top,Left,Right'
$notice.Multiline = $true
$notice.ScrollBars = 'Vertical'
$notice.ReadOnly = $true
$notice.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)
$notice.Text = @"
1. 本软件仅供学习, 研究和个人本地化测试使用.
2. 本软件不是 Cursor 官方项目, 与 Cursor 官方无从属或授权关系.
3. 使用本软件前, 请确认你有权在自己的电脑上修改本机软件文件.
4. 安装汉化会修改本机 Cursor 安装目录中的前端资源文件.
5. 首次安装会按 Cursor 版本自动备份原文件, 可通过菜单恢复默认.
6. 安装和恢复会先尝试关闭 Cursor.exe, 请提前保存未完成工作.
7. Cursor 升级后可能需要重新安装汉化, 也可能出现部分英文残留.
8. 本软件不收集个人数据, 不上传文件, 不下载或执行远程脚本.
9. 因使用本软件造成的兼容性问题, 文件损坏或其他风险, 由使用者自行承担.
"@
$form.Controls.Add($notice)

$agreeLabel = New-Object System.Windows.Forms.Label
$agreeLabel.Text = "请输入: $AgreementText"
$agreeLabel.Location = New-Object System.Drawing.Point(18, 252)
$agreeLabel.Size = New-Object System.Drawing.Size(620, 22)
$form.Controls.Add($agreeLabel)

$agreeBox = New-Object System.Windows.Forms.TextBox
$agreeBox.Location = New-Object System.Drawing.Point(16, 276)
$agreeBox.Size = New-Object System.Drawing.Size(650, 26)
$agreeBox.Anchor = 'Top,Left,Right'
$form.Controls.Add($agreeBox)

$panel = New-Object System.Windows.Forms.FlowLayoutPanel
$panel.Location = New-Object System.Drawing.Point(16, 314)
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

$installButton = New-Button '一键安装'
$restoreButton = New-Button '还原默认'

$log = New-Object System.Windows.Forms.TextBox
$log.Location = New-Object System.Drawing.Point(16, 368)
$log.Size = New-Object System.Drawing.Size(810, 136)
$log.Anchor = 'Top,Bottom,Left,Right'
$log.Multiline = $true
$log.ScrollBars = 'Both'
$log.WordWrap = $false
$log.ReadOnly = $true
$log.Font = New-Object System.Drawing.Font('Consolas', 10)
$form.Controls.Add($log)

function Test-Agreement {
  if ($agreeBox.Text.Trim() -eq $AgreementText) { return $true }
  [System.Windows.Forms.MessageBox]::Show('请先完整输入同意文字.', '无法继续', 'OK', 'Warning') | Out-Null
  return $false
}

$installButton.Add_Click({
  if (!(Test-Agreement)) { return }
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
  if (!(Test-Agreement)) { return }
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
