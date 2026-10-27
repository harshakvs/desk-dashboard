// Smart home via Voice Monkey: each Voice Monkey "Routine Trigger" device fires one Alexa routine.
// Name the triggers "<Device> <Action>" (e.g. "Room Lights On", "Desk Lamp 50%", "Purifier Auto")
// and scenes "Scene <Name>" (e.g. "Scene Movie"); the dashboard groups them into tiles by name.

const VM = 'https://api-v3.voicemonkey.io';

// Shown until a Voice Monkey token is configured.
export const PREVIEW = {
  connected: false,
  devices: [
    { name: 'Room lights', kind: 'light', actions: [] },
    { name: 'Desk lamp', kind: 'light', actions: [] },
    { name: 'TV', kind: 'tv', actions: [] },
    { name: 'Air purifier', kind: 'purifier', actions: [] },
  ],
  scenes: [],
};

const ACTION_WORDS = /^(on|off|auto|low|medium|med|high|up|down|dim|bright|\d+%?)$/i;

function kindOf(name) {
  if (/light|lamp|bulb/i.test(name)) return 'light';
  if (/tv|television|fire ?stick|roku/i.test(name)) return 'tv';
  if (/purifier|air|fan/i.test(name)) return 'purifier';
  return 'other';
}

// "Room Lights On" -> { device: "Room Lights", action: "On" }; names without an action word become one-button tiles.
function split(name) {
  const words = name.trim().split(/\s+/);
  const actions = [];
  while (words.length > 1 && ACTION_WORDS.test(words[words.length - 1])) actions.unshift(words.pop());
  return { device: words.join(' '), action: actions.join(' ') || 'Run' };
}

export async function homeState(token) {
  const res = await fetch(`${VM}/devices`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Voice Monkey ${res.status}`);
  const body = await res.json();
  const list = (Array.isArray(body) ? body : body.data || body.devices || [])
    .filter((d) => !d.capability || /routine/i.test(d.capability));
  const groups = {}, scenes = [];
  for (const d of list) {
    const name = d.name || d.id;
    if (/^scene\s+/i.test(name)) { scenes.push({ id: d.id, name: name.replace(/^scene\s+/i, '') }); continue; }
    const { device, action } = split(name);
    (groups[device] ||= { name: device, kind: kindOf(device), actions: [] }).actions.push({ id: d.id, label: action });
  }
  // A trigger with no action word ("Good Night", "Lights") is a one-tap scene, not a device tile.
  const devices = [];
  for (const g of Object.values(groups)) {
    if (g.actions.length === 1 && g.actions[0].label === 'Run') scenes.push({ id: g.actions[0].id, name: g.name });
    else devices.push(g);
  }
  return { connected: true, devices, scenes };
}

export async function trigger(token, id) {
  const res = await fetch(`${VM}/trigger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ device: id }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out.success === false) throw new Error(out.message || `Voice Monkey ${res.status}`);
  return out;
}
