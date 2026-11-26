import { PROPERTY_SET_GUIDS } from '../constants/properties';
import { NamedPropertyDecodeError } from '../mapi/NamedPropertyReader';
import type { PropertyStore } from '../mapi/PropertyStore';
import type { PropertyStreamReader } from '../mapi/PropertyStreamReader';
import type { MsgCalendar, MsgDiagnostic } from '../types';

const APPOINTMENT = PROPERTY_SET_GUIDS.PS_APPOINTMENT;
const MEETING = '{6ED8DA90-450B-101B-98DA-00AA003F1305}';
const CALENDAR_CLASS = /^(?:IPM\.Appointment(?:\..+)?|IPM\.Schedule\.Meeting\.(?:Request|Canceled|Resp\..+))$/i;

export class CalendarReader {
  constructor(
    private readonly properties: PropertyStore,
    private readonly propertyStream: PropertyStreamReader,
  ) {}

  async read(reportDiagnostic: (diagnostic: MsgDiagnostic) => void): Promise<MsgCalendar | undefined> {
    const stringTypes = ['001F', '001E'];
    const messageClass = (await this.properties.readString(['001A'], stringTypes))?.trim();
    if (!messageClass || !CALENDAR_CLASS.test(messageClass)) return undefined;

    const namedIds = await Promise.all([
      this.properties.resolveNamedPropertyId(APPOINTMENT, 0x820D),
      this.properties.resolveNamedPropertyId(APPOINTMENT, 0x820E),
      this.properties.resolveNamedPropertyId(APPOINTMENT, 0x8208),
      this.properties.resolveNamedPropertyId(MEETING, 0x0002),
      this.properties.resolveNamedPropertyId(APPOINTMENT, 0x8215),
      this.properties.resolveNamedPropertyId(APPOINTMENT, 0x8223),
    ]).catch((error: unknown) => {
      if (!(error instanceof NamedPropertyDecodeError)) throw error;
      reportDiagnostic({ code: 'CALENDAR_DECODE_FAILED', message: 'Unable to decode calendar named properties' });
      return [];
    });

    const [startId, endId, locationId, whereId, allDayId, recurringId] = namedIds;
    const root = this.properties.getRootStorage();
    const [startAt, endAt, location, allDay, isRecurringSeries] = await Promise.all([
      this.propertyStream.readTime(root, startId ? [startId, '0060'] : ['0060']),
      this.propertyStream.readTime(root, endId ? [endId, '0061'] : ['0061']),
      this.properties.readString([locationId, whereId].filter(id => id !== undefined), stringTypes),
      allDayId ? this.propertyStream.readBoolean(root, [allDayId]) : undefined,
      recurringId ? this.propertyStream.readBoolean(root, [recurringId]) : undefined,
    ]);

    return {
      messageClass,
      ...(startAt ? { startAt } : {}),
      ...(endAt ? { endAt } : {}),
      ...(location ? { location: location.trim() } : {}),
      ...(allDay !== undefined ? { allDay } : {}),
      ...(isRecurringSeries !== undefined ? { isRecurringSeries } : {}),
    };
  }
}
