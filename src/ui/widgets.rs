use std::time::Instant;

use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use unicode_width::{UnicodeWidthChar, UnicodeWidthStr};

use super::theme::Theme;

const EIGHTHS: [&str; 9] = [" ", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

pub fn put(buf: &mut Buffer, x: u16, y: u16, text: &str, style: Style) -> u16 {
    if y >= buf.area.bottom() || x >= buf.area.right() {
        return x;
    }
    let (end, _) = buf.set_stringn(x, y, text, usize::from(buf.area.right() - x), style);
    end
}

/// Cuts `text` to `width` columns, ending in an ellipsis when it had to cut.
pub fn fit(text: &str, width: usize) -> String {
    if text.width() <= width {
        return text.to_string();
    }
    let mut out = String::new();
    let mut used = 0;
    for ch in text.chars() {
        let w = ch.width().unwrap_or(0);
        if used + w + 1 > width {
            break;
        }
        used += w;
        out.push(ch);
    }
    if width > 0 {
        out.push('…');
    }
    out
}

pub fn fill(buf: &mut Buffer, area: Rect, style: Style) {
    let area = area.intersection(buf.area);
    for y in area.top()..area.bottom() {
        for x in area.left()..area.right() {
            if let Some(cell) = buf.cell_mut((x, y)) {
                cell.set_symbol(" ").set_style(style);
            }
        }
    }
}

/// Word-wraps `text` into at most `max_lines` lines of `width` columns, ending in an ellipsis
/// when it still doesn't fit.
pub fn wrap(text: &str, width: usize, max_lines: usize) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for word in text.split_whitespace() {
        match lines.last_mut() {
            Some(line) if line.width() + 1 + word.width() <= width => {
                line.push(' ');
                line.push_str(word);
            }
            _ => lines.push(word.to_string()),
        }
    }
    if lines.len() > max_lines {
        let overflow = lines.split_off(max_lines).join(" ");
        if let Some(last) = lines.last_mut() {
            *last = format!("{last} {overflow}");
        }
    }
    lines.iter().map(|line| fit(line, width)).collect()
}

/// A thin line meter with half-cell resolution: `━━━━╸────`.
pub fn meter(buf: &mut Buffer, area: Rect, fraction: f64, filled: Style, track: Style) {
    if area.width == 0 {
        return;
    }
    let halves = (fraction.clamp(0.0, 1.0) * f64::from(area.width) * 2.0).round() as u16;
    for offset in 0..area.width {
        let used = halves.saturating_sub(offset * 2);
        let (symbol, style) = match used {
            0 => ("─", track),
            1 => ("╸", filled),
            _ => ("━", filled),
        };
        if let Some(cell) = buf.cell_mut((area.x + offset, area.y)) {
            cell.set_symbol(symbol).set_style(style);
        }
    }
}

/// A slider that fills from its middle toward the knob, for a balance between two sides.
/// Give it an odd width so the middle is a cell.
pub fn balance(buf: &mut Buffer, area: Rect, value: f32, knob: Style, filled: Style, track: Style) {
    if area.width < 3 {
        return;
    }
    let middle = (area.width - 1) / 2;
    let at = (value.clamp(0.0, 1.0) * f32::from(area.width - 1)).round() as u16;
    let (low, high) = (middle.min(at), middle.max(at));
    for offset in 0..area.width {
        let (symbol, style) = match offset {
            _ if offset == at => ("●", knob),
            _ if (low..=high).contains(&offset) => ("━", filled),
            _ => ("─", track),
        };
        if let Some(cell) = buf.cell_mut((area.x + offset, area.y)) {
            cell.set_symbol(symbol).set_style(style);
        }
    }
}

const DIGITS: [[&str; 5]; 11] = [
    ["###", "#.#", "#.#", "#.#", "###"],
    [".#.", "##.", ".#.", ".#.", "###"],
    ["###", "..#", "###", "#..", "###"],
    ["###", "..#", ".##", "..#", "###"],
    ["#.#", "#.#", "###", "..#", "..#"],
    ["###", "#..", "###", "..#", "###"],
    ["###", "#..", "###", "#.#", "###"],
    ["###", "..#", "..#", ".#.", ".#."],
    ["###", "#.#", "###", "#.#", "###"],
    ["###", "#.#", "###", "..#", "###"],
    ["...", ".#.", "...", ".#.", "..."],
];

pub fn clock_width(text: &str) -> u16 {
    text.chars()
        .map(|ch| if ch == ':' { 5 } else { 7 })
        .sum::<u16>()
        .saturating_sub(1)
}

/// Renders digits and colons three rows tall from a 3x5 pixel font, two columns per pixel.
pub fn big_clock(buf: &mut Buffer, x: u16, y: u16, text: &str, style: Style, colon: Style) {
    let mut cursor = x;
    for ch in text.chars() {
        let (glyph, narrow) = match ch {
            ':' => (&DIGITS[10], true),
            digit => match digit.to_digit(10) {
                Some(value) => (&DIGITS[value as usize], false),
                None => continue,
            },
        };
        let style = if narrow { colon } else { style };
        for row in 0..3 {
            for column in 0..3 {
                if narrow && column != 1 {
                    continue;
                }
                let lit = |line: usize| glyph.get(line).is_some_and(|line| line.as_bytes()[column] == b'#');
                let symbol = match (lit(row * 2), lit(row * 2 + 1)) {
                    (true, true) => "██",
                    (true, false) => "▀▀",
                    (false, true) => "▄▄",
                    (false, false) => "  ",
                };
                let column_x = if narrow { cursor + 1 } else { cursor + column as u16 * 2 };
                put(buf, column_x, y + row as u16, symbol, style);
            }
        }
        cursor += if narrow { 5 } else { 7 };
    }
}

/// Vertical bars rising from the bottom edge, with a gradient from faint to bright and
/// accent-colored peak marks.
pub fn spectrum(buf: &mut Buffer, area: Rect, levels: &[f32], peaks: &[f32], theme: &Theme) {
    if area.height == 0 || levels.is_empty() {
        return;
    }
    let count = levels.len() as u16;
    let slot = (area.width / count).max(1);
    let bar = if slot >= 3 { slot - 1 } else { slot };
    let used = slot * count;
    let left = area.x + area.width.saturating_sub(used) / 2;
    let rows = area.height;
    for (index, (level, peak)) in levels.iter().zip(peaks).enumerate() {
        let x = left + index as u16 * slot;
        let eighths = (level.clamp(0.0, 1.0) * f32::from(rows) * 8.0).round() as u16;
        for row in 0..rows {
            let y = area.bottom() - 1 - row;
            let filled = eighths.saturating_sub(row * 8).min(8);
            if filled == 0 {
                continue;
            }
            let shade = 0.28 + 0.72 * (f32::from(row) + 1.0) / f32::from(rows);
            let style = Style::new().fg(theme.mix(shade));
            for column in 0..bar {
                put(buf, x + column, y, EIGHTHS[usize::from(filled)], style);
            }
        }
        let peak_row = (peak.clamp(0.0, 1.0) * f32::from(rows)) as u16;
        let top_row = eighths.div_ceil(8);
        if *peak > 0.02 && peak_row >= top_row && peak_row < rows {
            let y = area.bottom() - 1 - peak_row;
            for column in 0..bar {
                put(buf, x + column, y, "▁", Style::new().fg(theme.accent));
            }
        }
    }
}

/// Labeled vertical bars for whole-number values, scaled by `grow` for an entrance animation.
pub fn bar_chart(buf: &mut Buffer, area: Rect, bars: &[(String, u32, bool)], grow: f32, theme: &Theme) {
    if bars.is_empty() || area.height < 3 {
        return;
    }
    let max = bars.iter().map(|(_, value, _)| *value).max().unwrap_or(0).max(1);
    let slot = area.width / bars.len() as u16;
    let width = slot.saturating_sub(2).clamp(1, 6);
    let chart_rows = area.height - 2;
    for (index, (label, value, highlight)) in bars.iter().enumerate() {
        let x = area.x + index as u16 * slot + (slot - width) / 2;
        let height = *value as f32 / max as f32 * f32::from(chart_rows) * grow;
        let eighths = (height * 8.0).round() as u16;
        let color = if *highlight { theme.accent } else { theme.mix(0.55) };
        for row in 0..chart_rows {
            let filled = eighths.saturating_sub(row * 8).min(8);
            if filled > 0 {
                let y = area.y + chart_rows - row;
                for column in 0..width {
                    put(buf, x + column, y, EIGHTHS[usize::from(filled)], Style::new().fg(color));
                }
            }
        }
        let top = area.y + chart_rows.saturating_sub(eighths.div_ceil(8));
        let amount = if *value == 0 {
            "·".to_string()
        } else {
            short_minutes(*value)
        };
        let amount_x = x + width / 2 - (amount.width() as u16 / 2).min(width / 2);
        put(buf, amount_x, top, &amount, Style::new().fg(theme.muted()));
        let label_x = x + width / 2 - (label.width() as u16 / 2).min(width / 2);
        let label_style = if *highlight {
            Style::new().fg(theme.text())
        } else {
            Style::new().fg(theme.faint())
        };
        put(buf, label_x, area.y + chart_rows + 1, label, label_style);
    }
}

pub fn short_minutes(minutes: u32) -> String {
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m}m"),
        (h, 0) => format!("{h}h"),
        (h, m) => format!("{h}h{m:02}"),
    }
}

pub fn long_minutes(minutes: u32) -> String {
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m} min"),
        (h, 0) => format!("{h} h"),
        (h, m) => format!("{h} h {m} min"),
    }
}

pub fn spinner(since: Instant, now: Instant) -> &'static str {
    const FRAMES: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    FRAMES[(now.duration_since(since).as_millis() / 80) as usize % FRAMES.len()]
}

pub fn sparkline(values: &[u32]) -> String {
    let max = values.iter().copied().max().unwrap_or(0).max(1);
    values
        .iter()
        .map(|value| {
            let level = (*value as f32 / max as f32 * 7.0).round() as usize;
            if *value == 0 { "·" } else { EIGHTHS[(level + 1).min(8)] }
        })
        .collect()
}

/// Fades every cell in `area` toward the background, except those in `keep`.
pub fn dim(buf: &mut Buffer, area: Rect, amount: f32, theme: &Theme, keep: Option<Rect>) {
    if amount <= 0.01 {
        return;
    }
    let area = area.intersection(buf.area);
    for y in area.top()..area.bottom() {
        for x in area.left()..area.right() {
            if keep.is_some_and(|keep| keep.contains((x, y).into())) {
                continue;
            }
            let Some(cell) = buf.cell_mut((x, y)) else { continue };
            if theme.has_rgb() {
                let fg = toward_background(cell.fg, amount, theme);
                let bg = toward_background(cell.bg, amount, theme);
                cell.set_fg(fg).set_bg(bg);
            } else if amount > 0.3 {
                cell.modifier.insert(Modifier::DIM);
            }
        }
    }
}

fn toward_background(color: Color, amount: f32, theme: &Theme) -> Color {
    let (Color::Rgb(r, g, b), Color::Rgb(br, bg, bb)) = (resolve(color, theme), theme.background()) else {
        return color;
    };
    let mix = |from: u8, to: u8| (f32::from(from) + (f32::from(to) - f32::from(from)) * amount).round() as u8;
    Color::Rgb(mix(r, br), mix(g, bg), mix(b, bb))
}

fn resolve(color: Color, theme: &Theme) -> Color {
    match color {
        Color::Reset => theme.text(),
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_breaks_on_words_and_ellipsizes_what_does_not_fit() {
        assert_eq!(wrap("short", 20, 2), ["short"]);
        assert_eq!(wrap("one two three four", 9, 2), ["one two", "three fo…"]);
        assert_eq!(wrap("one two three", 9, 2), ["one two", "three"]);
    }

    #[test]
    fn fit_cuts_wide_text_on_column_boundaries() {
        assert_eq!(fit("short", 10), "short");
        assert_eq!(fit("a longer title", 8), "a longe…");
        assert_eq!(fit("日本語のタイトル", 7).width(), 7);
    }

    #[test]
    fn meter_uses_half_cells() {
        let area = Rect::new(0, 0, 4, 1);
        let mut buf = Buffer::empty(area);
        meter(&mut buf, area, 0.375, Style::new(), Style::new());
        let line: String = (0..4).map(|x| buf[(x, 0)].symbol().to_string()).collect();
        assert_eq!(line, "━╸──");
    }
}
