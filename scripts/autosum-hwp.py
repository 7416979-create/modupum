# HWP5 에서 표 안 글자까지 뽑는다(hwp5html → 글자). 실패하면 hwp5txt(표 제외)로 대신한다.
# 사용: <venv>\python autosum-hwp.py <파일>   (일반 python -I 은 venv 패키지를 못 찾으므로 venv 의 python 으로 실행)
import sys, os, re, subprocess, tempfile, html
sys.stdout.reconfigure(encoding='utf8')
f = sys.argv[1]
scripts = os.path.dirname(sys.executable)
env = dict(os.environ, PYTHONUTF8='1')
try:
    d = tempfile.mkdtemp(prefix='hwp_')
    out = os.path.join(d, 'o')
    subprocess.run([os.path.join(scripts, 'hwp5html.exe'), '--output', out, f], check=True, capture_output=True, timeout=100, env=env)
    x = open(os.path.join(out, 'index.xhtml'), encoding='utf8').read()
    x = re.sub(r'<style[\s\S]*?</style>', '', x)
    x = re.sub(r'</(p|tr|div|h\d|li)>|<br\s*/?>', '\n', x)
    x = re.sub(r'</t[dh]>', ' | ', x)
    x = html.unescape(re.sub(r'<[^>]+>', '', x))
    x = '\n'.join(re.sub(r'[ \t ]+', ' ', l).strip() for l in x.split('\n'))
    x = re.sub(r'\n{3,}', '\n\n', x)
    if len(x.strip()) < 50:
        raise RuntimeError('too short')
    print(x)
except Exception:
    r = subprocess.run([os.path.join(scripts, 'hwp5txt.exe'), f], capture_output=True, timeout=100, env=env)
    sys.stdout.write(r.stdout.decode('utf8', 'ignore'))
