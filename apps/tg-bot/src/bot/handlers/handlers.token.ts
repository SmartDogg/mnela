/**
 * DI token for the message handler factory. Lives in its own file so the
 * provider implementation and the consuming BotService can both import
 * it without circular references.
 */
export const HANDLERS_FACTORY = Symbol('HANDLERS_FACTORY');
