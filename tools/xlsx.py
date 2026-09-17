"""Minimal read-only xlsx reader: zipfile + ElementTree, no dependencies."""
import zipfile, re
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}

def _col(ref):
    m = re.match(r'([A-Z]+)', ref or '')
    if not m: return 0
    n = 0
    for ch in m.group(1): n = n * 26 + (ord(ch) - 64)
    return n - 1

def load(path):
    z = zipfile.ZipFile(path)
    shared = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            shared.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    wb = ET.fromstring(z.read('xl/workbook.xml'))
    rels = {rel.get('Id'): rel.get('Target')
            for rel in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    out = []
    for sh in wb.find('m:sheets', NS):
        name = sh.get('name')
        tgt = rels[sh.get('{%s}id' % NS['r'])].lstrip('/')
        if not tgt.startswith('xl/'): tgt = 'xl/' + tgt
        rows = []
        for row in ET.fromstring(z.read(tgt)).iter('{%s}row' % NS['m']):
            cells = {}
            for c in row.findall('m:c', NS):
                t, i = c.get('t'), _col(c.get('r'))
                v = c.find('m:v', NS)
                if t == 's':
                    cells[i] = shared[int(v.text)] if v is not None else ''
                elif t == 'inlineStr':
                    is_ = c.find('m:is', NS)
                    cells[i] = ''.join(x.text or '' for x in is_.iter('{%s}t' % NS['m'])) if is_ is not None else ''
                elif v is not None:
                    try:
                        f = float(v.text); cells[i] = int(f) if f == int(f) else f
                    except ValueError: cells[i] = v.text
            width = (max(cells) + 1) if cells else 0
            rows.append([cells.get(i, None) for i in range(width)])
        out.append((name, rows))
    return out
