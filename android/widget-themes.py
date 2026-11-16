# Makes the widget's fixed-theme layouts from the System ones (DayWidget: a launcher re-applies an
# update onto the old views, so a fixed theme needs its own layout with its colours in it).
#   python widget-themes.py   (in android/)
import io, re
for base in ['widget_day', 'widget_day_small']:
    src = io.open(f'res/layout/{base}.xml', encoding='utf-8').read()
    body = src[src.index('<LinearLayout'):]
    for theme in ['light', 'dark']:
        out = re.sub(r'@color/w_(ink_[123]|ground|ring)', rf'@color/w_{theme}_\1', body)
        out = out.replace('@drawable/widget_bg"', f'@drawable/widget_bg_{theme}"')
        head = f'<?xml version="1.0" encoding="utf-8"?>\n<!-- Made from {base}.xml with the {theme} steps by widget-themes.py: edit {base}.xml, then run it. -->\n'
        io.open(f'res/layout/{base}_{theme}.xml', 'w', encoding='utf-8', newline='\n').write(head + out)
        print(f'res/layout/{base}_{theme}.xml')
