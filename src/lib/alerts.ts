import type { ForecastEntry, CongestionScoreEntry, ActiveAlert } from './types';

/**
 * Compute active alerts dynamically based on current IST time.
 * Looks at current hour ±2 hours. If no alerts in that window,
 * finds the next upcoming high-risk window for today.
 */
export function computeActiveAlerts(
  forecast: ForecastEntry[],
  congestion: CongestionScoreEntry[],
): ActiveAlert[] {
  const now = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const currentHour = now.getUTCHours();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const currentDay = days[now.getUTCDay()];

  const congMap = new Map<string, CongestionScoreEntry>();
  for (const c of congestion) congMap.set(c.station, c);

  // Try current window first (current hour + next 2 hours)
  let windowHours = [currentHour, (currentHour + 1) % 24, (currentHour + 2) % 24];
  let relevantForecasts = forecast.filter(
    f => f.day === currentDay && windowHours.includes(f.hour) && f.risk === 'high'
  );

  let isUpcoming = false;

  // If no alerts in current window, find next upcoming high-risk hours today
  if (relevantForecasts.length === 0) {
    const futureHigh = forecast
      .filter(f => f.day === currentDay && f.hour > currentHour && f.risk === 'high')
      .sort((a, b) => a.hour - b.hour);

    if (futureHigh.length > 0) {
      const nextHour = futureHigh[0].hour;
      windowHours = [nextHour, (nextHour + 1) % 24];
      relevantForecasts = forecast.filter(
        f => f.day === currentDay && windowHours.includes(f.hour) && f.risk === 'high'
      );
      isUpcoming = true;
    } else {
      // No more high-risk hours today — show tomorrow's first window
      const tomorrowDay = days[(now.getUTCDay() + 1) % 7];
      const tomorrowHigh = forecast
        .filter(f => f.day === tomorrowDay && f.risk === 'high')
        .sort((a, b) => a.hour - b.hour);
      if (tomorrowHigh.length > 0) {
        const nextHour = tomorrowHigh[0].hour;
        windowHours = [nextHour, (nextHour + 1) % 24];
        relevantForecasts = forecast.filter(
          f => f.day === tomorrowDay && windowHours.includes(f.hour) && f.risk === 'high'
        );
        isUpcoming = true;
      }
    }
  }

  const seenStations = new Set<string>();
  const alerts: ActiveAlert[] = [];

  for (const f of relevantForecasts) {
    if (seenStations.has(f.station)) continue;
    seenStations.add(f.station);

    const cScore = congMap.get(f.station);
    const score = cScore?.score || 0;

    let riskLevel: ActiveAlert['riskLevel'];
    if (score >= 70 || f.avgViolations >= 80) riskLevel = 'critical';
    else if (score >= 40 || f.avgViolations >= 40) riskLevel = 'high';
    else riskLevel = 'moderate';

    let recommendation: string;
    if (riskLevel === 'critical') {
      const officers = Math.max(3, Math.ceil(f.avgViolations / 30));
      recommendation = `Deploy ${officers} officers immediately. Activate CCTV monitoring. Review towing capacity.`;
    } else if (riskLevel === 'high') {
      const officers = Math.max(2, Math.ceil(f.avgViolations / 40));
      recommendation = `Deploy ${officers} officers. Review CCTV evidence. Consider temporary no-parking signage.`;
    } else {
      recommendation = `Maintain patrol presence. Monitor CCTV feeds for escalation.`;
    }

    alerts.push({
      id: `alert-${f.station}-${f.hour}`,
      station: f.station,
      junction: cScore?.junction || 'Street patrol zone',
      riskLevel,
      congestionScore: score,
      expectedViolations: Math.round(f.avgViolations),
      recommendation,
      hour: f.hour,
      day: f.day,
    });
  }

  const sorted = alerts.sort((a, b) => {
    const riskOrder = { critical: 0, high: 1, moderate: 2 };
    return (riskOrder[a.riskLevel] - riskOrder[b.riskLevel]) || (b.expectedViolations - a.expectedViolations);
  }).slice(0, 20);

  // Tag upcoming alerts
  if (isUpcoming && sorted.length > 0) {
    sorted.forEach(a => {
      a.recommendation = `[UPCOMING ${a.day} ${a.hour}:00] ${a.recommendation}`;
    });
  }

  return sorted;
}
