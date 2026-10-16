export type Lifetime = 'singleton' | 'scoped' | 'transient';
export type Token<T> = symbol & { readonly __type?: T };

export function createToken<T>(description: string): Token<T> {
  return Symbol(description) as Token<T>;
}

export interface Resolver {
  get<T>(token: Token<T>): T;
}

type Factory<T> = (resolver: Resolver) => T;

interface Registration<T = unknown> {
  factory: Factory<T>;
  lifetime: Lifetime;
}

export class ServiceLocator implements Resolver {
  private readonly registrations: Map<Token<unknown>, Registration>;
  private readonly singletons: Map<Token<unknown>, unknown>;
  private readonly scopedInstances = new Map<Token<unknown>, unknown>();
  private readonly resolving = new Set<Token<unknown>>();

  constructor(parent?: ServiceLocator) {
    this.registrations = parent?.registrations ?? new Map();
    this.singletons = parent?.singletons ?? new Map();
  }

  createScope(): ServiceLocator {
    return new ServiceLocator(this);
  }

  register<T>(token: Token<T>, instance: T): void {
    this.registrations.set(token, { factory: () => instance, lifetime: 'singleton' });
    this.singletons.set(token, instance);
  }

  factory<T>(token: Token<T>, factory: Factory<T>, lifetime: Lifetime = 'transient'): void {
    this.registrations.set(token, { factory, lifetime });
  }

  get<T>(token: Token<T>): T {
    const registration = this.registrations.get(token) as Registration<T> | undefined;
    if (!registration) {
      throw new Error(`Dependency is not registered: ${String(token.description)}`);
    }

    const cache = registration.lifetime === 'singleton'
      ? this.singletons
      : registration.lifetime === 'scoped'
        ? this.scopedInstances
        : undefined;

    if (cache?.has(token)) return cache.get(token) as T;
    if (this.resolving.has(token)) {
      throw new Error(`Circular dependency detected: ${String(token.description)}`);
    }

    this.resolving.add(token);
    try {
      const instance = registration.factory(this);
      cache?.set(token, instance);
      return instance;
    } finally {
      this.resolving.delete(token);
    }
  }
}
