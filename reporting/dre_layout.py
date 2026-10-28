"""Small, measured layout components for the saved DRE report.

All text remains searchable. Panels measure their contents before drawing and
navigation destinations are resolved only after the document has paginated.
"""
from reportlab.lib.colors import HexColor
from reportlab.platypus import Flowable

from .dre_charts import DEEP, TEAL, CORAL, INK, MUTED, LINE, PALE, draw_text


class Panel(Flowable):
    def __init__(self, width, contents, *, background=PALE, accent=TEAL,
                 padding=14, min_height=0):
        super().__init__()
        self.width, self.contents = width, contents
        self.background, self.accent = background, accent
        self.padding, self.min_height = padding, min_height
        self.measured = []

    def wrap(self, availWidth, availHeight):
        self.measured = []
        height = self.padding * 2
        for item in self.contents:
            before, after = item.getSpaceBefore(), item.getSpaceAfter()
            _, item_height = item.wrap(self.width - 2 * self.padding, 100000)
            self.measured.append((item, item_height, before, after))
            height += before + item_height + after
        self.height = max(height, self.min_height)
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(HexColor(self.background))
        c.setStrokeColor(HexColor(LINE if self.background != DEEP else DEEP))
        c.setLineWidth(.55)
        c.roundRect(0, 0, self.width, self.height, 9, fill=1, stroke=1)
        c.setFillColor(HexColor(self.accent))
        c.roundRect(self.padding, self.height - 6, 25, 2.5, 1.2, fill=1, stroke=0)
        y = self.height - self.padding
        for item, height, before, after in self.measured:
            y -= before + height
            item.drawOn(c, self.padding, y)
            y -= after


class Navigation(Flowable):
    """A contents page whose page numbers and links are added in canvas replay."""
    def __init__(self, width, sections):
        super().__init__()
        self.width = width
        self.sections = sections
        self.row_height = 40
        self.height = self.row_height * len(sections)

    def draw(self):
        c = self.canv
        for index, (label, description) in enumerate(self.sections):
            y = self.height - self.row_height * (index + 1)
            if index % 2 == 0:
                c.setFillColor(HexColor(PALE))
                c.roundRect(0, y + 2, self.width, self.row_height - 4, 5, fill=1, stroke=0)
            draw_text(c, f'{index + 1:02d}', 12, y + 19, 9, TEAL, bold=True)
            draw_text(c, label, 42, y + 23, 9.2, INK, bold=True)
            draw_text(c, description, 42, y + 10, 7.1, MUTED)
        x, y = c.absolutePosition(0, 0)
        c.navigation_panels.append((c.getPageNumber(), x, y, self.width,
                                    self.height, self.row_height, self.sections))


def draw_navigation_links(canvas, panels, entries):
    destinations = {label: (page, f'dre-section-{index}')
                    for index, (page, label) in enumerate(entries)}
    for page, x, y, width, height, row_height, sections in panels:
        if page != canvas.getPageNumber():
            continue
        for index, (label, _) in enumerate(sections):
            if label not in destinations:
                continue
            target_page, target = destinations[label]
            bottom = y + height - row_height * (index + 1)
            draw_text(canvas, f'{target_page:02d}', x + width - 14, bottom + 18,
                      10, TEAL, bold=True, align='right')
            canvas.linkAbsolute(label, target, (x, bottom + 2, x + width, bottom + row_height - 2),
                                thickness=0, name=f'dre-nav-{page}-{index}')


def running_label(canvas, label, x, y, max_width, *, align='left'):
    """Abbreviate only repeated running labels; their full text is in the body."""
    from reportlab.pdfbase.pdfmetrics import stringWidth
    from .dre_charts import FONT
    label = str(label)
    if stringWidth(label, FONT, 6.6) > max_width:
        while label and stringWidth(label + '...', FONT, 6.6) > max_width:
            label = label[:-1]
        label += '...'
    draw_text(canvas, label, x, y, 6.6, MUTED, align=align)
