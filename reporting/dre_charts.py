"""Vector charts for the Luna DRE: exact labels, readable gaps and honest scales."""
from __future__ import annotations

from math import ceil, floor, log10

from reportlab.lib.colors import HexColor, white
from reportlab.platypus import Flowable
from reportlab.pdfbase.pdfmetrics import stringWidth

from .dre_model import finite, compact, money, percentage, decimal_text

TEAL = '#2F7076'
DEEP = '#1B454A'
CORAL = '#EF7F70'
CORAL_TEXT = '#A4493E'
MINT = '#92B9B8'
INK = '#233A3E'
MUTED = '#61777B'
LINE = '#DEE9E8'
PALE = '#F1F7F6'
COLORS = (TEAL, CORAL, '#68999B', DEEP, '#B2C9C8')
FONT = 'LunaSans'
BOLD = 'LunaSans-Bold'


def draw_text(canvas, text, x, y, size=8, color=INK, bold=False, align='left', max_width=None):
    """Fit a single line without dropping an amount or silently clipping a name."""
    text = str(text)
    font = BOLD if bold else FONT
    measured = stringWidth(text, font, size)
    if max_width and measured > max_width:
        size = max(6.5, size * max_width / measured)
        measured = stringWidth(text, font, size)
    canvas.saveState()
    canvas.setFont(font, size)
    canvas.setFillColor(HexColor(color))
    # A very large captured amount can still exceed its slot at 6.5 pt. A text
    # transform keeps every digit within the slot; ordinary values never need it.
    if max_width and measured > max_width:
        canvas.translate(x, y)
        canvas.scale(max_width / measured, 1)
        x, y = 0, 0
    getattr(canvas, {'left': 'drawString', 'center': 'drawCentredString', 'right': 'drawRightString'}[align])(x, y, text)
    canvas.restoreState()


def wrapped_lines(value, width, size=8, bold=False):
    """Wrap chart labels without ellipsis, including unusually long identifiers."""
    font = BOLD if bold else FONT
    lines = []
    for paragraph in str(value).split('\n'):
        line = ''
        for word in paragraph.split():
            candidate = (line + ' ' + word).strip()
            if stringWidth(candidate, font, size) <= width:
                line = candidate
                continue
            if line:
                lines.append(line)
                line = ''
            part = ''
            for char in word:
                if part and stringWidth(part + char, font, size) > width:
                    lines.append(part)
                    part = ''
                part += char
            line = part
        lines.append(line)
    return lines or ['']


def axis_label(value, span):
    if span < 10:
        return decimal_text(value, 2)
    return compact(value)


def chart_scale(values, intervals=4):
    """Readable numeric ticks, always containing zero and every finite value."""
    low, high = min([0] + values), max([0] + values)
    if low == high:
        return 0, 1, [0, .25, .5, .75, 1]
    raw = (high - low) / intervals
    unit = 10 ** floor(log10(raw))
    step = next(factor * unit for factor in (1, 2, 2.5, 5, 10) if factor * unit >= raw)
    low, high = floor(low / step) * step, ceil(high / step) * step
    ticks = [low + step * index for index in range(round((high - low) / step) + 1)]
    return low, high, [0 if abs(value) < step * 1e-10 else value for value in ticks]


class Chart(Flowable):
    def __init__(self, width, height):
        super().__init__()
        self.width, self.height = width, height

    def wrap(self, available_width, available_height):
        return self.width, self.height

    def panel(self):
        self.canv.setFillColor(HexColor(PALE))
        self.canv.roundRect(0, 0, self.width, self.height, 10, fill=1, stroke=0)

    def empty(self, message='Não há valores confirmados para este gráfico.'):
        self.panel()
        lines = wrapped_lines(message, self.width - 40, 8.5)
        first_y = self.height / 2 + (len(lines) - 1) * 6
        for i, line in enumerate(lines):
            draw_text(self.canv, line, self.width / 2, first_y - 12 * i, 8.5, MUTED, align='center')


class Bars(Chart):
    """Signed bars share a zero-based scale; every row keeps its exact amount."""
    def __init__(self, width, items):
        self.items = list(items)
        self.label_lines = [wrapped_lines(label, max(50, width - 160), 8.5, True) for label, _, _ in self.items]
        self.row_heights = [max(38, 28 + 10 * len(lines)) for lines in self.label_lines]
        super().__init__(width, 24 + sum(self.row_heights))

    def draw(self):
        if not self.items:
            return self.empty()
        c = self.canv
        values = [value for _, value, _ in self.items if finite(value)]
        low, high, ticks = chart_scale(values)
        span = high - low
        left, right = 12, self.width - 12
        x = lambda value: left + (value - low) / span * (right - left)
        cursor = self.height
        for index, ((_, value, color), lines, row_height) in enumerate(zip(self.items, self.label_lines, self.row_heights)):
            c.setFillColor(HexColor(PALE if index % 2 == 0 else '#FAFCFC'))
            c.roundRect(0, cursor - row_height + 2, self.width, row_height - 4, 6, fill=1, stroke=0)
            label_y = cursor - 13
            for line_index, line in enumerate(lines):
                draw_text(c, line, left, label_y - 10 * line_index, 8.5, INK, bold=True)
            draw_text(c, money(value), right, label_y, 8.6,
                      CORAL_TEXT if finite(value) and value < 0 else DEEP, bold=True, align='right', max_width=132)
            bar_y = cursor - row_height + 9
            c.setFillColor(HexColor(LINE))
            c.roundRect(left, bar_y, right - left, 5, 2.5, fill=1, stroke=0)
            if finite(value):
                c.setStrokeColor(HexColor(MUTED))
                c.setLineWidth(.65)
                c.line(x(0), bar_y - 2, x(0), bar_y + 7)
                if value:
                    length = abs(x(value) - x(0))
                    c.setFillColor(HexColor(color if value > 0 else CORAL))
                    c.roundRect(min(x(0), x(value)), bar_y, length, 5, min(2.5, length / 2), fill=1, stroke=0)
                else:
                    c.setFillColor(white)
                    c.circle(x(0), bar_y + 2.5, 2.1, fill=1, stroke=1)
            cursor -= row_height
        if any(value != 0 for value in values):
            for index, value in enumerate(ticks):
                align = 'left' if index == 0 else 'right' if index == len(ticks) - 1 else 'center'
                draw_text(c, axis_label(value, high - low), x(value), 7, 6.8, MUTED, align=align)
        elif values:
            draw_text(c, 'R$ 0,00 em todos os valores disponíveis', left, 7, 6.8, MUTED)
        else:
            draw_text(c, 'n/d = valor indisponível nesta versão', left, 7, 6.8, MUTED)


class Trend(Chart):
    def __init__(self, width, labels, series, height=238):
        self.labels, self.series = list(labels), list(series)
        self.legend_rows = []
        row, occupied = [], 0
        for label, _, color in self.series:
            label_width = min(stringWidth(str(label), FONT, 7.6), width - 44)
            item_width = label_width + 37
            if row and occupied + item_width > width - 24:
                self.legend_rows.append(row)
                row, occupied = [], 0
            row.append((label, color, occupied, label_width))
            occupied += item_width
        if row:
            self.legend_rows.append(row)
        super().__init__(width, height + max(0, len(self.legend_rows) - 1) * 16)

    def draw(self):
        values = [value for _, data, _ in self.series for value in data if finite(value)]
        if not values or not self.labels:
            return self.empty()
        if any(len(data) != len(self.labels) for _, data, _ in self.series):
            return self.empty('A série mensal não corresponde às competências informadas.')
        c = self.canv
        self.panel()
        low, high, ticks = chart_scale(values)
        axis_width = max(stringWidth(axis_label(value, high - low), FONT, 6.8) for value in ticks)
        left, right, bottom = max(48, axis_width + 21), self.width - 24, 43
        top = self.height - 35 - 16 * (len(self.legend_rows) - 1)
        y = lambda value: bottom + (value - low) / (high - low) * (top - bottom)
        x = lambda index: (left + right) / 2 if len(self.labels) == 1 else left + index * (right - left) / (len(self.labels) - 1)
        for value in ticks:
            yy = y(value)
            c.setStrokeColor(HexColor(LINE))
            c.setLineWidth(.55)
            c.line(left, yy, right, yy)
            draw_text(c, axis_label(value, high - low), left - 9, yy - 2.5, 6.8, MUTED, align='right')
        if low < 0:
            c.setStrokeColor(HexColor(MUTED))
            c.setDash(2, 3)
            c.line(left, y(0), right, y(0))
            c.setDash()
        max_label_width = max(30, (right - left) / max(1, len(self.labels) - 1) - 4)
        stride = max(1, (len(self.labels) + 11) // 12)
        for i, label in enumerate(self.labels):
            if i % stride == 0 or i == len(self.labels) - 1:
                draw_text(c, label, x(i), 26, 6.9, MUTED, align='center', max_width=max_label_width)
        for row_index, row in enumerate(self.legend_rows):
            legend_y = self.height - 14 - row_index * 16
            for label, color, offset, label_width in row:
                c.setFillColor(HexColor(color))
                c.circle(17 + offset, legend_y + 2, 3, fill=1, stroke=0)
                draw_text(c, label, 26 + offset, legend_y, 7.6, INK, max_width=label_width)
        for _, data, color in self.series:
            c.setStrokeColor(HexColor(color))
            c.setLineWidth(2)
            for i, value in enumerate(data):
                if not finite(value):
                    continue
                if i and finite(data[i - 1]):
                    c.line(x(i - 1), y(data[i - 1]), x(i), y(value))
                c.setFillColor(white)
                c.circle(x(i), y(value), 3, fill=1, stroke=1)
        draw_text(c, 'R$ - lacunas indicam ausência de dados', self.width - 12, 9, 6.6, MUTED, align='right')


class Waterfall(Chart):
    def __init__(self, width, values):
        self.values = list(values)
        slot = (width - 65) / max(1, len(self.values))
        self.labels = [wrapped_lines(label, max(15, slot - 5), 7.3) for label, _ in self.values]
        self.label_height = max([20] + [10 * len(lines) for lines in self.labels])
        super().__init__(width, 240 + max(0, self.label_height - 20))

    def draw(self):
        if not self.values or not all(finite(value) for _, value in self.values):
            return self.empty('A formação do resultado depende de valores confirmados.')
        c = self.canv
        self.panel()
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
        low, high, ticks = chart_scale(amounts)
        span = high - low
        axis_width = max(stringWidth(axis_label(value, span), FONT, 6.8) for value in ticks)
        left, right = max(46, axis_width + 21), self.width - 14
        bottom, top = 38 + self.label_height, self.height - 34
        y = lambda value: bottom + (value - low) / span * (top - bottom)
        slot = (right - left) / len(steps)
        for value in ticks:
            c.setStrokeColor(HexColor(LINE))
            c.setLineWidth(.5)
            c.line(left, y(value), right, y(value))
            draw_text(c, axis_label(value, span), left - 8, y(value) - 2, 6.8, MUTED, align='right')
        if low < 0:
            c.setStrokeColor(HexColor(MUTED))
            c.line(left, y(0), right, y(0))
        for i, (_, value, start, end) in enumerate(steps):
            xx = left + slot * i + slot * .16
            width = slot * .68
            is_total = i in (0, len(steps) - 1)
            color = TEAL if is_total and value >= 0 else CORAL if value < 0 else MINT
            c.setFillColor(HexColor(color))
            height = abs(y(end) - y(start))
            if height:
                c.roundRect(xx, min(y(start), y(end)), width, height, min(2, height / 2), fill=1, stroke=0)
            else:
                c.setStrokeColor(HexColor(color))
                c.setLineWidth(1)
                c.line(xx, y(end), xx + width, y(end))
            if i < len(steps) - 1:
                c.setStrokeColor(HexColor(MINT))
                c.setLineWidth(.8)
                c.setDash(2, 2)
                c.line(xx + width, y(end), left + slot * (i + 1) + slot * .16, y(end))
                c.setDash()
            draw_text(c, compact(value), xx + width / 2, max(y(start), y(end)) + 9, 8, INK,
                      bold=is_total, align='center', max_width=slot - 4)
            for line, part in enumerate(self.labels[i]):
                draw_text(c, part, xx + width / 2, bottom - 18 - line * 10, 7.3,
                          INK if is_total else MUTED, bold=is_total, align='center', max_width=slot - 3)
        draw_text(c, 'Valores em R$; sinais negativos representam deduções.', self.width - 12, 10, 6.6, MUTED, align='right')


class Donut(Chart):
    def __init__(self, width, items, caption='Composição'):
        self.items, self.caption = list(items), caption
        self.label_lines = [wrapped_lines(label, max(40, width - 262), 8.3, True) for label, _ in self.items]
        self.row_heights = [max(38, 29 + 10 * len(lines)) for lines in self.label_lines]
        super().__init__(width, max(174, sum(self.row_heights) + 20))

    def draw(self):
        values = [value for _, value in self.items]
        if not values or any(not finite(value) or value < 0 for value in values) or not finite(sum(values)) or sum(values) <= 0:
            return self.empty('Sem base positiva para representar a composição.')
        c = self.canv
        self.panel()
        total = sum(values)
        cx, cy, radius = 79, self.height / 2, 63
        start = 90
        for i, (_, value) in enumerate(self.items):
            extent = value / total * 360
            c.setFillColor(HexColor(COLORS[i % len(COLORS)]))
            if extent > 1e-10:
                c.wedge(cx - radius, cy - radius, cx + radius, cy + radius, start, extent, fill=1, stroke=0)
            start += extent
        c.setFillColor(HexColor(PALE))
        c.circle(cx, cy, 48, fill=1, stroke=0)
        draw_text(c, 'TOTAL', cx, cy + 17, 6.7, MUTED, bold=True, align='center')
        draw_text(c, 'R$ ' + compact(total), cx, cy - 1, 12.5, DEEP, bold=True, align='center', max_width=86)
        draw_text(c, self.caption, cx, cy - 16, 7, MUTED, align='center', max_width=84)
        left, right = 165, self.width - 13
        cursor = (self.height + sum(self.row_heights)) / 2
        for i, ((_, value), lines, row_height) in enumerate(zip(self.items, self.label_lines, self.row_heights)):
            color = COLORS[i % len(COLORS)]
            y = cursor - 12
            c.setFillColor(HexColor(color))
            c.circle(left, y + 3, 3.3, fill=1, stroke=0)
            for line_index, line in enumerate(lines):
                draw_text(c, line, left + 12, y - 10 * line_index, 8.3, INK, bold=True)
            draw_text(c, percentage(value / total), right, y, 9.4, DEEP, bold=True, align='right', max_width=65)
            detail_y = y - 10 * (len(lines) - 1) - 12
            draw_text(c, money(value), left + 12, detail_y, 7.7, MUTED, max_width=right - left - 12)
            track_y = cursor - row_height + 4
            c.setFillColor(HexColor(LINE))
            c.roundRect(left + 12, track_y, right - left - 12, 2.5, 1.2, fill=1, stroke=0)
            if value:
                share_width = (right - left - 12) * value / total
                c.setFillColor(HexColor(color))
                c.roundRect(left + 12, track_y, share_width, 2.5, min(1.2, share_width / 2), fill=1, stroke=0)
            cursor -= row_height


class CoverageStrip(Chart):
    """Explicit calendar availability; each label has one supplied boolean."""
    def __init__(self, width, labels, available, caption='Competências no consolidado'):
        self.labels, self.available = list(labels), list(available)
        self.caption = caption
        if len(self.labels) != len(self.available):
            raise ValueError('A cobertura exige uma indicação para cada competência.')
        if any(type(value) is not bool for value in self.available):
            raise ValueError('A disponibilidade de cada competência deve ser explícita.')
        self.columns = max(1, min(12, len(self.labels)))
        super().__init__(width, 30 + 41 * max(1, ceil(len(self.labels) / self.columns)))

    def draw(self):
        if not self.labels:
            return self.empty('Não há calendário disponível nesta versão.')
        c = self.canv
        draw_text(c, self.caption, 0, self.height - 13, 8.5, DEEP, bold=True, max_width=self.width - 173)
        legend_x = self.width - 160
        for offset, label, included in [(0, 'Incluída', True), (82, 'Sem dados', False)]:
            c.setFillColor(HexColor(TEAL if included else LINE))
            c.roundRect(legend_x + offset, self.height - 13, 8, 5, 2, fill=1, stroke=0)
            draw_text(c, label, legend_x + offset + 13, self.height - 13, 6.8, MUTED)
        gap = 5
        cell_width = (self.width - gap * (self.columns - 1)) / self.columns
        for index, (label, included) in enumerate(zip(self.labels, self.available)):
            column, row = index % self.columns, index // self.columns
            left, bottom = column * (cell_width + gap), self.height - 63 - row * 41
            c.setFillColor(HexColor(PALE if included else '#FAFCFC'))
            c.setStrokeColor(HexColor(MINT if included else LINE))
            c.setLineWidth(.5)
            c.roundRect(left, bottom, cell_width, 32, 5, fill=1, stroke=1)
            draw_text(c, label, left + cell_width / 2, bottom + 17, 7.1,
                      DEEP if included else MUTED, bold=included, align='center', max_width=cell_width - 6)
            c.setFillColor(HexColor(TEAL if included else LINE))
            c.roundRect(left + cell_width / 2 - 9, bottom + 7, 18, 3, 1.5, fill=1, stroke=0)
