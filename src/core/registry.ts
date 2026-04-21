/**
 * MemoBridge — Adapter Registry
 *
 * Generic registry for Extractor / Importer adapters, keyed by ToolId.
 * Factories are invoked lazily on `get()` so registration does not
 * force construction of all adapters at import time.
 */

import type { Extractor, Importer, ToolId } from './types.js';

export type AdapterFactory<T> = () => T;

export class AdapterRegistry<T extends { toolId: ToolId }> {
  private factories = new Map<ToolId, AdapterFactory<T>>();

  /**
   * Register a factory for the given tool. If a factory is already
   * registered for this toolId, it will be overwritten (allowing users
   * to replace built-in adapters with custom implementations).
   */
  register(toolId: ToolId, factory: AdapterFactory<T>): void {
    this.factories.set(toolId, factory);
  }

  /**
   * Resolve an adapter instance for the given tool.
   * Throws if the tool has not been registered.
   */
  get(toolId: ToolId): T {
    const factory = this.factories.get(toolId);
    if (!factory) {
      const registered = this.list().join(', ') || '(none)';
      throw new Error(`未注册的工具: ${toolId}。已注册: ${registered}`);
    }
    return factory();
  }

  has(toolId: ToolId): boolean {
    return this.factories.has(toolId);
  }

  /**
   * List all registered tool ids in registration order.
   */
  list(): ToolId[] {
    return [...this.factories.keys()];
  }

  /**
   * Remove a registration. Returns true if a factory was removed.
   */
  unregister(toolId: ToolId): boolean {
    return this.factories.delete(toolId);
  }
}

export const extractorRegistry = new AdapterRegistry<Extractor>();
export const importerRegistry = new AdapterRegistry<Importer>();
