"""Small vector charts for portable, sharp and searchable ReportLab PDFs."""
from __future__ import annotations

from reportlab.lib.colors import HexColor, white
from reportlab.platypus import Flowable
from reportlab.pdfbase.pdfmetrics import stringWidth

from .dre_model import finite, compact, money, percentage

TEAL = '#2F7076'
DEEP = '#1B454A'
CORAL = '#EF7F70'
MINT = '#92B9B8'
INK = '#233A3E'
MUTED = '#61777B'
LINE = '#DEE9E8'
PALE = '#F1F7F6'
COLORS = (TEAL, CORAL, '#68999B', DEEP, '#B2C9C8')
FONT = 'LunaSans'
BOLD = 'LunaSans-Bold'


def draw_text(canvas, text, x, y, size=8, color=INK, bold=False, align='left', max_width=None):
    text = str(text)
    font = BOLD if bold else FONT
    if max_width:
        measured = stringWidth(text, font, size)
        if measured > max_width:
            size = max(6.5, size * max_width / measured)
    canvas.setFont(font, size)
    canvas.setFillColor(HexColor(color))
    getattr(canvas, {'left': 'drawString', 'center': 'drawCentredString', 'right': 'drawRightString'}[align])(x, y, text)


class Chart(Flowable):
    def __init__(self, width, height):
        super().__init__()
        self.width, self.height = width, height

    def wrap(self, available_width, available_height):
        return self.width, self.height

    def empty(self, message='Não há valores confirmados para este gráfico.'):
        self.canv.setFillColor(HexColor(PALE))
        self.canv.roundRect(0, 0, self.width, self.height, 9, fill=1, stroke=0)
        draw_text(self.canv, message, self.width / 2, self.height / 2, 9, MUTED,
                  align='center', max_width=self.width - 25)


class Bars(Chart):
    """Zero-based signed bars; labels always retain the exact source amount."""
    def __init__(self, width, items):
        self.items = items
        super().__init__(width, 40 + 34 * len(items))

    def draw(self):
        values = [value for _, value, _ in self.items if finite(value)]
        if not values:
            return self.empty()
        c = self.canv
        left, right, top, bottom = 128, self.width - 109, self.height - 18, 23
        low, high = min([0] + values), max([0] + values)
        if high == low:
            high = 1
        span = high - low
        x = lambda value: left + (value - low) / span * (right - left)
        c.setLineWidth(.5)
        for i in range(4):
            value = low + span * i / 3
            xx = x(value)
            c.setStrokeColor(HexColor(LINE))
            c.line(xx, bottom, xx, top + 8)
            draw_text(c, compact(value), xx, 9, 7, MUTED, align='center')
        c.setStrokeColor(HexColor(MINT))
        c.line(x(0), bottom, x(0), top + 8)
        for i, (label, value, color) in enumerate(self.items):
            y = top - i * 34
            draw_text(c, label, 0, y - 3, 8.3, INK, max_width=120)
            if finite(value):
                c.setFillColor(HexColor(color if value >= 0 else CORAL))
                c.roundRect(min(x(0), x(value)), y - 8, max(abs(x(value) - x(0)), .6), 16, 2, fill=1, stroke=0)
            draw_text(c, money(value), self.width, y - 3, 8.4, CORAL if finite(value) and value < 0 else INK,
                      bold=True, align='right', max_width=104)


class Trend(Chart):
    def __init__(self, width, labels, series, height=238):
        self.labels, self.series = labels, series
        super().__init__(width, height)

    def draw(self):
        values = [value for _, data, _ in self.series for value in data if finite(value)]
        if not values or not self.labels:
            return self.empty()
        c = self.canv
        left, right, bottom, top = 48, self.width - 10, 38, self.height - 37
        low, high = min([0] + values), max([0] + values)
        if high == low:
            high = 1
        span = high - low
        low -= span * .08 if low < 0 else 0
        high += span * .1
        y = lambda value: bottom + (value - low) / (high - low) * (top - bottom)
        x = lambda index: (left + right) / 2 if len(self.labels) == 1 else left + index * (right - left) / (len(self.labels) - 1)
        for i in range(5):
            value = low + (high - low) * i / 4
            yy = y(value)
            c.setStrokeColor(HexColor(LINE))
            c.setLineWidth(.5)
            c.line(left, yy, right, yy)
            draw_text(c, compact(value), left - 8, yy - 2.5, 7, MUTED, align='right')
        if low < 0:
            c.setStrokeColor(HexColor(MUTED))
            c.line(left, y(0), right, y(0))
        stride = max(1, (len(self.labels) + 11) // 12)
        for i, label in enumerate(self.labels):
            if i % stride == 0:
                draw_text(c, label, x(i), 20, 7.4, MUTED, align='center')
        legend_x = 0
        for label, data, color in self.series:
            c.setFillColor(HexColor(color))
            c.roundRect(legend_x, self.height - 11, 13, 3, 1, fill=1, stroke=0)
            draw_text(c, label, legend_x + 18, self.height - 12, 8, MUTED)
            legend_x += 18 + stringWidth(label, FONT, 8) + 24
            c.setStrokeColor(HexColor(color))
            c.setLineWidth(1.8)
            for i, value in enumerate(data):
                if not finite(value):
                    continue
                if i and finite(data[i - 1]):
                    c.line(x(i - 1), y(data[i - 1]), x(i), y(value))
                c.setFillColor(HexColor(color))
                c.circle(x(i), y(value), 2.5, fill=1, stroke=0)
        draw_text(c, 'R$ - valores preservados por competência', self.width, 0, 7, MUTED, align='right')


class Waterfall(Chart):
    def __init__(self, width, values):
        self.values = values
        super().__init__(width, 240)

    def draw(self):
        if not all(finite(value) for _, value in self.values):
            return self.empty('A formação do resultado depende de valores confirmados.')
        c = self.canv
        running, steps = 0, []
        for i, (label, value) in enumerate(self.values):
            if i in (0, len(self.values) - 1):
                start, end = 0, value
                if i == 0:
                    running = value
            else:
                start, end = running, running + value
                running = end
            steps.append((label, value, start, end))
        amounts = [number for _, _, start, end in steps for number in (start, end)]
        low, high = min([0] + amounts), max([0] + amounts)
        if high == low:
            high = 1
        left, right, bottom, top = 42, self.width - 8, 58, self.height - 25
        span = high - low
        y = lambda value: bottom + (value - low) / span * (top - bottom)
        slot = (right - left) / len(steps)
        for i in range(4):
            value = low + span * i / 3
            c.setStrokeColor(HexColor(LINE))
            c.setLineWidth(.4)
            c.line(left, y(value), right, y(value))
            draw_text(c, compact(value), left - 6, y(value) - 2, 7, MUTED, align='right')
        for i, (label, value, start, end) in enumerate(steps):
            xx = left + slot * i + slot * .16
            width = slot * .68
            is_total = i in (0, len(steps) - 1)
            color = TEAL if is_total and value >= 0 else CORAL if value < 0 else MINT
            c.setFillColor(HexColor(color))
            c.roundRect(xx, min(y(start), y(end)), width, max(abs(y(end) - y(start)), .6), 2, fill=1, stroke=0)
            if i < len(steps) - 2:
                c.setStrokeColor(HexColor(MINT))
                c.setDash(2, 2)
                c.line(xx + width, y(end), left + slot * (i + 1) + slot * .16, y(end))
                c.setDash()
            draw_text(c, compact(value), xx + width / 2, max(y(start), y(end)) + 8, 8, INK,
                      bold=is_total, align='center', max_width=slot - 2)
            for line, part in enumerate(label.split('\n')):
                draw_text(c, part, xx + width / 2, 39 - line * 10, 7.5, MUTED, align='center', max_width=slot)


class Donut(Chart):
    def __init__(self, width, items, caption='Composição'):
        self.items, self.caption = items, caption
        super().__init__(width, max(160, 33 * len(items) + 15))

    def draw(self):
        values = [value for _, value in self.items]
        if not values or any(not finite(value) or value < 0 for value in values) or sum(values) <= 0:
            return self.empty('Sem base positiva para representar a composição.')
        c = self.canv
        total = sum(values)
        cx, cy, radius = 81, self.height / 2, 65
        start = 90
        for i, (_, value) in enumerate(self.items):
            extent = value / total * 360
            c.setFillColor(HexColor(COLORS[i % len(COLORS)]))
            if extent > 1e-10:
                c.wedge(cx - radius, cy - radius, cx + radius, cy + radius, start, extent, fill=1, stroke=0)
            start += extent
        c.setFillColor(white)
        c.circle(cx, cy, 46, fill=1, stroke=0)
        draw_text(c, 'R$ ' + compact(total), cx, cy + 2, 13, DEEP, bold=True, align='center', max_width=83)
        draw_text(c, self.caption, cx, cy - 13, 7, MUTED, align='center', max_width=80)
        left, top = 180, self.height / 2 + (len(self.items) - 1) * 16.5
        for i, (label, value) in enumerate(self.items):
            y = top - 33 * i
            c.setFillColor(HexColor(COLORS[i % len(COLORS)]))
            c.roundRect(left, y - 4, 7, 7, 2, fill=1, stroke=0)
            draw_text(c, label, left + 15, y, 8.5, INK, max_width=self.width - left - 88)
            draw_text(c, percentage(value / total), self.width, y, 9, TEAL, bold=True, align='right')
            draw_text(c, money(value), left + 15, y - 13, 8, MUTED)
