import type { AuditRule } from './audit-rule.ts';
import { displayRefreshRateRule } from './display-refresh-rate.rule.ts';
import { driverFreshnessRule } from './driver-freshness.rule.ts';
import { fullscreenOptimizationsRule } from './fullscreen-optimizations.rule.ts';
import { gameConfigRule } from './game-config.rule.ts';
import { gameDvrRule } from './game-dvr.rule.ts';
import { gameGpuPreferenceRule } from './game-gpu-preference.rule.ts';
import { gameLaunchOptionsRule } from './game-launch-options.rule.ts';
import { hardwareAcceleratedGpuSchedulingRule } from './hardware-accelerated-gpu-scheduling.rule.ts';
import { memoryIntegrityRule } from './memory-integrity.rule.ts';
import { multiPlaneOverlayRule } from './multi-plane-overlay.rule.ts';
import { coreParkingRule } from './power-plan.rule.ts';
import { wirelessLinkRule } from './wireless-link.rule.ts';

/**
 * Полный набор правил статического аудита.
 *
 * Список живёт в domain, потому что «какие проверки составляют аудит» — это
 * предметное знание, а не деталь запуска.
 */
export const allAuditRules: readonly AuditRule[] = [
  displayRefreshRateRule,
  gameGpuPreferenceRule,
  coreParkingRule,
  gameDvrRule,
  driverFreshnessRule,
  hardwareAcceleratedGpuSchedulingRule,
  multiPlaneOverlayRule,
  memoryIntegrityRule,
  fullscreenOptimizationsRule,
  gameLaunchOptionsRule,
  gameConfigRule,
  wirelessLinkRule,
];
