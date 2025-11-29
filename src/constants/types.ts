export type PropertyId = string;
export type PropertyName = string;

// Интерфейс для маппинга свойств
export interface IPropertyMapping {
    [key: string]: PropertyName;
}

// Интерфейс для разобранных свойств сообщения
export interface IMessageProperties {
    // 📧 Тело сообщения
    body?: string;
    bodyHtml?: string;
    bodyRtfCompressed?: Buffer;
    nativeBody?: string;
    bodyContentLocation?: string;
    bodyContentId?: string;

    senderName?: string;
    senderEmail?: string;
    senderAddressType?: string;
    originalSenderName?: string;
    originalSenderEmail?: string;
    senderType?: number;

    subject?: string;
    subjectPrefix?: string;
    normalizedSubject?: string;
    conversationTopic?: string;

    clientSubmitTime?: Date;
    creationTime?: Date;
    lastModificationTime?: Date;
    messageDeliveryTime?: Date;

    // 🔖 Идентификация
    messageClass?: string;
    internetMessageId?: string;
    inReplyToId?: string;
    entryId?: Buffer;
    recordKey?: Buffer;

    // 📎 Вложения
    attachmentData?: Buffer;
    extension?: string;
    fileNameShort?: string;
    attachmentMethod?: number;
    fileName?: string;
    mimeType?: string;
    contentId?: string;
    attachmentSize?: number;
    attachmentNumber?: number;

    // 👥 Получатели
    displayName?: string;
    recipientName?: string;
    recipientEmail?: string;
    displayTo?: string;
    displayCc?: string;
    displayBcc?: string;
    recipientType?: number;

    // 🎯 Статус и важность
    importance?: number;
    priority?: number;
    sensitivity?: number;
    messageFlags?: number;
    readReceiptRequested?: boolean;
    deliveryReceiptRequested?: boolean;
    isRead?: boolean;

    // 🌐 Интернет-заголовки
    headers?: string;
    internetCodepage?: number;
    messageCodepage?: number;
    contentTransferEncoding?: string;
    messageLocaleId?: number;

    // 📊 Дополнительные свойства
    messageSize?: number;
    receivedByEmail?: string;
    receivedByAddressType?: string;
    receivedByName?: string;
    accessLevel?: number;
    flagStatus?: number;

    // 🔐 Безопасность
    security?: number;
    messageToMe?: boolean;
    messageCcMe?: boolean;
    messageRecipMe?: boolean;
}

// Enum для важности сообщения
export enum MessageImportance {
    LOW = 0,
    NORMAL = 1,
    HIGH = 2
}

// Enum для чувствительности
export enum MessageSensitivity {
    NORMAL = 0,
    PERSONAL = 1,
    PRIVATE = 2,
    CONFIDENTIAL = 3
}

// Enum для типов получателей
export enum RecipientType {
    TO = 1,
    CC = 2,
    BCC = 3
}

/**
 * Named property entry types
 */
export enum NamedPropertyKind {
    NUMERIC = 0x0000,
    STRING = 0x0001
}

/**
 * Named property entry structure
 */
export interface NamedPropertyEntry {
    propertyId: number;  // The mapped property ID (0x8000-0xFFFF range)
    guidIndex: number;   // Index into GUID table
    nameIndex: number;   // Index into name/ID table
    kind: NamedPropertyKind;
}

/**
 * Named property mapping result
 */
export interface NamedPropertyMapping {
    guid: string;        // GUID as string
    name?: string;       // Property name (if string-based)
    numericId?: number;  // Property numeric ID (if numeric-based)
    propertyId: number;  // The actual property ID to use in __substg1.0_<ID><TYPE>
}