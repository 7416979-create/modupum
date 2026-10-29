# HWPX(zip+XML) 에서 글자만 뽑는다. 사용: python -I autosum-hwpx.py <파일>
import sys, zipfile, re
z = zipfile.ZipFile(sys.argv[1])
names = sorted(n for n in z.namelist() if re.match(r'Contents/section\d+\.xml$', n))
out = []
for n in names:
    x = z.read(n).decode('utf8', 'ignore')
    x = re.sub(r'</hp:p>', '\n', x)
    x = re.sub(r'<[^>]+>', '', x)
    out.append(x)
sys.stdout.reconfigure(encoding='utf8')
print('\n'.join(out))
