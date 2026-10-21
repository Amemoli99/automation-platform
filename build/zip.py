"""Crea lo zip da distribuire a partire da .tmp/dist (percorsi con "/", come richiesto dagli zip portabili).
Uso: python build/zip.py [cartella-dist] [file-zip]"""
import os
import sys
import zipfile

root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
src = os.path.abspath(sys.argv[1]) if len(sys.argv) > 1 else os.path.join(root, '.tmp', 'dist')
out = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else os.path.join(root, '.tmp', 'NexsoftAutomationCockpit.zip')
if os.path.exists(out):
    os.remove(out)
n = 0
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for d, _, files in os.walk(src):
        for f in files:
            if f.startswith('_bundle-'):  # file intermedi di controllo: non vanno distribuiti
                continue
            full = os.path.join(d, f)
            z.write(full, os.path.relpath(full, src).replace(os.sep, '/'))
            n += 1
print('zip creato:', out, '(%d file)' % n)
