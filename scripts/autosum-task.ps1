# 요약 자동 채우기 PC 작업 등록(Windows 작업 스케줄러). 한 번만 실행: powershell -ExecutionPolicy Bypass -File scripts\autosum-task.ps1
# 실행 시각(KST): 10:40, 14:40, 18:40 (Actions 수집은 약 09:47, 13:47, 17:47 에 시작해 몇 분 걸림)
# PC 가 꺼져 있었으면 켜지는 즉시(StartWhenAvailable) 또는 로그인 5분 뒤에 밀린 것을 처리한다. 비밀값은 쓰지 않는다.
$home1 = 'C:\Users\A\modupum-autosum'
$repo = Join-Path $home1 'repo'
$cmd = "Set-Location '$repo'; node scripts\autosum-run.mjs *>> '$home1\task.log'"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command `"$cmd`""
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At '10:40'),
  (New-ScheduledTaskTrigger -Daily -At '14:40'),
  (New-ScheduledTaskTrigger -Daily -At '18:40'),
  (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME)
)
$triggers[3].Delay = 'PT5M'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
Register-ScheduledTask -TaskName 'modupum-autosum' -Action $action -Trigger $triggers -Settings $settings -Description '모두품 공고 요약 자동 채우기(원문 추출, haiku 요약, 검증, 푸시)' -Force | Out-Null
Get-ScheduledTask -TaskName 'modupum-autosum' | Select-Object TaskName, State
