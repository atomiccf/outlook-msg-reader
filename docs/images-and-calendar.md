# Извлечение изображений и календарных данных из Outlook MSG

Первая версия дополняет API `outlook-msg-reader`. Изображения выдаются через существующие методы чтения вложений. Календарные свойства Outlook доступны и при полном разборе `.msg`, и отдельно, без чтения тела письма и содержимого вложений.

## Изображения

- Обычные изображения уже доступны в `attachments`. Для файлов с указанным Outlook типом `image/*` достаточно фильтра по `kind === 'file'` и `mime`. Если Outlook не записал MIME-тип, действует существующий запасной тип `application/octet-stream`.
- Добавить опциональный `contentId?: string` в `MsgAttachmentInfo`. Для файлового вложения брать его из `PidTagAttachContentId` (`0x3712`), сначала Unicode, затем ANSI. Обрезать пробелы по краям и снять одну пару внешних угловых скобок. Пустое значение опустить, регистр сохранить. Один и тот же `contentId` доступен через `parseMsg()`, `getAttachments()`, `getAttachmentInfos()` и `openAttachment(index)`. [PidTagAttachContentId](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidtagattachcontentid-canonical-property)
- Для картинки внутри письма потребитель сопоставляет `cid:` из HTML с `contentId` файлового вложения того же сообщения. Байты читаются из вложения по его `index`. `getAttachmentInfos()` позволяет найти нужный индекс до чтения байтов. Библиотека возвращает исходный HTML и локальные байты вложений.

## Календарные данные

Предлагаемый публичный контракт

```ts
export interface MsgCalendar {
  messageClass: string;
  startAt?: Date;
  endAt?: Date;
  location?: string;
  allDay?: boolean;
  isRecurringSeries?: boolean;
}

// Дополнения к существующим типам
// Msg.calendar?: MsgCalendar
// MsgReader.getCalendar(): Promise<MsgCalendar | undefined>
```

Читать `PidTagMessageClass` (`0x001A`) как Unicode или ANSI. Распознавать `IPM.Appointment` и его подклассы, `IPM.Schedule.Meeting.Request`, `IPM.Schedule.Meeting.Canceled` и `IPM.Schedule.Meeting.Resp.*`. Сравнивать классы без учёта регистра и возвращать исходное значение после обрезки пробелов. Для распознанного класса достаточно одного `messageClass`. В остальных случаях `getCalendar()` возвращает `undefined`, а ключ `calendar` отсутствует в результате `parseMsg()`. Файлы `.ics` из обычных писем доступны как вложения с исходными байтами. [Классы сообщений Outlook](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxprops/183b7080-abbe-4b25-bb5c-160397282de8)

| Поле | Источник и порядок чтения |
| --- | --- |
| `startAt` | `PidLidAppointmentStartWhole` (`0x820D`), затем `PidTagStartDate` (`0x0060`). [Именованное свойство](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/1c5c5d15-9660-4a56-844b-5e854e24ca16) · [Резервное свойство](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/cdb8a9c8-fd20-4140-af84-6ddf26cbb4c9) |
| `endAt` | `PidLidAppointmentEndWhole` (`0x820E`), затем `PidTagEndDate` (`0x0061`). [Именованное свойство](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/9df011d7-4df9-4663-9b65-00323dc0ac90) · [Резервное свойство](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/009cf868-7bdc-4b8b-8b15-2ee7ca001df3) |
| `location` | `PidLidLocation` (`0x8208`), затем `PidLidWhere` (`0x0002` в `PSETID_Meeting`). [PidLidLocation](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxprops/4698837e-3bbc-40a6-8349-55393603a01a) · [MS-OXPROPS, PidLidWhere](https://officeprotocoldoc.z19.web.core.windows.net/files/MS-OXPROPS/%5BMS-OXPROPS%5D.pdf) |
| `allDay` | `PidLidAppointmentSubType` (`0x8215`). [PidLidAppointmentSubType](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxprops/baa95619-e410-40d9-b02b-b78f02de564f) |
| `isRecurringSeries` | `PidLidRecurring` (`0x8223`). Описывает саму серию. [PidLidRecurring](https://learn.microsoft.com/en-us/office/client-developer/outlook/mapi/pidlidrecurring-canonical-property) |

Основные именованные свойства в таблице относятся к `PSETID_Appointment` (`{00062002-0000-0000-C000-000000000046}`). `PSETID_Meeting` имеет GUID `{6ED8DA90-450B-101B-98DA-00AA003F1305}`. Получать локальные идентификаторы из таблицы `NameID` по паре GUID и LID.

Даты читать из `PtypTime` и преобразовывать из FILETIME в JavaScript `Date` с точностью до миллисекунд. Пропускать нулевые и недопустимые даты. Для повторяющейся серии начало и конец относятся к первому экземпляру. Для событий на весь день `allDay` передаёт флаг Outlook, а `startAt` и `endAt` передают сохранённые значения. Восстановление локальной календарной даты для плавающих событий требует правил часового пояса Outlook и выходит за рамки извлечения этих полей. [Интерпретация плавающих событий](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxocal/9f92d82e-5d8a-46a2-ad29-4bc6f0993e1f)

Место читать как Unicode или ANSI. Пустое после обрезки значение допускает переход к резервному свойству. Булевы флаги читать как `PtypBoolean` и сохранять явное `false`. Отсутствующее поле или поле другого типа пропускать, сохраняя остальные данные. Тема и участники доступны в обычных полях `Msg`.

## Задачи реализации

Задачи 1, 2 и 10 по изображениям можно выполнять независимо от календаря. Задачи 3 и 5 по календарю тоже независимы друг от друга.

1. **Прочитать и вернуть `contentId`.** Добавить поле в `MsgAttachmentInfo` и заполнить его в общей записи файлового вложения. Проверить Unicode, ANSI, нормализацию и пустое значение. В четырёх API возвращается одинаковый идентификатор. [Типы](../src/types.ts) · [AttachmentReader](../src/msg/AttachmentReader.ts)
2. **Учесть `contentId` в лимите результата.** После задачи 1 добавить его UTF-8 размер в предварительный расчёт `maxResultBytes` для буферизованных вложений. Если лимит на один байт меньше размера результата `getAttachments()`, метод выбрасывает ошибку до чтения содержимого. При точном лимите результат помещается без двойного подсчёта. [AttachmentReader](../src/msg/AttachmentReader.ts) · [Тесты лимитов](../tests/resultLimits.test.ts)
3. **Исправить разбор `NameID`.** После LID или смещения строки читать два байта с индексом GUID и младшим битом kind, затем два байта с индексом свойства. Локальный ID равен `0x8000 + propertyIndex`. Заменить тестовые записи, повторяющие прежний порядок полей, и проверить числовое и строковое имена на байтах по Microsoft. [NamedPropertyReader](../src/mapi/NamedPropertyReader.ts) · [Пример MS-OXMSG](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxmsg/9e984a31-e32d-4e8f-bb92-93bd2df6cd12)
4. **Подключить чтение именованных значений.** После задачи 3 переиспользовать разрешение GUID и LID в `PropertyStore`. Строки читать через существующий механизм переменных свойств, даты и флаги через `PropertyStreamReader` с проверкой MAPI-типа. Тест должен подтвердить, что корневое и вложенное сообщения получают собственные значения по одной таблице имён. [PropertyStore](../src/mapi/PropertyStore.ts) · [PropertyStreamReader](../src/mapi/PropertyStreamReader.ts) · [Область NameID по MS-OXMSG](https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxmsg/81159dd0-649e-4491-b216-877008b23f65)
5. **Распознать класс календарного сообщения.** Начать календарный reader с чтения `0x001A`. Проверить поддерживаемые классы, регистр и подкласс `IPM.Appointment`. Обычное письмо даёт `undefined` без чтения `NameID`, а распознанное сообщение с пустым набором полей даёт объект с `messageClass`.
6. **Собрать поля календаря.** После задач 4 и 5 реализовать даты, место и флаги по таблице выше. Проверить приоритет именованных свойств, переход к резервным, нулевую дату, неверный тип и явный `false`.
7. **Обработать повреждённые записи `NameID`.** После задачи 6 добавить `CALENDAR_DECODE_FAILED` в публичное объединение `MsgDiagnostic['code']`. При целых CFBF-потоках сохранить класс и доступные даты из обычных тегов, сообщив одну диагностику. Тесты отдельно проверяют, что ошибка CFBF или ввода-вывода, превышение лимита и отмена прерывают чтение. [Типы](../src/types.ts) · [Тесты диагностик](../tests/diagnostics.test.ts)
8. **Подключить публичный API календаря.** После задачи 7 подключить reader в фабрике с сохранением совместимости конструктора, добавить `getCalendar()` и использовать его при полном разборе, включая вложенные сообщения. Экспортировать `MsgCalendar`. Проверить, что отдельный вызов не читает тело и вложения, диагностика доступна через оба API, а календарные строки входят в `maxResultBytes` полного результата. [createMessageReader](../src/msg/createMessageReader.ts) · [MsgReader](../src/msg/MsgReader.ts) · [Публичные экспорты](../src/index.ts)
9. **Проверить календарь на файлах.** После задачи 8 добавить календарные файлы из списка ниже. Записать происхождение, SHA-256 и ожидаемые поля в manifest. Проверить оба публичных API и обычное письмо с `.ics`, которое выдаётся исходными байтами. [Manifest](../tests/fixtures/valid/outlook/manifest.json) · [Сквозные тесты](../tests/realFixtures.test.ts)
10. **Проверить изображения на файле.** После задачи 2 добавить письмо с обычной и встроенной картинкой. Записать происхождение, SHA-256 и ожидаемые свойства в manifest. Проверить порядок, индексы, байты и совпадение `cid:` из HTML с `contentId` вложения. [Сквозные тесты](../tests/realFixtures.test.ts)
11. **Обновить README и прогнать проверки.** После задач 9 и 10 показать чтение `contentId` и `getCalendar()`, описать даты событий на весь день и поведение `.ics`. Запустить `npm run typecheck`, `npm test` и `npm run build`. [README](../README.md)

## Тестовые файлы календаря

- **local-recurring-invitation.msg** — сгенерированное приглашение `IPM.Schedule.Meeting.Request` с именованными датами и флагом `isRecurringSeries: true`.
- **local-appointment.msg** — сгенерированная встреча `IPM.Appointment`. Даты начала и окончания доступны только через `NameID`.

## Критерии приёмки

| Сценарий | Проверяемый результат |
| --- | --- |
| Письмо Outlook с обычной картинкой и картинкой `cid:` | Для обоих файлов совпадают исходные байты, порядок и индексы. CID совпадает во всех четырёх API вложений. Пустой CID опускается. Список метаданных не читает потоки содержимого. |
| Outlook `.msg` с приглашением | `parseMsg().calendar` и отдельный `getCalendar()` возвращают одинаковый класс, даты и место. Для именованных полей fixture использует локальные ID, отличные от LID. Отдельный вызов не читает тело и вложения. |
| Календарные варианты | Проверить распознавание встречи, приглашения, отмены и ответа. Покрыть `allDay: true`, явное `false`, флаг серии, отсутствие полей, приоритет именованных дат и переход к обычным тегам. Вложенное сообщение читает собственные значения с общей таблицей имён. |
| Обычное письмо с вложением `.ics` | Вложение выдаётся побайтово, поле `calendar` отсутствует, `NameID` для календаря не читается. |
| Повреждённая таблица имён и лимиты | Ошибка разбора `NameID` оставляет читаемые данные и одну диагностику. Отмена и структурные ошибки доходят до вызывающего кода. Добавленные строки учитываются в `maxResultBytes`. |

Варианты свойств, которых нет в выбранных календарных файлах, покрываются небольшими unit-тестами.
