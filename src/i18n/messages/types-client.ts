// Type-only re-exports for client modules, so they never pull the dictionary
// data (both languages) into a client bundle by accident.
export type { ClientMessagesPayload, Messages, Namespace } from './index';
