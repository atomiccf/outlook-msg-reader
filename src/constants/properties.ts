import {IPropertyMapping} from "./types";

/**
 * MSG Property Constants and Utilities
 * 
 * This module provides constants and helper functions for working with MSG file properties.
 * 
 * @example Basic usage - reading a property by name:
 * ```typescript
 * import { buildPropertyPathsByNameWithFallback, PROPERTY_TYPES } from './constants/properties';
 * 
 * // Get subject with fallback to ANSI if UNICODE not available
 * const paths = buildPropertyPathsByNameWithFallback('subject');
 * for (const path of paths) {
 *     const value = await propertyReader.readUnicodeString(path);
 *     if (value) break;
 * }
 * ```
 * 
 * @example Using property ID directly:
 * ```typescript
 * import { buildPropertyPath, PROPERTY_TYPES } from './constants/properties';
 * 
 * // Read body as UNICODE
 * const path = buildPropertyPath('1000', PROPERTY_TYPES.UNICODE);
 * const body = await propertyReader.readUnicodeString(path);
 * ```
 * 
 * @example Reading binary property:
 * ```typescript
 * import { buildPropertyPathByName, PROPERTY_TYPES } from './constants/properties';
 * 
 * // Read RTF compressed body
 * const path = buildPropertyPathByName('bodyRtfCompressed', PROPERTY_TYPES.BINARY);
 * if (path) {
 *     const rtf = await propertyReader.readBinary(path);
 * }
 * ```
 */

// Property type constants
export const PROPERTY_TYPES = {
    UNICODE: '001F',      // UTF-16 string
    ANSI: '001E',         // ANSI string (codepage-dependent)
    BINARY: '0102',       // Binary data
    INT32: '0003',        // 32-bit integer
    INT64: '0014',        // 64-bit integer
    DATETIME: '0040',     // Date/time
    BOOLEAN: '000B'       // Boolean
} as const;

export const PROPERTY_MAPPING: IPropertyMapping = {
    // Message body
    '1000': 'body',
    '1013': 'bodyHtml',
    '1009': 'bodyRtfCompressed',
    '1017': 'nativeBody',
    '1008': 'bodyContentLocation',
    '1014': 'bodyContentId',

    // Sender
    '0c1a': 'senderName',
    '0c1f': 'senderEmail',
    '0c1e': 'senderAddressType',
    '5d02': 'sentRepresentingSmtpAddress',
    '5d01': 'senderSmtpAddress',
    '0c12': 'senderType',

    // Subject
    '0037': 'subject',
    '003b': 'subjectPrefix',
    '0e1d': 'normalizedSubject',
    '0070': 'conversationTopic',

    //  Date and time
    '0039': 'clientSubmitTime',
    '3007': 'creationTime',
    '3008': 'lastModificationTime',
    '0e06': 'messageDeliveryTime',

    // Internet message metadata
    '0017': 'importance',
    '007d': 'transportMessageHeaders',
    '1035': 'internetMessageId',

     // Attachments
    '3701': 'attachmentData',
    '3703': 'extension',
    '3704': 'fileNameShort',
    '3705': 'attachmentMethod',
    '3707': 'fileName',
    '370e': 'mimeType',
    '3712': 'contentId',
    '0e20': 'attachmentSize',
    '0e21': 'attachmentNumber',

    // Recipients
    '3001': 'displayName',
    '39fe': 'recipientSmtpAddress',
    '39ff': 'recipientDisplayName',
    '0e04': 'displayTo',
    '0e03': 'displayCc',
    '0e02': 'displayBcc',
    '0c15': 'recipientType',

     // Additional properties
    '0e08': 'messageSize',
    '0076': 'receivedByEmail',
    '0077': 'receivedByAddressType',
    '0040': 'receivedByName',
    '0ff7': 'accessLevel',
    '1090': 'flagStatus',

    //Security
    '0030': 'security',
    '0057': 'messageToMe',
    '0058': 'messageCcMe',
    '0059': 'messageRecipMe'
} as const;

// Reverse mapping: property name -> property ID (for easier lookup)
export const PROPERTY_IDS: Record<string, string> = {};
for (const [id, name] of Object.entries(PROPERTY_MAPPING)) {
    PROPERTY_IDS[name] = id.toLowerCase();
}

/**
 * Builds a property path for reading from MSG file.
 * Format: __substg1.0_<PROPERTY_ID><TYPE>
 * 
 * @param propertyId - Property ID (hex string, e.g., '0037', '1000')
 * @param propertyType - Property type (default: UNICODE)
 * @param rootEntry - Root entry name (default: 'Root Entry')
 * @returns Array path for CFBF reader
 * 
 * @example
 * buildPropertyPath('0037', PROPERTY_TYPES.UNICODE)
 * // Returns: ['Root Entry', '__substg1.0_0037001F']
 */
export function buildPropertyPath(
    propertyId: string,
    propertyType: string = PROPERTY_TYPES.UNICODE,
    rootEntry: string = 'Root Entry'
): string[] {
    // Normalize property ID to uppercase (as in original MSG format) and ensure 4 characters
    const normalizedId = propertyId.toUpperCase().padStart(4, '0');
    const streamName = `__substg1.0_${normalizedId}${propertyType}`;
    return [rootEntry, streamName];
}

/**
 * Builds property path using property name from PROPERTY_MAPPING.
 * 
 * @param propertyName - Property name (e.g., 'subject', 'body', 'senderName')
 * @param propertyType - Property type (default: UNICODE)
 * @param rootEntry - Root entry name (default: 'Root Entry')
 * @returns Array path for CFBF reader, or undefined if property not found
 * 
 * @example
 * buildPropertyPathByName('subject', PROPERTY_TYPES.UNICODE)
 * // Returns: ['Root Entry', '__substg1.0_0037001F']
 */
export function buildPropertyPathByName(
    propertyName: string,
    propertyType: string = PROPERTY_TYPES.UNICODE,
    rootEntry: string = 'Root Entry'
): string[] | undefined {
    const propertyId = PROPERTY_IDS[propertyName];
    if (!propertyId) {
        return undefined;
    }
    return buildPropertyPath(propertyId, propertyType, rootEntry);
}

/**
 * Builds multiple property paths for fallback reading.
 * Tries different property types in order.
 * 
 * @param propertyId - Property ID (hex string)
 * @param propertyTypes - Array of property types to try (default: [UNICODE, ANSI])
 * @param rootEntry - Root entry name (default: 'Root Entry')
 * @returns Array of paths to try in order
 * 
 * @example
 * buildPropertyPathsWithFallback('0037')
 * // Returns: [
 * //   ['Root Entry', '__substg1.0_0037001F'],
 * //   ['Root Entry', '__substg1.0_0037001E']
 * // ]
 */
export function buildPropertyPathsWithFallback(
    propertyId: string,
    propertyTypes: string[] = [PROPERTY_TYPES.UNICODE, PROPERTY_TYPES.ANSI],
    rootEntry: string = 'Root Entry'
): string[][] {
    return propertyTypes.map(type => buildPropertyPath(propertyId, type, rootEntry));
}

/**
 * Builds multiple property paths using property name with fallback types.
 * 
 * @param propertyName - Property name from PROPERTY_MAPPING
 * @param propertyTypes - Array of property types to try (default: [UNICODE, ANSI])
 * @param rootEntry - Root entry name (default: 'Root Entry')
 * @returns Array of paths to try in order, or empty array if property not found
 */
export function buildPropertyPathsByNameWithFallback(
    propertyName: string,
    propertyTypes: string[] = [PROPERTY_TYPES.UNICODE, PROPERTY_TYPES.ANSI],
    rootEntry: string = 'Root Entry'
): string[][] {
    const propertyId = PROPERTY_IDS[propertyName];
    if (!propertyId) {
        return [];
    }
    return buildPropertyPathsWithFallback(propertyId, propertyTypes, rootEntry);
}

/**
 * Common property set GUIDs used in MSG files
 */
export const PROPERTY_SET_GUIDS = {
    // Public Strings (most common for custom properties)
    PS_PUBLIC_STRINGS: '{00020329-0000-0000-C000-000000000046}',
    
    // Internet Headers
    PS_INTERNET_HEADERS: '{00020386-0000-0000-C000-000000000046}',
    
    // Common Properties
    PS_COMMON: '{00062008-0000-0000-C000-000000000046}',
    
    // Address Book
    PS_ADDRESS_BOOK: '{00062004-0000-0000-C000-000000000046}',
    
    // Appointment
    PS_APPOINTMENT: '{00062002-0000-0000-C000-000000000046}',
    
    // Task
    PS_TASK: '{00062003-0000-0000-C000-000000000046}',
    
    // Message
    PS_MESSAGE: '{00062007-0000-0000-C000-000000000046}'
} as const;

/**
 * Builds property path for named property.
 * 
 * @param guid - Property set GUID
 * @param name - Property name or numeric ID
 * @param propertyType - Property type (default: UNICODE)
 * @param namedPropertyReader - NamedPropertyReader instance (must be initialized)
 * @param rootEntry - Root entry name (default: 'Root Entry')
 * @returns Array path for CFBF reader, or undefined if property not found
 * 
 * @example
 * ```typescript
 * const reader = await createNamedPropertyReader(...);
 * await reader.initialize();
 * const path = buildNamedPropertyPath(
 *     PROPERTY_SET_GUIDS.PS_PUBLIC_STRINGS,
 *     'CustomProperty',
 *     PROPERTY_TYPES.UNICODE,
 *     reader
 * );
 * if (path) {
 *     const value = await propertyReader.readUnicodeString(path);
 * }
 * ```
 */
export function buildNamedPropertyPath(
    guid: string,
    name: string | number,
    propertyType: string = PROPERTY_TYPES.UNICODE,
    namedPropertyReader: { getPropertyId: (guid: string, name: string | number) => number | undefined },
    rootEntry: string = 'Root Entry'
): string[] | undefined {
    const propertyId = namedPropertyReader.getPropertyId(guid, name);
    if (!propertyId) {
        return undefined;
    }
    
    // Named properties use 0x8000-0xFFFF range
    const normalizedId = propertyId.toString(16).toUpperCase().padStart(4, '0');
    const streamName = `__substg1.0_${normalizedId}${propertyType}`;
    return [rootEntry, streamName];
}
