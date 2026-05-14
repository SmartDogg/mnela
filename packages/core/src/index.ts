export const PACKAGE_NAME = '@mnela/core';

export { startHeartbeat } from './heartbeat.js';
export { initSentry } from './sentry.js';

export {
  CONFIG_REGISTRY,
  readRegistryValue,
  resolveConfigValue,
  validateConfigValue,
  type BoolConfigSpec,
  type BytesConfigSpec,
  type ConfigSpec,
  type ConfigSpecBase,
  type ConfigType,
  type EnumConfigSpec,
  type IntConfigSpec,
  type StringConfigSpec,
} from './system-registry.js';
