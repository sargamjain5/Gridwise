import type { OffenderProfile, OffenderRiskScore } from './types';

/**
 * Repeat Offender Risk Engine
 *
 * Score = Volume(25%) + Frequency(20%) + Hotspot(20%) + Escalation(15%) + Recency(10%) + Spread(10%)
 *
 * Each sub-score is 0-100, weighted and combined.
 */
export function scoreOffender(
  profile: OffenderProfile,
  maxViolations: number,
  maxFrequency: number,
): OffenderRiskScore {
  // 1. Volume score (25%): total violations normalized
  // Use log scale to avoid top-heavy distribution
  const volumeScore = Math.min(100, (Math.log(profile.totalViolations + 1) / Math.log(maxViolations + 1)) * 100);

  // 2. Frequency score (20%): violations per month
  const frequencyScore = Math.min(100, (profile.frequencyPerMonth / Math.max(maxFrequency, 1)) * 100);

  // 3. Hotspot score (20%): fraction of violations in critical/high congestion areas
  const hotspotScore = profile.hotspotRatio * 100;

  // 4. Escalation score (15%): >1 means violations are increasing
  // Map escalation (0.2 to 3.0) to score (0 to 100)
  const escalationScore = Math.min(100, Math.max(0, (profile.escalation - 0.5) * 40));

  // 5. Recency score (10%): more recent = higher risk
  // Map recency: 1 day = 100, 30 days = 70, 90 days = 40, 365+ = 10
  const recencyScore = Math.max(5, 100 - Math.log(profile.recencyDays + 1) * 15);

  // 6. Spread score (10%): violations across multiple stations = organized pattern
  const spreadScore = Math.min(100, profile.stationCount * 20 + profile.junctionCount * 5);

  // Weighted composite
  const composite =
    volumeScore * 0.25 +
    frequencyScore * 0.20 +
    hotspotScore * 0.20 +
    escalationScore * 0.15 +
    recencyScore * 0.10 +
    spreadScore * 0.10;

  const score = Math.min(100, Math.max(0, Math.round(composite)));

  let level: OffenderRiskScore['level'];
  if (score >= 75) level = 'critical';
  else if (score >= 50) level = 'high';
  else if (score >= 25) level = 'medium';
  else level = 'low';

  return {
    profile,
    score,
    level,
    factors: {
      volumeScore: Math.round(volumeScore),
      frequencyScore: Math.round(frequencyScore),
      hotspotScore: Math.round(hotspotScore),
      escalationScore: Math.round(escalationScore),
      recencyScore: Math.round(recencyScore),
      spreadScore: Math.round(spreadScore),
    },
  };
}

export function scoreAllOffenders(profiles: OffenderProfile[]): OffenderRiskScore[] {
  if (profiles.length === 0) return [];

  const maxViolations = Math.max(...profiles.map(p => p.totalViolations));
  const maxFrequency = Math.max(...profiles.map(p => p.frequencyPerMonth));

  return profiles
    .map(p => scoreOffender(p, maxViolations, maxFrequency))
    .sort((a, b) => b.score - a.score);
}
