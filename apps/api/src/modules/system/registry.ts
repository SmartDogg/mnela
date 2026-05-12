/**
 * Back-compat re-export: the registry now lives in @mnela/core so the
 * orchestrator and worker can read the same source of truth without
 * importing across apps. Existing imports of `./registry.js` keep working.
 */
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
} from '@mnela/core';
