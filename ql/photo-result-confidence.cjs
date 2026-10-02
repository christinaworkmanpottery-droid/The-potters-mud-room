'use strict';
// Results-1 presentation only. No score/rank filtering. Frozen synthetic evidence
// overlaps up to 1.0: no statistically calibrated or definitive identification.
const POSSIBLE_SCORE = 0.97;
const AMBIGUITY_GAP = 0.03;
function classifyPhotoResults(matches) {
  const top = matches[0]?.matchScore;
  const rejected = !Number.isFinite(top) || top < POSSIBLE_SCORE;
  const ambiguous = matches.length > 1 && Number.isFinite(top) &&
    top - matches[1].matchScore <= AMBIGUITY_GAP;
  for (const match of matches) {
    match.confidence = {
      level: Number.isFinite(match.matchScore) && match.matchScore >= POSSIBLE_SCORE ? 'possible' : 'low',
      label: Number.isFinite(match.matchScore) && match.matchScore >= POSSIBLE_SCORE ? 'Possible match' : 'Low confidence',
    };
  }
  return {
    model: 'photo-results-1', calibrated: false, confidentMatch: false,
    status: rejected ? 'no_confident_match' : ambiguous ? 'ambiguous' : 'possible',
    label: rejected ? 'No confident match' : ambiguous ? 'Several pieces look similar' : 'Possible match',
    ambiguous,
    message: !matches.length ? 'Try another photo of your piece.' :
      rejected ? 'These are the closest suggestions, but this may not be a piece in your library. Compare the photos or try another view.' :
      ambiguous ? 'Compare these suggestions before choosing. A similar-looking piece may be different.' :
      'Check the photo and piece details before choosing. This suggestion may be a different piece.',
  };
}
module.exports = { classifyPhotoResults, POSSIBLE_SCORE, AMBIGUITY_GAP };
