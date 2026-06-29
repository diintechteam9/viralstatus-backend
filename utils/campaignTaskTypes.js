const CAMPAIGN_TASK_TYPES = [
  { id: 'reels', label: 'Reels', icon: '🎬' },
  { id: 'post', label: 'Post', icon: '📱' },
  { id: 'ugc', label: 'UGC', icon: '🎥' },
  { id: 'app_review', label: 'App Review', icon: '⭐' },
  { id: 'gmb_review', label: 'GMB Review', icon: '📍' },
];

const VALID_TASK_TYPE_IDS = CAMPAIGN_TASK_TYPES.map((t) => t.id);

function parseSupportedTaskTypes(raw) {
  if (!raw) return ['reels'];
  let arr = raw;
  if (typeof raw === 'string') {
    try {
      arr = JSON.parse(raw);
    } catch {
      arr = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(arr)) return ['reels'];
  const filtered = arr.filter((id) => VALID_TASK_TYPE_IDS.includes(id));
  return filtered.length ? filtered : ['reels'];
}

module.exports = { CAMPAIGN_TASK_TYPES, VALID_TASK_TYPE_IDS, parseSupportedTaskTypes };
