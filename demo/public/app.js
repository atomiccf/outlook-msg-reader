import { parseMessageFile } from '../parse.mjs';
import { maxCalendarPreviewBytes, readCalendarPreview } from '../calendar-preview.mjs';

const elements = {
  intro: document.querySelector('#intro'),
  dropZone: document.querySelector('#drop-zone'),
  fileInput: document.querySelector('#file-input'),
  errorPanel: document.querySelector('#error-panel'),
  errorMessage: document.querySelector('#error-message'),
  message: document.querySelector('#message'),
  openAnother: document.querySelector('#open-another'),
  fileSummary: document.querySelector('#file-summary'),
  subject: document.querySelector('#subject'),
  fromName: document.querySelector('#from-name'),
  fromEmail: document.querySelector('#from-email'),
  sentAt: document.querySelector('#sent-at'),
  recipients: document.querySelector('#recipients'),
  htmlBody: document.querySelector('#html-body'),
  textBody: document.querySelector('#text-body'),
  rtfBody: document.querySelector('#rtf-body'),
  bodyEmpty: document.querySelector('#body-empty'),
  attachments: document.querySelector('#attachments'),
  attachmentCount: document.querySelector('#attachment-count'),
  metadata: document.querySelector('#metadata'),
  headersCard: document.querySelector('#headers-card'),
  transportHeaders: document.querySelector('#transport-headers'),
};

let currentMessage;
let opening = false;
const attachmentUrls = [];

elements.fileInput.addEventListener('change', () => {
  const [file] = elements.fileInput.files;
  if (file) openFile(file);
});

for (const eventName of ['dragenter', 'dragover']) {
  elements.dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    elements.dropZone.classList.add('dragging');
  });
}

for (const eventName of ['dragleave', 'drop']) {
  elements.dropZone.addEventListener(eventName, event => {
    event.preventDefault();
    elements.dropZone.classList.remove('dragging');
  });
}

elements.dropZone.addEventListener('drop', event => {
  const [file] = event.dataTransfer.files;
  if (file) openFile(file);
});

elements.openAnother.addEventListener('click', reset);

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => showBody(tab.dataset.body));
});

async function openFile(file) {
  if (opening) return;
  if (!file.name.toLowerCase().endsWith('.msg')) {
    return showError('Choose a file with the .msg extension.');
  }

  await openMessage(file);
}

async function openMessage(file) {
  if (opening) return;
  opening = true;
  elements.errorPanel.hidden = true;
  try {
    renderMessage(await parseMessageFile(file));
  } catch (error) {
    showError(error instanceof Error ? error.message : 'An unexpected error occurred.');
  } finally {
    opening = false;
    elements.fileInput.value = '';
  }
}

function renderMessage(message) {
  currentMessage = message;
  elements.intro.hidden = true;
  elements.errorPanel.hidden = true;
  elements.message.hidden = false;

  elements.fileSummary.textContent = `${message.fileName} · ${formatBytes(message.fileSize)}`;
  elements.subject.textContent = message.subject || '(No subject)';
  elements.fromName.textContent = message.from.name || message.from.email || 'Unknown sender';
  elements.fromEmail.textContent = message.from.email;
  elements.sentAt.textContent = formatDate(message.metadata.sentAt || message.metadata.receivedAt);

  renderRecipients(message);
  renderAttachments(message.attachments);
  renderMetadata(message.metadata, message.calendar);
  renderBodies(message.body);

  elements.transportHeaders.textContent = message.metadata.transportHeaders || '';
  elements.headersCard.hidden = !message.metadata.transportHeaders;
}

function renderRecipients(message) {
  elements.recipients.replaceChildren();
  addRecipients('To', message.to);
  addRecipients('Cc', message.cc);
  addRecipients('Bcc', message.bcc);
}

function addRecipients(label, recipients) {
  if (!recipients?.length) return;
  const term = document.createElement('dt');
  term.textContent = label;
  const value = document.createElement('dd');
  value.textContent = recipients.map(formatRecipient).join(', ');
  elements.recipients.append(term, value);
}

function renderAttachments(attachments) {
  releaseAttachmentUrls();
  elements.attachments.replaceChildren();
  elements.attachmentCount.textContent = String(attachments.length);
  if (!attachments.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'No attachments';
    elements.attachments.append(empty);
    return;
  }

  for (const attachment of attachments) {
    const item = document.createElement('div');
    item.className = 'attachment-item';
    const downloadable = attachment.kind === 'file';
    const link = document.createElement(downloadable ? 'a' : 'div');
    link.className = 'attachment';
    if (downloadable) {
      const url = URL.createObjectURL(new Blob([attachment.content], { type: 'application/octet-stream' }));
      attachmentUrls.push(url);
      link.href = url;
      link.download = attachment.name;
    }

    const copy = document.createElement('span');
    const name = document.createElement('strong');
    name.textContent = attachment.name;
    const detail = document.createElement('small');
    detail.textContent = attachment.kind === 'embedded-message'
      ? 'Embedded message'
      : `${attachment.mime} · ${formatBytes(attachment.size)}`;
    copy.append(name, detail);
    if (attachment.contentId) {
      const contentId = document.createElement('small');
      contentId.textContent = `Content-ID: ${attachment.contentId}`;
      copy.append(contentId);
    }

    const arrow = document.createElement('span');
    arrow.className = 'download-label';
    arrow.textContent = 'Download';
    link.append(copy);
    if (downloadable) link.append(arrow);
    item.append(link);
    if (downloadable && (/\.ics$/i.test(attachment.name) || /^text\/calendar(?:\s*;|$)/i.test(attachment.mime))) {
      item.append(createCalendarPreview(attachment.content));
    }
    elements.attachments.append(item);
  }
}

function createCalendarPreview(content) {
  const details = document.createElement('details');
  details.className = 'calendar-preview';
  const summary = document.createElement('summary');
  summary.textContent = 'Preview calendar';
  const panel = document.createElement('div');
  details.append(summary, panel);
  details.addEventListener('toggle', () => {
    if (!details.open || panel.hasChildNodes()) return;

    const notice = document.createElement('p');
    notice.className = 'muted';
    if (content.byteLength > maxCalendarPreviewBytes) {
      notice.textContent = 'Preview is available for calendars up to 1 MiB.';
      panel.append(notice);
      return;
    }

    let calendar;
    try {
      calendar = readCalendarPreview(content);
    } catch {
      notice.textContent = 'Could not read this calendar file.';
      panel.append(notice);
      return;
    }

    for (const event of calendar.events) {
      const entry = document.createElement('div');
      entry.className = 'calendar-event';
      const title = document.createElement('strong');
      title.textContent = event.title || 'Untitled event';
      const fields = document.createElement('dl');
      fields.className = 'metadata';
      addMetadata('Starts', event.start, fields);
      addMetadata(event.allDay ? 'Ends before' : 'Ends', event.end, fields);
      addMetadata('Location', event.location, fields);
      if (event.recurring) addMetadata('Repeats', 'Yes', fields);
      if (event.cancelled) addMetadata('Status', 'Cancelled', fields);
      entry.append(title, fields);
      if (event.description) {
        const description = document.createElement('p');
        description.textContent = event.description;
        entry.append(description);
      }
      panel.append(entry);
    }
    if (!calendar.total || calendar.total > calendar.events.length) {
      notice.textContent = calendar.total ? `Showing ${calendar.events.length} of ${calendar.total} events.` : 'No events in this calendar.';
      panel.append(notice);
    }
  });
  return details;
}

function renderMetadata(metadata, calendar) {
  elements.metadata.replaceChildren();
  if (calendar) {
    addMetadata('Message class', calendar.messageClass);
    addMetadata('Starts', calendar.startAt?.toISOString());
    addMetadata('Ends', calendar.endAt?.toISOString());
    addMetadata('Location', calendar.location);
    if (calendar.allDay !== undefined) addMetadata('All day', calendar.allDay ? 'Yes' : 'No');
    if (calendar.isRecurringSeries !== undefined) addMetadata('Recurring series', calendar.isRecurringSeries ? 'Yes' : 'No');
  }
  addMetadata('Importance', metadata.importance);
  addMetadata('Sent', formatDate(metadata.sentAt));
  addMetadata('Received', formatDate(metadata.receivedAt));
  addMetadata('Created', formatDate(metadata.createdAt));
  addMetadata('Modified', formatDate(metadata.modifiedAt));
  addMetadata('Message-ID', metadata.messageId);
  if (!elements.metadata.children.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = 'No metadata available';
    elements.metadata.append(empty);
  }
}

function addMetadata(label, value, list = elements.metadata) {
  if (!value) return;
  const term = document.createElement('dt');
  term.textContent = label;
  const description = document.createElement('dd');
  description.textContent = value;
  list.append(term, description);
}

function renderBodies(body) {
  elements.textBody.textContent = body.text || '';
  elements.rtfBody.textContent = body.rtf || '';
  elements.htmlBody.srcdoc = body.html
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'">${body.html}`
    : '';

  const available = {
    html: Boolean(body.html),
    text: Boolean(body.text),
    rtf: Boolean(body.rtf),
  };
  document.querySelectorAll('.tab').forEach(tab => {
    tab.disabled = !available[tab.dataset.body];
  });
  const first = ['html', 'text', 'rtf'].find(type => available[type]);
  elements.bodyEmpty.hidden = Boolean(first);
  if (first) showBody(first);
  else hideBodies();
}

function showBody(type) {
  if (!currentMessage?.body?.[type]) return;
  elements.htmlBody.hidden = type !== 'html';
  elements.textBody.hidden = type !== 'text';
  elements.rtfBody.hidden = type !== 'rtf';
  document.querySelectorAll('.tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.body === type);
    tab.setAttribute('aria-selected', String(tab.dataset.body === type));
  });
}

function hideBodies() {
  elements.htmlBody.hidden = true;
  elements.textBody.hidden = true;
  elements.rtfBody.hidden = true;
}

function showError(message) {
  elements.message.hidden = true;
  elements.intro.hidden = false;
  elements.errorPanel.hidden = false;
  elements.errorMessage.textContent = message;
}

function reset() {
  releaseAttachmentUrls();
  currentMessage = undefined;
  elements.fileInput.value = '';
  elements.message.hidden = true;
  elements.errorPanel.hidden = true;
  elements.intro.hidden = false;
}

function releaseAttachmentUrls() {
  for (const url of attachmentUrls) URL.revokeObjectURL(url);
  attachmentUrls.length = 0;
}

function formatRecipient(recipient) {
  if (recipient.name && recipient.email) return `${recipient.name} <${recipient.email}>`;
  return recipient.name || recipient.email || '—';
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
