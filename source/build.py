"""Builds the single-file app from source/src into app/index.html (Mac app) and docs/app.html (web version)."""
import pathlib
root = pathlib.Path(__file__).parent; src = root / 'src'; repo = root.parent
ui = (src / 'ui.html').read_text()
mux = (root / 'mp4-muxer.min.js').read_text()
an = (src / 'analyzer.js').read_text()
js = '\n'.join((src / f).read_text() for f in ['base.js', 'scenes.js', 'scenes2.js', 'scenes3.js', 'engine.js', 'app.js'])
body = (ui + '\n<script>\n/*! mp4-muxer 5.2.2 | MIT License | Copyright (c) 2023 Vanilagy */\n' + mux + '\n</script>\n'
        + '<script id="gdv-analyzer">\n(function(){\n' + an + '\n;(typeof window !== "undefined" ? window : self).__analyzeAudio = analyzeAudio;\n})();\n</script>\n'
        + '<script>\n' + js + '\n</script>\n')
page = '<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n' + body + '</body>\n</html>\n'
for out in [repo / 'app' / 'index.html', repo / 'docs' / 'app.html']:
    out.parent.mkdir(exist_ok=True); out.write_text(page)
print('built', len(page) // 1024, 'KB')
