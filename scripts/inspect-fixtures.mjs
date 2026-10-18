import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = path.resolve(import.meta.dirname, '..');
const strict = process.argv.includes('--strict');
const positionalArgs = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const fixtureRoot = path.resolve(
  repoRoot,
  positionalArgs[0] ?? 'tests/fixtures/valid/outlook',
);
const reportPath = path.resolve(
  repoRoot,
  positionalArgs[1] ?? 'tests/fixtures/report.html',
);
const discoverMsgFiles = async (directory, relativeTo = directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await discoverMsgFiles(fullPath, relativeTo));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.msg')) {
      files.push(path.relative(relativeTo, fullPath));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
};

let manifest;
let comparisonMode = true;
try {
  manifest = JSON.parse(await readFile(path.join(fixtureRoot, 'manifest.json'), 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  comparisonMode = false;
  const files = await discoverMsgFiles(fixtureRoot);
  manifest = {
    producer: 'Папка без manifest.json',
    fixtures: files.map((file) => ({ id: path.basename(file, path.extname(file)), file, expected: {} })),
  };
}
const { parseMsg } = await import(
  pathToFileURL(path.join(repoRoot, 'dist/index.mjs')).href
);

const escapeHtml = (value = '') => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const recipients = (items = []) => items.length === 0
  ? '<span class="muted">нет</span>'
  : items.map((item) => `${escapeHtml(item.name || '—')} &lt;${escapeHtml(item.email || '—')}&gt;`).join('<br>');

const inspect = (fixture, message) => {
  const checks = [];
  const expected = fixture.expected ?? {};
  const add = (label, expectedValue, actualValue, pass) => checks.push({
    label,
    expected: expectedValue,
    actual: actualValue,
    pass,
  });

  if ('subject' in expected)
    add('Тема', expected.subject, message.subject, message.subject === expected.subject);
  if ('subjectContains' in expected)
    add('Тема содержит', expected.subjectContains, message.subject, message.subject.includes(expected.subjectContains));
  if ('textContains' in expected)
    add('Текст содержит', expected.textContains, message.body.text ?? '', (message.body.text ?? '').includes(expected.textContains));
  if ('htmlContains' in expected)
    add('HTML содержит', expected.htmlContains, message.body.html ?? '', (message.body.html ?? '').includes(expected.htmlContains));
  if ('rtfPresent' in expected)
    add('RTF присутствует', expected.rtfPresent, Boolean(message.body.rtf), Boolean(message.body.rtf) === expected.rtfPresent);
  if ('toCount' in expected)
    add('Получателей To', expected.toCount, message.to.length, message.to.length === expected.toCount);
  if ('ccCount' in expected)
    add('Получателей Cc', expected.ccCount, message.cc?.length ?? 0, (message.cc?.length ?? 0) === expected.ccCount);
  if ('bccCount' in expected)
    add('Получателей Bcc', expected.bccCount, message.bcc?.length ?? 0, (message.bcc?.length ?? 0) === expected.bccCount);
  if ('attachmentCount' in expected)
    add('Вложений', expected.attachmentCount, message.attachments.length, message.attachments.length === expected.attachmentCount);
  if ('attachmentNames' in expected) {
    const actual = message.attachments.map((item) => item.name);
    add('Имена вложений', expected.attachmentNames.join(', '), actual.join(', '), JSON.stringify(actual) === JSON.stringify(expected.attachmentNames));
  }
  if ('attachmentKinds' in expected) {
    const actual = message.attachments.map((item) => item.kind);
    add('Типы вложений', expected.attachmentKinds.join(', '), actual.join(', '), JSON.stringify(actual) === JSON.stringify(expected.attachmentKinds));
  }

  if (Object.keys(expected).length === 0) {
    const recipientCount = message.to.length + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0);
    const hasBodyOrAttachment = Boolean(
      message.body.text
      || message.body.html
      || message.body.rtf
      || message.attachments.length,
    );
    add('Тема извлечена', 'не пустая', message.subject || '∅', Boolean(message.subject));
    add(
      'Отправитель извлечён',
      'имя или адрес',
      message.from.name || message.from.email || '∅',
      Boolean(message.from.name || message.from.email),
    );
    add('Получатель извлечён', 'не менее 1', recipientCount, recipientCount > 0);
    add('Тело или вложение извлечено', 'есть', hasBodyOrAttachment ? 'есть' : '∅', hasBodyOrAttachment);
  }

  return checks;
};

const cards = [];
let passedFiles = 0;
let failedFiles = 0;

for (const fixture of manifest.fixtures) {
  const filePath = path.join(fixtureRoot, fixture.file);
  try {
    const message = await parseMsg(filePath);
    const checks = inspect(fixture, message);
    if (fixture.sha256) {
      const actualSha256 = createHash('sha256').update(await readFile(filePath)).digest('hex');
      checks.unshift({
        label: 'SHA-256',
        expected: fixture.sha256,
        actual: actualSha256,
        pass: actualSha256 === fixture.sha256,
      });
    }
    const hasExpectations = comparisonMode;
    const passed = checks.every((check) => check.pass);
    if (passed) passedFiles += 1;
    else failedFiles += 1;

    const checkRows = checks.length === 0
      ? '<tr><td colspan="4" class="muted">Нет доступных проверок: сравните показанные поля с письмом вручную</td></tr>'
      : checks.map((check) => `
        <tr class="${check.pass ? 'pass' : 'fail'}">
          <td>${check.pass ? '✓' : '✕'}</td>
          <td>${escapeHtml(check.label)}</td>
          <td>${escapeHtml(check.expected)}</td>
          <td>${escapeHtml(check.actual)}</td>
        </tr>`).join('');

    const attachmentRows = message.attachments.length === 0
      ? '<span class="muted">нет</span>'
      : message.attachments.map((item) => {
          if (item.kind === 'embedded-message') {
            return `<span class="attachment">${escapeHtml(item.name)} · ${escapeHtml(item.kind)}</span>`;
          }
          const data = item.content.toString('base64');
          const mime = /^[\w.+-]+\/[\w.+-]+$/.test(item.mime) ? item.mime : 'application/octet-stream';
          return `<a class="attachment" download="${escapeHtml(item.name)}" href="data:${mime};base64,${data}">${escapeHtml(item.name)} · ${escapeHtml(item.kind)} · ${item.content.length} байт</a>`;
        }).join('');

    cards.push(`
      <article class="card ${passed ? 'ok' : 'bad'}">
        <header>
          <div><span class="status">${hasExpectations ? (passed ? 'ПРОЙДЕНО' : 'ОШИБКА') : (passed ? 'ИЗВЛЕЧЕНО' : 'НЕПОЛНО')}</span><h2>${escapeHtml(fixture.id)}</h2></div>
          <code>${escapeHtml(fixture.file)}</code>
        </header>
        <dl>
          <dt>Тема</dt><dd>${escapeHtml(message.subject || '∅')}</dd>
          <dt>От</dt><dd>${recipients([message.from])}</dd>
          <dt>Кому</dt><dd>${recipients(message.to)}</dd>
          <dt>Копия</dt><dd>${recipients(message.cc)}</dd>
          <dt>Скрытая копия</dt><dd>${recipients(message.bcc)}</dd>
        </dl>
        <details open><summary>${hasExpectations ? 'Сравнение с manifest.json' : 'Проверка извлечения'}</summary>
          <table><thead><tr><th></th><th>Поле</th><th>Ожидалось</th><th>Получено</th></tr></thead><tbody>${checkRows}</tbody></table>
        </details>
        <div class="body-grid">
          <details open><summary>Обычный текст</summary><pre>${escapeHtml(message.body.text || '∅')}</pre></details>
          <details><summary>HTML — результат</summary>${message.body.html ? `<iframe sandbox srcdoc="${escapeHtml(message.body.html)}"></iframe>` : '<p class="muted">нет</p>'}</details>
          <details><summary>HTML — исходник</summary><pre>${escapeHtml(message.body.html || '∅')}</pre></details>
          <details><summary>RTF</summary><pre>${escapeHtml(message.body.rtf || '∅')}</pre></details>
        </div>
        <details open><summary>Вложения (${message.attachments.length})</summary><div class="attachments">${attachmentRows}</div></details>
      </article>`);
  } catch (error) {
    failedFiles += 1;
    cards.push(`
      <article class="card bad">
        <header><div><span class="status">НЕ ПРОЧИТАНО</span><h2>${escapeHtml(fixture.id)}</h2></div><code>${escapeHtml(fixture.file)}</code></header>
        <pre class="error">${escapeHtml(error?.stack ?? error)}</pre>
      </article>`);
  }
}

const html = `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>MSG fixtures — визуальная проверка</title>
<style>
:root{color-scheme:light;font:15px/1.45 Inter,Segoe UI,sans-serif;background:#f3f5f8;color:#18202a}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:32px 20px 80px}.hero{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:24px}.hero h1{margin:0;font-size:32px}.summary{display:flex;gap:10px}.pill,.status{border-radius:999px;padding:6px 11px;font-weight:700}.pill{background:#fff;box-shadow:0 2px 8px #0001}.green{color:#087443}.red{color:#b42318}.card{background:white;border:1px solid #d9dee7;border-left:5px solid #1b8f5a;border-radius:12px;padding:20px;margin:16px 0;box-shadow:0 4px 16px #1018280b}.card.bad{border-left-color:#d92d20}.card header{display:flex;justify-content:space-between;gap:16px;align-items:start}.card h2{display:inline;margin:0 0 0 10px;font-size:20px}.status{font-size:11px;background:#e8f7ef;color:#087443}.bad .status{background:#feeceb;color:#b42318}code{font-size:12px;color:#667085}dl{display:grid;grid-template-columns:130px 1fr;gap:6px 12px;padding:14px;background:#f8fafc;border-radius:8px}dt{font-weight:700;color:#475467}dd{margin:0}details{margin-top:14px}summary{cursor:pointer;font-weight:700;padding:7px 0}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px;border-bottom:1px solid #eaecf0;vertical-align:top;max-width:390px;overflow-wrap:anywhere}.pass td:first-child{color:#087443;font-weight:900}.fail{background:#fff3f2}.fail td:first-child{color:#d92d20;font-weight:900}.body-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#101828;color:#f2f4f7;border-radius:8px;padding:14px;max-height:330px;overflow:auto}iframe{width:100%;min-height:220px;border:1px solid #d0d5dd;border-radius:8px;background:white}.attachments{display:flex;flex-wrap:wrap;gap:8px}.attachment{display:inline-block;padding:8px 11px;background:#eef4ff;color:#175cd3;border-radius:7px;text-decoration:none}.muted{color:#98a2b3}.error{background:#7a271a}@media(max-width:760px){.hero,.card header{align-items:start;flex-direction:column}.body-grid{grid-template-columns:1fr}dl{grid-template-columns:1fr}dt{margin-top:6px}}
</style></head><body><main>
<section class="hero"><div><h1>Визуальная проверка MSG</h1><div class="muted">${escapeHtml(fixtureRoot)} · ${escapeHtml(manifest.producer ?? '')}</div></div>
<div class="summary"><span class="pill green">✓ ${passedFiles}</span><span class="pill red">✕ ${failedFiles}</span><span class="pill">Всего ${manifest.fixtures.length}</span></div></section>
${cards.join('\n')}
</main></body></html>`;

await writeFile(reportPath, html, 'utf8');
console.log(`Visual report: ${reportPath}`);
console.log(comparisonMode
  ? `Result: ${passedFiles} passed, ${failedFiles} need attention`
  : `Complete: ${passedFiles}, incomplete or unreadable: ${failedFiles}`);
if (strict && failedFiles > 0) process.exitCode = 1;
