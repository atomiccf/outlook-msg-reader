import type { CFBFReader } from '../cfb/CFBReader';
import type { DirectoryNode } from '../types';
import type { PropertyReader } from './PropertyReader';
import type { NamedPropertyReader } from './NamedPropertyReader';

export type PropertyType = '001F' | '001E' | '0102' | string;

export interface PropertyLocation {
  id: string;
  type: PropertyType;
  path: string[];
}

export interface PropertyReadOptions {
  preferBinary?: boolean;
  types?: PropertyType[];
}

export class PropertyStore {
  private readonly locations = new Map<string, PropertyLocation[]>();
  private namedPropertiesInitialization?: Promise<void>;

  constructor(
    private readonly cfbReader: CFBFReader,
    private readonly propertyReader: PropertyReader,
    private readonly namedProperties: NamedPropertyReader,
    private readonly rootStorage: string[] = ['Root Entry'],
  ) {
    const tree = cfbReader.getTree();
    if (tree) this.indexTree(tree);
  }

  findStorages(prefix: string, storagePath: string[] = this.rootStorage): string[][] {
    const tree = this.cfbReader.getTree();
    if (!tree) return [];
    let parent: DirectoryNode | undefined = tree;
    const startIndex = storagePath[0] === tree.name ? 1 : 0;
    for (let index = startIndex; index < storagePath.length; index++) {
      parent = parent.children.find(child => child.name === storagePath[index]);
      if (!parent) return [];
    }
    return parent.children
      .filter(child => child.name.startsWith(prefix))
      .map(child => [...storagePath, child.name]);
  }

  async read(ids: string[], options: PropertyReadOptions = {}): Promise<string | Buffer | undefined> {
    return this.readAt(this.rootStorage, ids, options);
  }

  async readAt(
    storagePath: string[],
    ids: string[],
    options: PropertyReadOptions = {},
  ): Promise<string | Buffer | undefined> {
    return this.readAtWithMode(storagePath, ids, options, false);
  }

  private async readAtWithMode(
    storagePath: string[],
    ids: string[],
    options: PropertyReadOptions,
    stringsOnly: boolean,
  ): Promise<string | Buffer | undefined> {
    const normalizedStorage = storagePath.join('\u0000');
    for (const id of ids) {
      const candidates = (this.locations.get(this.normalizeId(id)) ?? [])
        .filter((location) => location.path.slice(0, -1).join('\u0000') === normalizedStorage);
      const value = await this.readLocations(candidates, options, stringsOnly);
      if (value !== undefined) return value;
    }
    return undefined;
  }

  async readString(ids: string[]): Promise<string | undefined> {
    return this.readStringAt(this.rootStorage, ids);
  }

  async readStringAt(storagePath: string[], ids: string[]): Promise<string | undefined> {
    const value = await this.readAtWithMode(
      storagePath,
      ids,
      { types: ['001F', '001E', '0102'] },
      true,
    );
    return typeof value === 'string' ? value : undefined;
  }

  async readNamed(
    guid: string,
    name: string | number,
    options: PropertyReadOptions = {},
  ): Promise<string | Buffer | undefined> {
    this.namedPropertiesInitialization ??= this.namedProperties.initialize();
    await this.namedPropertiesInitialization;
    const propertyId = this.namedProperties.getPropertyId(guid, name);
    if (propertyId === undefined) return undefined;
    return this.readAt(this.rootStorage, [propertyId.toString(16).padStart(4, '0')], options);
  }

  getRootStorage(): string[] { return [...this.rootStorage]; }

  private indexTree(root: DirectoryNode): void {
    const stack: Array<{ node: DirectoryNode; parent: string[] }> = [{ node: root, parent: [] }];
    while (stack.length > 0) {
      const current = stack.pop()!;
      const path = [...current.parent, current.node.name];
      const match = /^__substg1\.0_([0-9a-f]{4})([0-9a-f]{4})$/i.exec(current.node.name);
      if (current.node.type === 0x02 && match) {
        const location: PropertyLocation = {
          id: match[1].toUpperCase(),
          type: match[2].toUpperCase(),
          path,
        };
        const existing = this.locations.get(location.id) ?? [];
        existing.push(location);
        this.locations.set(location.id, existing);
      }
      for (let index = current.node.children.length - 1; index >= 0; index -= 1) {
        stack.push({ node: current.node.children[index], parent: path });
      }
    }
  }

  private async readLocations(
    locations: PropertyLocation[],
    options: PropertyReadOptions,
    stringsOnly: boolean,
  ): Promise<string | Buffer | undefined> {
    const typeOrder = options.types ?? (options.preferBinary ? ['0102', '001F', '001E'] : ['001F', '001E', '0102']);
    for (const type of typeOrder) {
      for (const location of locations.filter((candidate) => candidate.type === type)) {
        const value = await this.readLocation(location, options.preferBinary === true, stringsOnly);
        if (value !== undefined) return value;
      }
    }
    return undefined;
  }

  private async readLocation(
    location: PropertyLocation,
    preferBinary: boolean,
    stringsOnly: boolean,
  ): Promise<string | Buffer | undefined> {
    if (preferBinary || (location.type === '0102' && !stringsOnly)) {
      const binary = await this.propertyReader.readBinary(location.path);
      if (binary?.length) return binary;
    }
    const text = location.type === '001F' || location.type === '001E'
      ? await this.propertyReader.readUnicodeString(location.path)
      : await this.propertyReader.readStringFromBinary(location.path);
    if (text?.trim()) return text;
    if (!preferBinary && !stringsOnly) {
      const binary = await this.propertyReader.readBinary(location.path);
      if (binary?.length) return binary;
    }
    return undefined;
  }

  private normalizeId(id: string): string {
    return id.toUpperCase().padStart(4, '0');
  }
}
