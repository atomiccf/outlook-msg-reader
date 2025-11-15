type Token = string | symbol | Function;

interface ServiceRegistration<T = any> {
    factory: () => T;
    instance?: T;
    singleton: boolean;
}

export class Container {
    private services = new Map<Token, ServiceRegistration>();

    /**
     * Register imported class or imported object
     */
    register<T>(token: Token, imported: T): void {
        if (typeof imported === 'function' && this.isClass(imported)) {
            this.services.set(token, {
                factory: () => new (imported as any)(),
                singleton: false,
            });
            return;
        }

        if (typeof imported === 'object') {
            this.services.set(token, {
                factory: () => imported,
                instance: imported,
                singleton: true,
            });
            return;
        }
        throw new Error(
            `Invalid value for register(). For factories use container.factory(). Token: ${String(
                token
            )}`
        );
    }

    /**
     * Register factory function
     * @param token - Unique identifier
     * @param factoryFn - Factory function that creates the service
     * @param singleton - If true, factory is called once and result is cached
     */
    factory<T>(token: Token, factoryFn: () => T, singleton: boolean = false): void {
        this.services.set(token, {
            factory: factoryFn,
            singleton,
        });
    }


    /**
     * Resolve service
     */
    resolve<T>(token: Token): T {
        const reg = this.services.get(token);

        if (!reg) {
            throw new Error(`Service not registered: ${String(token)}`);
        }

        if (reg.singleton) {
            if (reg.instance === undefined) {
                reg.instance = reg.factory();
            }
            return reg.instance as T;
        }

        return reg.factory() as T;
    }

    /**
     * Utility: detect if function is a class
     */
    private isClass(fn: any): boolean {
        return typeof fn === 'function'
            && /^class\s/.test(Function.prototype.toString.call(fn));
    }
}

export const container = new Container();
