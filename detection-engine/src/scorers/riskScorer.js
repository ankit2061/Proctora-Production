import { extractFeatures } from '../features/extractor.js';

/**
 * Multi-Modal Behavioral & Biometric Risk Scorer
 * Combines OS/browser telemetry + Python AI biometric vision & audio signals into an explainable 0.0 - 1.0 risk score
 */
export function scoreSession(events) {
  if (!events || events.length === 0) {
    return {
      riskScore: 0.0,
      signals: [],
      explanation: 'No activity recorded yet.',
      features: extractFeatures([])
    };
  }

  const features = extractFeatures(events);
  let score = 0.0;
  const signals = [];
  const reasons = [];

  // Count AI biometric anomaly events
  let gazeAwayCount = 0;
  let mouthMovementCount = 0;
  let absentScreenCount = 0;
  let multiplePersonsCount = 0;
  let contrabandCount = 0;
  let faceMismatchCount = 0;
  let voiceMismatchCount = 0;
  let dinoAnomalyCount = 0;

  for (const evt of events) {
    const type = evt.type || '';
    if (type === 'GAZE_AWAY' || type === 'gaze_away') gazeAwayCount++;
    if (type === 'MOUTH_MOVEMENT' || type === 'mouth_movement') mouthMovementCount++;
    if (type === 'ABSENT_SCREEN' || type === 'absent_screen' || type === 'ABSENT_FACE') absentScreenCount++;
    if (type === 'MULTIPLE_PERSONS' || type === 'multiple_persons') multiplePersonsCount++;
    if (type.startsWith('CONTRABAND') || type === 'contraband_detected') contrabandCount++;
    if (type.includes('FACE_MISMATCH') || type === 'face_mismatch') faceMismatchCount++;
    if (type.includes('VOICE_MISMATCH') || type === 'voice_mismatch') voiceMismatchCount++;
    if (type.includes('DINO_ANOMALY')) dinoAnomalyCount++;
  }

  // --- Layer 1: Biometric & AI Vision Signals ---

  // 1. Contraband (Phones, unauthorized devices via YOLOv8)
  if (contrabandCount >= 1) {
    score += 0.40;
    signals.push('contraband_detected');
    reasons.push(`${contrabandCount} prohibited device/object detection(s) (YOLOv8)`);
  }

  // 2. Multiple Persons in camera view
  if (multiplePersonsCount >= 1) {
    score += 0.35;
    signals.push('multiple_persons');
    reasons.push(`${multiplePersonsCount} instance(s) of multiple persons in camera frame`);
  }

  // 3. Face Mismatch (Different candidate identity via ArcFace/FaceNet)
  if (faceMismatchCount >= 1) {
    score += 0.50;
    signals.push('face_mismatch');
    reasons.push('Candidate face does not match enrolled reference biometric (FaceNet/ArcFace)');
  }

  // 4. Voice Mismatch (Different speaker via ECAPA-TDNN)
  if (voiceMismatchCount >= 1) {
    score += 0.40;
    signals.push('voice_mismatch');
    reasons.push('Speaker voice embedding does not match enrolled reference (ECAPA-TDNN)');
  }

  // 5. Absent from screen / camera view
  if (absentScreenCount >= 3) {
    score += 0.30;
    signals.push('absent_screen');
    reasons.push(`Candidate absent from camera view for ${absentScreenCount} intervals`);
  } else if (absentScreenCount >= 1) {
    score += 0.15;
    signals.push('absent_screen');
    reasons.push('Candidate briefly left camera view');
  }

  // 6. Gaze deviation (Looking away via MediaPipe Face Mesh)
  if (gazeAwayCount >= 4) {
    score += 0.25;
    signals.push('gaze_away');
    reasons.push(`${gazeAwayCount} persistent gaze away / head angle deviations (MediaPipe)`);
  } else if (gazeAwayCount >= 2) {
    score += 0.12;
    signals.push('gaze_away');
    reasons.push('Frequent gaze away from assessment window');
  }

  // 7. Mouth movement / speaking detected during silence requirement
  if (mouthMovementCount >= 3) {
    score += 0.20;
    signals.push('mouth_movement');
    reasons.push(`${mouthMovementCount} vocalization / lip movement detections`);
  }

  // 8. Room Scene Anomaly (DINOv2)
  if (dinoAnomalyCount >= 1) {
    score += 0.25;
    signals.push('scene_anomaly');
    reasons.push('Significant background/room scene anomaly detected (DINOv2)');
  }

  // --- Layer 2: OS & Interaction Telemetry ---

  // 9. Tab switches
  if (features.tabSwitchCount >= 4) {
    score += 0.35;
    signals.push('excessive_tab_switching');
    reasons.push(`${features.tabSwitchCount} tab switches detected`);
  } else if (features.tabSwitchCount >= 2) {
    score += 0.18;
    signals.push('tab_switching');
    reasons.push(`${features.tabSwitchCount} tab switches detected`);
  }

  // 10. Focus loss duration
  if (features.totalAwayDurationMs > 30000) {
    score += 0.30;
    signals.push('prolonged_focus_loss');
    reasons.push(`Spent ${Math.round(features.totalAwayDurationMs / 1000)}s outside the exam window`);
  } else if (features.totalAwayDurationMs > 10000 || features.focusLossCount >= 3) {
    score += 0.15;
    signals.push('focus_lost');
    reasons.push(`${features.focusLossCount} window focus loss events`);
  }

  // 11. Suspicious sequences (switching tabs and immediately submitting an answer)
  if (features.suspiciousSequences >= 2) {
    score += 0.30;
    signals.push('unusual_sequence');
    reasons.push(`${features.suspiciousSequences} instances of answering immediately after tab unfocus`);
  } else if (features.suspiciousSequences === 1) {
    score += 0.15;
    signals.push('unusual_sequence');
    reasons.push('Fast answer submission right after switching back to exam');
  }

  // 12. Rapid answer bursts
  if (features.rapidAnswerBursts >= 3) {
    score += 0.20;
    signals.push('rapid_answering');
    reasons.push(`${features.rapidAnswerBursts} unusually rapid answer submissions (<2.5s)`);
  }

  // Normalize score between 0.0 and 1.0
  const normalizedScore = Math.min(1.0, Math.max(0.0, Number(score.toFixed(2))));

  let explanation = reasons.length > 0 
    ? reasons.join('. ') + '.'
    : 'Normal behavioral profile within expected assessment baseline.';

  return {
    riskScore: normalizedScore,
    signals,
    explanation,
    features: {
      ...features,
      gazeAwayCount,
      mouthMovementCount,
      absentScreenCount,
      multiplePersonsCount,
      contrabandCount,
      faceMismatchCount,
      voiceMismatchCount
    }
  };
}
