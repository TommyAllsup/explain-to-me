#!/usr/bin/env python3
"""Render this repository's ROADMAP.md as a self-contained local HTML reader.

This intentionally supports the Markdown subset used by ROADMAP.md, not arbitrary
Markdown. Run from any directory; no dependencies or network access are needed.
"""
import argparse
from datetime import date
import hashlib
from html import escape
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
TOKEN = re.compile(r'(\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*)')


def inline(text):
    result = []
    for part in TOKEN.split(text):
        if part.startswith('[') and '](' in part and part.endswith(')'):
            label, href = part[1:-1].split('](', 1)
            if not href.startswith(('https://', 'http://', '#')):
                href = '../../' + href
            result.append(f'<a href="{escape(href, quote=True)}">{inline(label)}</a>')
        elif part.startswith('`') and part.endswith('`'):
            result.append(f'<code>{escape(part[1:-1])}</code>')
        elif part.startswith('**') and part.endswith('**'):
            result.append(f'<strong>{inline(part[2:-2])}</strong>')
        else:
            result.append(escape(part))
    return ''.join(result)


def markdown(text):
    output, paragraph, items, quote = [], [], [], []

    def flush():
        if paragraph:
            output.append('<p>' + inline(' '.join(paragraph)) + '</p>')
            paragraph.clear()
        if items:
            output.append('<ul>' + ''.join(f'<li>{inline(item)}</li>' for item in items) + '</ul>')
            items.clear()
        if quote:
            output.append('<blockquote>' + inline(' '.join(quote)) + '</blockquote>')
            quote.clear()

    for line in text.splitlines():
        line = line.strip()
        if not line:
            flush()
        elif line.startswith('- '):
            if paragraph or quote:
                flush()
            items.append(line[2:])
        elif line.startswith('> '):
            if paragraph or items:
                flush()
            quote.append(line[2:])
        elif line.startswith('#'):
            flush()
            heading = re.match(r'^(#{1,6})\s+(.+)$', line)
            if not heading:
                raise ValueError(f'Unsupported heading: {line}')
            level = min(4, len(heading[1]))
            output.append(f'<h{level}>{inline(heading[2])}</h{level}>')
        else:
            if items or quote:
                flush()
            paragraph.append(line)
    flush()
    return '\n'.join(output)


def render(snapshot_date):
    source = (ROOT / 'ROADMAP.md').read_text(encoding='utf-8')
    pieces = re.split(r'^## (.+)\n', source, flags=re.M)
    preamble = pieces[0]
    sections = [(pieces[i], pieces[i + 1].strip()) for i in range(1, len(pieces), 2)]

    def select(prefix):
        return next((pair for pair in sections if pair[0].startswith(prefix)), None)

    current = select('Current release:')
    sequence = select('Proposed sequence after')
    next_scope = select('Next: ')
    next_slice = select('Next implementation slice')
    definition = select('What 1.0 means')
    if not all((current, sequence, next_scope, next_slice, definition)):
        raise ValueError('ROADMAP.md must include current release, next scope, proposed sequence, next slice, and 1.0 definition.')
    current_version = re.search(r'v[0-9]+\.[0-9]+(?:\.[0-9]+)?', current[0]).group()
    current_minor = '.'.join(current_version[1:].split('.')[:2])
    goal = re.search(r'^\*\*Goal:\*\* (.+)$', preamble, re.M)
    architecture = '\n\n'.join(line for line in preamble.splitlines() if line.startswith(('**Architecture:', '**Tech stack:')))
    baseline = re.search(r'^\*\*Baseline:\*\* (.+)$', preamble, re.M)
    future_milestones = re.split(r'^### (.+)\n', sequence[1], flags=re.M)
    milestones = [future_milestones[0], next_scope[0][len('Next: '):], next_scope[1]] + future_milestones[1:]
    if milestones[0].strip():
        sequence_intro = markdown(milestones[0])
    else:
        sequence_intro = ''
    headings = [re.match(r'([0-9]+\.[0-9]+)\s+[—–-]\s+(.+)', milestones[i]) for i in range(1, len(milestones), 2)]
    future = next((h for h in headings if h and tuple(map(int, h[1].split('.'))) > tuple(map(int, current_minor.split('.')))), None)
    if not future:
        raise ValueError('No next milestone found after current release')
    next_version, next_title = future.groups()
    articles, nav = [], []
    for i in range(1, len(milestones), 2):
        match = re.match(r'([0-9]+\.[0-9]+)\s+[—–-]\s+(.+)', milestones[i])
        if not match:
            raise ValueError(f'Unsupported milestone heading: {milestones[i]}')
        version, title = match.groups()
        body = milestones[i + 1].strip()
        outcome = re.search(r'^\*\*Outcome:\*\* (.+)$', body, re.M)
        summary = outcome[1] if outcome else 'Demonstrate the stable local workflow against the release gates.'
        body = re.sub(r'^\*\*Outcome:\*\* .+\n?', '', body, count=1, flags=re.M).strip()
        label = 'Released' if version == current_minor else 'Next · scoped product work' if version == next_version else 'Stable release gates' if version == '1.0' else 'Proposed · sequencing may change'
        opened = ' open' if version in (next_version, '1.0') else ''
        nav.append(f'<a href="#v{version}">{version}</a>')
        articles.append(f'<article class="milestone" id="v{version}"><div class="version">{version}</div><div><div class="eyebrow">{label}</div><h2>{inline(title)}</h2><p class="outcome">{inline(summary)}</p><details{opened}><summary>Scope and acceptance criteria</summary>{markdown(body)}</details></div></article>')
    consumed = {current[0], sequence[0], next_scope[0], next_slice[0], definition[0]}
    additional = ''.join(f'<section class="reference"><h2>{inline(title)}</h2>{markdown(body)}</section>' for title, body in sections if title not in consumed)
    digest = hashlib.sha256((ROOT / 'ROADMAP.md').read_bytes()).hexdigest()
    page = '''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Explain-to-Me · Roadmap to 1.0</title>
<meta name="description" content="Explain-to-Me's current release, next product milestone, and proposed path to a dependable 1.0.">
<style>
:root{color-scheme:light;--bg:#f6f7f8;--ink:#20282c;--muted:#5f6b72;--accent:#176b54;--line:#dbe2df}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,sans-serif}main{max-width:1080px;margin:auto;padding:64px 28px}header{padding-bottom:36px;border-bottom:1px solid var(--line)}.eyebrow{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--accent);font-weight:700}h1{font-size:clamp(38px,6vw,70px);line-height:1.08;letter-spacing:-.055em;margin:18px 0 24px}h2{font-size:25px;line-height:1.25;letter-spacing:-.025em;margin:8px 0 12px}h3{font-size:20px;margin:22px 0 12px}.lead{font-size:21px;max-width:850px;color:var(--muted)}.pills{display:flex;gap:10px;flex-wrap:wrap;margin-top:26px}.pill{padding:6px 13px;border-radius:999px;background:#e5ece8;color:#244c3c;font-size:13px}.next{background:#202f2a;color:#fff;padding:28px 32px;border-radius:18px;margin:32px 0}.next p{color:#d6e5dd}.next .eyebrow{color:#b8d8c5}.next p:last-child{margin-bottom:0}.current,.definition{padding:26px 0;border-bottom:1px solid var(--line)}nav{display:flex;flex-wrap:wrap;gap:12px;padding:24px 0}nav a{color:var(--accent);text-decoration:none;padding:5px 10px;border-bottom:2px solid var(--line)}a{color:var(--accent);overflow-wrap:anywhere}a:focus-visible,summary:focus-visible,button:focus-visible{outline:3px solid #176b54;outline-offset:4px}.milestone{display:grid;grid-template-columns:94px 1fr;gap:26px;padding:32px 0;border-top:1px solid var(--line);scroll-margin-top:24px}.version{font-size:32px;letter-spacing:-.06em;color:var(--accent);font-weight:700}.outcome{font-size:18px;color:var(--muted);margin:0 0 18px}details{background:white;border:1px solid #e6ebe7;border-radius:12px;padding:16px 22px}summary{cursor:pointer;font-weight:600}details p{margin:14px 0}li{margin:8px 0}ul{padding-left:23px}.references{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:40px}.reference{border-top:3px solid var(--line);padding-top:24px}.reference:first-child{grid-column:1/-1}footer{margin-top:44px;border-top:1px solid var(--line);padding-top:20px;font-size:13px;color:var(--muted)}button{font:inherit;color:var(--accent);background:white;border:1px solid var(--line);border-radius:8px;padding:9px 14px;cursor:pointer}.tools{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}code{font-size:.88em;overflow-wrap:anywhere}blockquote{border-left:3px solid var(--line);margin:18px 0;padding:4px 18px;color:var(--muted)}.skip{position:absolute;top:-80px;left:20px;background:white;padding:10px;z-index:2}.skip:focus{top:10px}.source{font-size:14px;color:var(--muted)}@media(max-width:600px){main{padding:32px 20px}.milestone{grid-template-columns:1fr;gap:8px}.version{font-size:26px}.references{grid-template-columns:1fr}.next{padding:24px}details{padding:14px 16px}.lead{font-size:19px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}@media print{body{background:white}main{padding:0}.tools,nav,.skip{display:none}.milestone{break-inside:avoid}h1{font-size:42px}.references{display:block}.reference{margin-top:24px}}
</style></head><body><a class="skip" href="#milestones">Skip to milestones</a><main>
'''
    page += f'<header><div class="eyebrow">Explain-to-Me / Product roadmap</div><h1>A dependable explainer workflow.<br>From {escape(current_version[1:])} to 1.0.</h1><p class="lead">{inline(goal[1] if goal else "A dependable local explainer workflow.")}</p><div class="pills"><span class="pill">Current release · {escape(current_version)}</span><span class="pill">macOS + Windows 11 x64</span><span class="pill">Next · {escape(next_version)}</span><span class="pill">Later scope · Proposed</span></div><p class="source">Reviewed {escape(snapshot_date)} · <a href="../../ROADMAP.md">Canonical ROADMAP.md</a> · No committed dates</p></header>'
    page += f'<section class="next"><div class="eyebrow">Next recommended slice / {escape(next_version)}</div><h2>{inline(next_title)}</h2>{markdown(next_slice[1])}</section>'
    page += f'<section class="current"><h2>{inline(current[0])}</h2>{markdown(current[1])}</section>'
    page += f'<section class="definition"><h2>{inline(definition[0])}</h2>{markdown(definition[1])}<details><summary>Architecture we are keeping</summary>{markdown(architecture)}</details></section>'
    page += '<nav aria-label="Release milestones">' + ''.join(nav) + '</nav><div class="tools"><button type="button" id="expand">Expand all scopes</button><button type="button" id="collapse">Collapse all scopes</button><button type="button" id="print">Print / save PDF</button></div>'
    page += '<section id="milestones" aria-label="Release sequence">' + sequence_intro + ''.join(articles) + '</section>'
    page += f'<div class="references">{additional}</div><footer>Generated from <a href="../../ROADMAP.md">ROADMAP.md</a> · Snapshot {escape(snapshot_date)} · Source SHA-256 <code>{digest}</code>.<br>{inline("Baseline: " + (baseline[1] if baseline else "v0.2.1"))}<br>Refresh with <code>python3 scripts/render-roadmap.py</code>. Later milestones remain proposed. Tag 1.0 when the release gates are demonstrated.</footer>'
    page += '''</main><script>
const scopes = [...document.querySelectorAll('details')];
document.getElementById('expand').addEventListener('click', () => scopes.forEach(d => d.open = true));
document.getElementById('collapse').addEventListener('click', () => scopes.forEach(d => d.open = false));
document.getElementById('print').addEventListener('click', () => window.print());
let previousOpen;
window.addEventListener('beforeprint', () => { previousOpen = scopes.map(d => d.open); scopes.forEach(d => d.open = true); });
window.addEventListener('afterprint', () => { if (previousOpen) scopes.forEach((d, i) => d.open = previousOpen[i]); });
</script></body></html>'''
    target = ROOT / 'out/roadmap/roadmap-to-1.0.html'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(page, encoding='utf-8')
    print(target)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--date', default=date.today().isoformat(), help='Snapshot date (YYYY-MM-DD)')
    args = parser.parse_args()
    date.fromisoformat(args.date)
    render(args.date)
