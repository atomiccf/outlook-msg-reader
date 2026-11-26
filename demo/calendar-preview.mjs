import ICAL from 'ical.js';

export const maxCalendarPreviewBytes = 1024 * 1024;
const maxEvents = 25;

export function readCalendarPreview(content) {
  if (content.byteLength > maxCalendarPreviewBytes) throw new RangeError('Calendar exceeds 1 MiB');
  const parsed = ICAL.parse(new TextDecoder('utf-8', { fatal: true }).decode(content));
  const calendars = Array.isArray(parsed[0]) ? parsed : [parsed];
  const components = calendars.filter(calendar => calendar[0] === 'vcalendar');
  if (!components.length) throw new Error('Expected an iCalendar file');

  const events = components.flatMap(value => new ICAL.Component(value).getAllSubcomponents('vevent'));
  return { total: events.length, events: events.slice(0, maxEvents).map(readEvent) };
}

function readEvent(component) {
  const event = new ICAL.Event(component, { exceptions: [] });
  const start = component.getFirstProperty('dtstart');
  const end = component.getFirstProperty('dtend');
  const startDate = event.startDate;
  const status = component.getFirstPropertyValue('status');
  return {
    title: event.summary,
    start: formatTime(startDate, start),
    end: formatTime(end ? end.getFirstValue() : endFromStart(event, startDate), end ?? start),
    allDay: startDate?.isDate === true,
    location: event.location,
    description: event.description,
    recurring: event.isRecurring(),
    cancelled: typeof status === 'string' && status.toUpperCase() === 'CANCELLED',
  };
}

function endFromStart(event, start) {
  if (!start) return undefined;
  const duration = event.component.getFirstPropertyValue('duration');
  if (!duration || start.isDate || start.zone === ICAL.Timezone.localTimezone || start.zone === ICAL.Timezone.utcTimezone) {
    return event.endDate;
  }

  const elapsed = duration.hours * 3600 + duration.minutes * 60 + duration.seconds;
  if (elapsed === 0) return event.endDate;

  // Weeks and days are local calendar units. Hours, minutes and seconds are elapsed time.
  const sign = duration.isNegative ? -1 : 1;
  const date = start.clone();
  date.adjust(sign * (7 * duration.weeks + duration.days), 0, 0, 0);
  const endSeconds = date.toUnixTime() + sign * elapsed;
  const utc = ICAL.Time.fromJSDate(new Date(endSeconds * 1000), true);
  const local = utc.convertToZone(start.zone);
  // Use UTC if the local representation cannot identify the same instant.
  return local.toUnixTime() === endSeconds ? local : utc;
}

function formatTime(time, property) {
  if (!(time instanceof ICAL.Time)) return undefined;
  const value = time.toString().replace('T', ' ').replace(/Z$/, ' UTC');
  const tzid = property?.getParameter('tzid');
  return !time.isDate && time.zone !== ICAL.Timezone.utcTimezone && tzid ? `${value} (${tzid})` : value;
}
