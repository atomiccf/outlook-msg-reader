type DependencyName = string;
type FactoryFunction<T = any> = (locator: ServiceLocator) => T;

 export class ServiceLocator {
  private dependencies: Record<DependencyName, any> = {};
  private factories: Record<DependencyName, FactoryFunction> = {};

  factory<T>(name: string, factory: FactoryFunction<T>): void {
    this.factories[name] = factory;
  }

  register<T>(name: string, instance: T): void {
    this.dependencies[name] = instance;
  }

  get<T>(name: string): T {
    if (!this.dependencies[name]) {
      const factory = this.factories[name] as FactoryFunction<T>;
      if (factory) {
        this.dependencies[name] = factory(this);
      }
      if (!this.dependencies[name]) {
        throw new Error(`Cannot find module: ${name}`);
      }
    }
    return this.dependencies[name] as T;
  }
}