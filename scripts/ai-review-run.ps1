# AI 재검토 실행(매일 14:30 KST, my-scheduler 명령 작업이 호출). 새로 올라간 공고만 Haiku 가 원문을 보고 '내리는 쪽'으로만 판정한다.
# 사용: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\ai-review-run.ps1 [-DryRun] [-Max 15]
# -DryRun: 판정·출력만 하고 파일·커밋·푸시는 하지 않는다(시험용).
# 모델을 바꾸려면 아래 $ClaudeArgs 의 'haiku' 만 바꾼다. 출력 JSON 형식은 ai-review-prompt.md 에 맞춰 유지한다.
param([switch]$DryRun, [int]$Max = 15)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo
$claude = 'C:\Users\A\AppData\Roaming\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$resultFile = Join-Path $repo 'scripts\ai-review-result.json'
$bundleFile = Join-Path $repo 'scripts\ai-review-bundle.json'
$tracked = @('public/data/jobs.json', 'scripts/ai-review-log.json', 'scripts/ai-review-hide.json', 'scripts/review-queue.json')

Write-Output ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm') + '] AI 재검토 시작' + $(if ($DryRun) { ' (시험: 파일·커밋 없음)' } else { '' }))

& node scripts/ai-review-prep.mjs --max $Max
if ($LASTEXITCODE -ne 0) { Write-Output '묶음 만들기 실패. 아무것도 바꾸지 않음'; exit 1 }

$bundle = Get-Content $bundleFile -Raw -Encoding utf8 | ConvertFrom-Json
if ([int]$bundle.count -eq 0) { Write-Output '새로 올라간 공고 없음. 끝'; exit 0 }

if (Test-Path $resultFile) { Remove-Item $resultFile -Force }
$prompt = [IO.File]::ReadAllText((Join-Path $repo 'scripts\ai-review-prompt.md'), $utf8)
$prompt += "`n검토 묶음 파일: $bundleFile`n"
$ClaudeArgs = @('-p', '--model', 'haiku', '--allowedTools', 'Read', 'WebFetch')
$prevEAP = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$out = $prompt | & $claude @ClaudeArgs 2>$null
$ErrorActionPreference = $prevEAP
$text = ($out | Out-String)
[IO.File]::WriteAllText($resultFile, $text, $utf8)

$applyArgs = @('scripts/ai-review-apply.mjs')
if ($DryRun) { $applyArgs += '--dry-run' }
& node @applyArgs
if ($LASTEXITCODE -ne 0) { Write-Output '판정 적용 실패(결과 깨짐). 아무것도 바꾸지 않음'; exit 1 }
if ($DryRun) { Write-Output '시험 끝(파일·커밋·푸시 없음)'; exit 0 }

$changed = & git status --porcelain -- $tracked
if (-not $changed) { Write-Output '바뀐 것 없음. 끝'; exit 0 }

& node --test scripts/
if ($LASTEXITCODE -ne 0) { & git checkout -- $tracked; Write-Output '테스트 실패: 되돌림, 커밋 안 함'; exit 1 }
& npm run build
if ($LASTEXITCODE -ne 0) { & git checkout -- $tracked; Write-Output '빌드 실패: 되돌림, 커밋 안 함'; exit 1 }

& git add -- $tracked
$msg = "data: AI 재검토(Haiku) 결과 반영`n`nCo-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>"
& git -c user.name=modupum-bot -c user.email=modupum-bot@users.noreply.github.com commit -m $msg
if ($LASTEXITCODE -ne 0) { & git reset -q -- $tracked; Write-Output '커밋 실패. 로그만 남김'; exit 1 }
& git pull --rebase origin main
if ($LASTEXITCODE -ne 0) { & git rebase --abort; Write-Output '최신 반영 실패(충돌). 이번엔 푸시 안 함'; exit 1 }
& git push
if ($LASTEXITCODE -ne 0) { Write-Output '푸시 실패. 로컬 커밋은 남아 있음'; exit 1 }
Write-Output 'AI 재검토 반영 푸시 완료'
