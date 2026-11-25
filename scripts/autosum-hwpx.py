# HWPX(zip+XML) 에서 글자만 뽑는다. 사용: python -I autosum-hwpx.py <파일>
import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
# 암호화된(배포용) HWPX 는 section 이 암호문이라 글자가 아니다. 쓰레기 글자를 내보내지 않고 빈 결과로 둔다.
if 'META-INF/manifest.xml' in z.namelist() and b'encryption-data' in z.read('META-INF/manifest.xml'):
    sys.exit(0)
names = sorted(n for n in z.namelist() if re.match(r'Contents/section\d+\.xml$', n))
out = []
for n in names:
    x = z.read(n).decode('utf8', 'ignore')
    x = re.sub(r'</hp:p>', '\n', x)
    x = re.sub(r'<[^>]+>', '', x)
    out.append(x)
sys.stdout.reconfigure(encoding='utf8')
print('\n'.join(out))
