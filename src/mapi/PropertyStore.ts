import type { CFBFReader } from '../cfb/CFBReader';
import type { DirectoryNode } from '../types';
import type { PropertyReader } from '../msg/PropertyReader';
import type { NamedPropertyReader } from '../msg/NamedPropertyReader';

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

  constructor(
    private readonly cfbReader: CFBFReader,
    private readonly propertyReader: PropertyReader,
    private readonly namedProperties: NamedPropertyReader,
  ) {
    const tree = cfbReader.getTree();
    if (tree) this.indexNode(tree);
  }

  findStorages(prefix: string): string[][] {
    const tree = this.cfbReader.getTree();
    if (!tree) return [];
    const result: string[][] = [];
    const visit = (node: DirectoryNode, parent: string[]): void => {
      const path = [...parent, node.name];
      if (node.name.startsWith(prefix)) result.push(path);
      for (const child of node.children) visit(child, path);
    };
    visit(tree, []);
    return result;
  }

  async read(ids: string[], options: PropertyReadOptions = {}): Promise<string | Buffer | undefined> {
    const candidates = ids.flatMap((id) => this.locations.get(this.normalizeId(id)) ?? []);
    const rootFirst = [...candidates].sort((a, b) => a.path.length - b.path.length);
    return this.readLocations(rootFirst, options);
  }

  async readAt(
    storagePath: string[],
    ids: string[],
    options: PropertyReadOptions = {},
  ): Promise<string | Buffer | undefined> {
    const normalizedStorage = storagePath.join('\u0000');
    const candidates = ids
      .flatMap((id) => this.locations.get(this.normalizeId(id)) ?? [])
      .filter((location) => location.path.slice(0, -1).join('\u0000') === normalizedStorage);
    return this.readLocations(candidates, options);
  }

  async readString(ids: string[]): Promise<string | undefined> {
    const value = await this.read(ids, { types: ['001F', '001E', '0102'] });
    return typeof value === 'string' ? value : undefined;
  }

  async readStringAt(storagePath: string[], ids: string[]): Promise<string | undefined> {
    const value = await this.readAt(storagePath, ids, { types: ['001F', '001E', '0102'] });
    return typeof value === 'string' ? value : undefined;
  }

  async readNamed(
    guid: string,
    name: string | number,
    options: PropertyReadOptions = {},
  ): Promise<string | Buffer | undefined> {
    const propertyId = this.namedProperties.getPropertyId(guid, name);
    if (propertyId === undefined) return undefined;
    return this.read([propertyId.toString(16).padStart(4, '0')], options);
  }

  private indexNode(node: DirectoryNode, parent: string[] = []): void {
    const path = [...parent, node.name];
    const match = /^__substg1\.0_([0-9a-f]{4})([0-9a-f]{4})$/i.exec(node.name);
    if (node.type === 0x02 && match) {
      const location: PropertyLocation = {
        id: match[1].toUpperCase(),
        type: match[2].toUpperCase(),
        path,
      };
      const existing = this.locations.get(location.id) ?? [];
      existing.push(location);
      this.locations.set(location.id, existing);
    }
    for (const child of node.children) this.indexNode(child, path);
  }

  private async readLocations(
    locations: PropertyLocation[],
    options: PropertyReadOptions,
  ): Promise<string | Buffer | undefined> {
    const typeOrder = options.types ?? (options.preferBinary ? ['0102', '001F', '001E'] : ['001F', '001E', '0102']);
    for (const type of typeOrder) {
      for (const location of locations.filter((candidate) => candidate.type === type)) {
        const value = await this.readLocation(location, options.preferBinary === true);
        if (value !== undefined) return value;
      }
    }
    return undefined;
  }

  private async readLocation(location: PropertyLocation, preferBinary: boolean): Promise<string | Buffer | undefined> {
    if (preferBinary || location.type === '0102') {
      const binary = await this.propertyReader.readBinary(location.path);
      if (binary?.length) return binary;
    }
    const text = location.type === '001F'
      ? await this.propertyReader.readUnicodeString(location.path)
      : await this.propertyReader.readStringFromBinary(location.path);
    if (text?.trim()) return text;
    if (!preferBinary) {
      const binary = await this.propertyReader.readBinary(location.path);
      if (binary?.length) return binary;
    }
    return undefined;
  }

  private normalizeId(id: string): string {
    return id.toUpperCase().padStart(4, '0');
  }
}
