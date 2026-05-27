/**
 * Shared markdown conversion utilities for notification channels.
 * Handles table → ASCII art conversion and per-channel markdown formatting.
 */

// ─── ASCII Art Tables ────────────────────────────────────────────────────────

function parseMarkdownTable(block: string): string[][] | null {
    const lines = block.trim().split('\n').map(l => l.trim());
    if (lines.length < 2) return null;

    const parseRow = (line: string): string[] =>
        line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());

    const isSeparator = (line: string) => /^\|?[\s\-:|]+\|[\s\-:|]*$/.test(line);

    if (!isSeparator(lines[1])) return null;

    const header = parseRow(lines[0]);
    const rows = lines.slice(2).map(parseRow);

    return [header, ...rows];
}

function renderAsciiTable(rows: string[][]): string {
    if (rows.length === 0) return '';

    const colCount = Math.max(...rows.map(r => r.length));
    const colWidths: number[] = Array(colCount).fill(0);

    for (const row of rows) {
        for (let i = 0; i < colCount; i++) {
            const cell = row[i] ?? '';
            // Strip markdown bold/italic for width calculation
            const plain = cell.replace(/\*\*?(.*?)\*\*?/g, '$1');
            colWidths[i] = Math.max(colWidths[i], plain.length);
        }
    }

    const pad = (text: string, width: number) => {
        const plain = text.replace(/\*\*?(.*?)\*\*?/g, '$1');
        return plain + ' '.repeat(Math.max(0, width - plain.length));
    };

    const top    = '┌' + colWidths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
    const mid    = '├' + colWidths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
    const bottom = '└' + colWidths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';

    const renderRow = (row: string[]) =>
        '│ ' + colWidths.map((w, i) => pad(row[i] ?? '', w)).join(' │ ') + ' │';

    const [header, ...body] = rows;
    const lines = [top, renderRow(header)];
    if (body.length > 0) {
        lines.push(mid);
        for (const row of body) lines.push(renderRow(row));
    }
    lines.push(bottom);

    return lines.join('\n');
}

/**
 * Finds markdown tables in text and replaces them with ASCII art code blocks.
 * Strips bold/italic markers from table cells (can't format inside monospace).
 * Uses a line-by-line parser to handle \r\n, trailing spaces, and format variations.
 */
export function tablesToAsciiArt(text: string): string {
    // Normalize line endings
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');
    const result: string[] = [];
    let i = 0;

    const isTableRow = (line: string) => /^\s*\|/.test(line);
    const isSeparatorRow = (line: string) => /^\s*\|[\s\-:|]+(\|[\s\-:|]*)*\|?\s*$/.test(line) && /\-/.test(line);

    while (i < lines.length) {
        const line = lines[i];

        // Check if this looks like a table header row followed by a separator
        if (isTableRow(line) && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
            // Collect all consecutive table rows
            const tableLines: string[] = [line];
            i++;
            while (i < lines.length && isTableRow(lines[i])) {
                tableLines.push(lines[i]);
                i++;
            }

            const block = tableLines.join('\n');
            const rows = parseMarkdownTable(block);
            if (rows && rows.length > 0) {
                const ascii = renderAsciiTable(rows);
                result.push('```\n' + ascii + '\n```');
            } else {
                result.push(block);
            }
        } else {
            result.push(line);
            i++;
        }
    }

    return result.join('\n');
}

// ─── Per-channel Markdown Conversion ─────────────────────────────────────────

/** Escapes all MarkdownV2 special characters in plain text segments. */
function escapeMdV2Plain(text: string): string {
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

/**
 * Converts standard markdown to Telegram MarkdownV2.
 * Handles: bold, italic, headings, code blocks, inline code, tables (→ ASCII art).
 * Properly escapes plain text without breaking formatting markers.
 */
function markdownToTelegramV2(text: string): string {
    const result: string[] = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block (``` ... ```) — preserve as-is, no escaping inside
        if (line.trimStart().startsWith('```')) {
            const lang = line.trim().slice(3);
            const blockLines: string[] = ['```' + lang];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                blockLines.push(lines[i]);
                i++;
            }
            blockLines.push('```');
            result.push(blockLines.join('\n'));
            i++;
            continue;
        }

        // Heading → bold line
        const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
        if (headingMatch) {
            result.push(`*${escapeMdV2Plain(headingMatch[1])}*`);
            i++;
            continue;
        }

        // Horizontal rule
        if (/^[-*_]{3,}$/.test(line.trim())) {
            result.push(escapeMdV2Plain('─────────────────'));
            i++;
            continue;
        }

        // Empty line
        if (line.trim() === '') {
            result.push('');
            i++;
            continue;
        }

        // Regular line — convert inline formatting
        result.push(convertInlineToV2(line));
        i++;
    }

    return result.join('\n');
}

/** Converts inline markdown (bold, italic, inline code) to MarkdownV2 in a single line. */
function convertInlineToV2(line: string): string {
    // Process segments to avoid double-escaping
    let out = '';
    let j = 0;

    while (j < line.length) {
        // Inline code: `code`
        if (line[j] === '`') {
            const end = line.indexOf('`', j + 1);
            if (end !== -1) {
                out += '`' + line.slice(j + 1, end) + '`';
                j = end + 1;
                continue;
            }
        }

        // Bold+italic: ***text***
        if (line.slice(j, j + 3) === '***') {
            const end = line.indexOf('***', j + 3);
            if (end !== -1) {
                out += '*_' + escapeMdV2Plain(line.slice(j + 3, end)) + '_*';
                j = end + 3;
                continue;
            }
        }

        // Bold: **text**
        if (line.slice(j, j + 2) === '**') {
            const end = line.indexOf('**', j + 2);
            if (end !== -1) {
                out += '*' + escapeMdV2Plain(line.slice(j + 2, end)) + '*';
                j = end + 2;
                continue;
            }
        }

        // Italic: *text* or _text_
        if ((line[j] === '*' || line[j] === '_') && line[j + 1] !== line[j]) {
            const marker = line[j];
            const end = line.indexOf(marker, j + 1);
            if (end !== -1) {
                out += '_' + escapeMdV2Plain(line.slice(j + 1, end)) + '_';
                j = end + 1;
                continue;
            }
        }

        // Markdown link: [text](url)
        if (line[j] === '[') {
            const textEnd = line.indexOf('](', j);
            if (textEnd !== -1) {
                const urlEnd = line.indexOf(')', textEnd + 2);
                if (urlEnd !== -1) {
                    const linkText = line.slice(j + 1, textEnd);
                    const url = line.slice(textEnd + 2, urlEnd);
                    // URL only needs ) and \ escaped
                    const safeUrl = url.replace(/[)\\]/g, '\\$&');
                    out += `[${escapeMdV2Plain(linkText)}](${safeUrl})`;
                    j = urlEnd + 1;
                    continue;
                }
            }
        }

        // Plain character — escape if special
        out += escapeMdV2Plain(line[j]);
        j++;
    }

    return out;
}

/**
 * Converts standard markdown to Slack mrkdwn.
 * Handles: bold, italic, headings, inline code, code blocks, tables (→ ASCII art).
 */
function markdownToSlackMrkdwn(text: string): string {
    const result: string[] = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];

        // Fenced code block — keep as-is (already ASCII art if table)
        if (line.trimStart().startsWith('```')) {
            const blockLines: string[] = [line];
            i++;
            while (i < lines.length && !lines[i].trim().startsWith('```')) {
                blockLines.push(lines[i]);
                i++;
            }
            blockLines.push('```');
            result.push(blockLines.join('\n'));
            i++;
            continue;
        }

        // Heading → bold
        const headingMatch = line.match(/^#{1,6}\s+(.+)$/);
        if (headingMatch) {
            result.push(`*${headingMatch[1]}*`);
            i++;
            continue;
        }

        // Horizontal rule → divider line
        if (/^[-*_]{3,}$/.test(line.trim())) {
            result.push('─────────────────');
            i++;
            continue;
        }

        // Empty line
        if (line.trim() === '') {
            result.push('');
            i++;
            continue;
        }

        // Regular line — convert inline
        result.push(convertInlineToSlack(line));
        i++;
    }

    return result.join('\n');
}

function convertInlineToSlack(line: string): string {
    // **bold** → *bold*, *italic* → _italic_, [text](url) → <url|text>
    return line
        .replace(/\*\*\*(.+?)\*\*\*/g, '*_$1_*')
        .replace(/\*\*(.+?)\*\*/g, '*$1*')
        .replace(/\*(.+?)\*/g, '_$1_')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');
}

// ─── Public API ───────────────────────────────────────────────────────────────

export type NotificationChannel = 'discord' | 'slack' | 'telegram';

/**
 * Converts markdown result text for a specific notification channel.
 * Tables are always converted to ASCII art code blocks.
 */
export function convertForChannel(text: string, channel: NotificationChannel): string {
    // First: convert tables to ASCII art (applies to all channels)
    const withAsciiTables = tablesToAsciiArt(text);

    switch (channel) {
        case 'discord':
            // Discord supports standard markdown natively in description
            return withAsciiTables;

        case 'slack':
            return markdownToSlackMrkdwn(withAsciiTables);

        case 'telegram':
            return markdownToTelegramV2(withAsciiTables);
    }
}
