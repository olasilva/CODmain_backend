function canonicalTrackName(value) {
  const track = String(value || '').trim();
  const normalized = track.toLowerCase();

  if (/music|instrument/.test(normalized)) return 'Music';
  if (/mixed\s*media|regular/.test(normalized)) return 'Mixed Media';
  if (/academic|mixed/.test(normalized)) return 'Academic';
  return track;
}

function trackCategory(value) {
  const track = canonicalTrackName(value).toLowerCase();
  if (track === 'music') return 'music';
  if (track === 'academic') return 'academic';
  if (track === 'mixed media') return 'mixed_media';
  return 'unknown';
}

function canonicalAcademicYear(value, date = new Date()) {
  const year = String(value || '').trim();
  const range = year.match(/^(\d{4})\s*\/\s*(\d{4})$/);
  if (range) return `${range[1]}/${range[2]}`;

  const startYear = year.match(/^(\d{4})$/)?.[1];
  if (startYear) return `${startYear}/${Number(startYear) + 1}`;

  const currentYear = date.getFullYear();
  const start = date.getMonth() >= 7 ? currentYear : currentYear - 1;
  return `${start}/${start + 1}`;
}

module.exports = { canonicalTrackName, trackCategory, canonicalAcademicYear };