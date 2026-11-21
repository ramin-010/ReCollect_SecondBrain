# Makes the widget's fixed-look layouts and drawables from the System ones (DayWidget: a launcher re-applies an
# update onto the old views, so a fixed theme needs its own layout with its colours in it).
#   python widget-themes.py   (in android/)
# 0.7.0 (stage 19): the app's two looks. Slate keeps the old names (System: widget_day; light: widget_day_light; dark:
# widget_day_dark); Paper adds widget_day_paper (System), _paper_light and _paper_dark. Colours: values/colors.xml.
import io, re

LAYOUTS = ['widget_day', 'widget_day_short', 'widget_day_small']
DRAWABLES = ['widget_bg', 'widget_pill', 'widget_pill_set']
# variant -> the colour names' prefix
VARIANTS = {
    'light': 'w_light_',
    'dark': 'w_dark_',
    'paper': 'wp_',
    'paper_light': 'wp_light_',
    'paper_dark': 'wp_dark_',
}
COLOR = re.compile(r'@color/w_(ink_[123]|ground|ring|line_strong|set)\b')
DRAWABLE = re.compile(r'@drawable/(widget_pill_set|widget_pill|widget_bg)"')


def variant(body, name):
    out = COLOR.sub(lambda m: '@color/' + VARIANTS[name] + m.group(1), body)
    return DRAWABLE.sub(lambda m: '@drawable/' + m.group(1) + '_' + name + '"', out)


def write(folder, base, name, body):
    head = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Made from ' + base + '.xml (' + name + ') by widget-themes.py: edit ' + base + '.xml, then run it. -->\n'
    path = 'res/' + folder + '/' + base + '_' + name + '.xml'
    io.open(path, 'w', encoding='utf-8', newline='\n').write(head + body)
    print(path)


for base in LAYOUTS:
    src = io.open('res/layout/' + base + '.xml', encoding='utf-8').read()
    body = src[src.index('<LinearLayout'):]
    for name in VARIANTS:
        write('layout', base, name, variant(body, name))

for base in DRAWABLES:
    src = io.open('res/drawable/' + base + '.xml', encoding='utf-8').read()
    start = min(i for i in (src.find('<shape'), src.find('<selector')) if i >= 0)
    for name in VARIANTS:
        write('drawable', base, name, variant(src[start:], name))
