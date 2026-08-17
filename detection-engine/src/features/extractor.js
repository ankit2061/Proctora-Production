/**
 * Behavioral Feature Extractor
 * Derives statistical features from raw session telemetry streams
 */

export function extractFeatures(events) {
  if (!events || events.length === 0) {
    return {
      focusLossCount: 0,
      totalAwayDurationMs: 0,
      maxAwayDurationMs: 0,
      tabSwitchCount: 0,
      idlePeriodCount: 0,
      totalIdleDurationMs: 0,
      rapidAnswerBursts: 0,
      answerCount: 0,
      avgResponseTimeMs: 0,
      suspiciousSequences: 0
    };
  }

  let focusLossCount = 0;
  let totalAwayDurationMs = 0;
  let maxAwayDurationMs = 0;
  let tabSwitchCount = 0;
  let idlePeriodCount = 0;
  let totalIdleDurationMs = 0;
  let rapidAnswerBursts = 0;
  let totalResponseTimeMs = 0;
  let answerCount = 0;
  let suspiciousSequences = 0;

  for (let i = 0; i < events.length; i++) {
    const evt = events[i];
    const meta = typeof evt.metadata === 'string' ? JSON.parse(evt.metadata || '{}') : (evt.metadata || {});

    if (evt.type === 'focus_lost') {
      focusLossCount++;
      const dur = Number(meta.durationMs) || 1000;
      totalAwayDurationMs += dur;
      if (dur > maxAwayDurationMs) maxAwayDurationMs = dur;
    }

    if (evt.type === 'tab_switch') {
      tabSwitchCount++;
    }

    if (evt.type === 'idle_period') {
      idlePeriodCount++;
      const dur = Number(meta.durationMs) || 5000;
      totalIdleDurationMs += dur;
    }

    if (evt.type === 'answer_submit') {
      answerCount++;
      const respTime = Number(meta.responseTimeMs) || 0;
      totalResponseTimeMs += respTime;

      // Answering in under 2.5 seconds can be suspicious if preceded by blur
      if (respTime > 0 && respTime < 2500) {
        rapidAnswerBursts++;
      }
    }

    // Sequence heuristic: Focus lost or tab switch followed immediately (< 6s) by an answer submit
    if (i > 0) {
      const prevEvt = events[i - 1];
      if ((prevEvt.type === 'focus_lost' || prevEvt.type === 'tab_switch') && evt.type === 'answer_submit') {
        const timeDiff = Math.abs(new Date(evt.timestamp).getTime() - new Date(prevEvt.timestamp).getTime());
        if (timeDiff <= 6000) {
          suspiciousSequences++;
        }
      }
    }
  }

  return {
    focusLossCount,
    totalAwayDurationMs,
    maxAwayDurationMs,
    tabSwitchCount,
    idlePeriodCount,
    totalIdleDurationMs,
    rapidAnswerBursts,
    answerCount,
    avgResponseTimeMs: answerCount > 0 ? Math.round(totalResponseTimeMs / answerCount) : 0,
    suspiciousSequences
  };
}
