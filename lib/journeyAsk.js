import { sectionsOf } from './journeyMap.js';
import { MONTHS, costLabel, daysLabel } from './journeyKit.js';

/**
 * A journey as the model reads it when answering a reader's question:
 * everything the page says, in order and numbered by section, with places
 * kept as tokens so an answer can point at them the way the journal does.
 * Photo searches and other machinery are left out.
 */
export function journalContext(doc) {
  const places = doc.places || [];
  const secs = sectionsOf(doc.blocks);
  const sectionAt = new Map(secs.map((sec, k) => [sec.start, k]));
  const body = [];
  (doc.blocks || []).forEach((b, i) => {
    const k = sectionAt.get(i);
    if (k !== undefined && (b.type === 'heading' || (b.type === 'prose' && b.kicker))) {
      body.push('', `Section ${k + 1}: ${[secs[k].kicker, secs[k].title].filter(Boolean).join(' — ')}`);
      if (b.type === 'heading') return;
    }
    if (b.type === 'prose') body.push(b.text);
    else if (b.type === 'quote') body.push(`"${b.text}"`);
    else if (b.type === 'tip' || b.type === 'detour' || b.type === 'skip') {
      const kind = { tip: 'Tip', detour: 'Detour', skip: 'Skip' }[b.type];
      const name = b.label || b.title;
      body.push(`[${kind}${name ? `: ${name}` : ''}] ${b.text}`);
    } else if (b.type === 'day') {
      body.push(`[${b.title || 'A day'}] ${(b.items || []).map((it) => `${it.time} ${it.text}`).join('; ')}`);
    } else if (b.type === 'video' && b.video) {
      body.push(`[Video: ${b.video.title}]`);
    }
  });
  const best = ((doc.months && doc.months.best) || []).map((m) => MONTHS[m - 1]).filter(Boolean).join(', ');
  return [
    `Journey: ${doc.title} — ${doc.place}, ${doc.country}`,
    `Length: ${daysLabel(doc)}. Pace: ${doc.pace}. Budget: ${costLabel(doc)}.`,
    best ? `Best months: ${best}.` : null,
    `Timing: ${doc.when}`,
    doc.checked ? `Checked against current information on ${doc.checked}.` : null,
    '',
    'Places, by token:',
    ...places.map((p) => `{${p.id}} ${p.name}${p.address ? ` (${p.address})` : ''}: ${p.note}`),
    '',
    `Opening: ${doc.lede}`,
    ...body,
    ...((doc.know || []).length ? ['', 'Good to know:', ...doc.know.map((k) => `- ${k.label}: ${k.text}`)] : []),
  ].filter((line) => line !== null).join('\n').slice(0, 40000);
}
