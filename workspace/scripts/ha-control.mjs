#!/usr/bin/env node
const baseUrl = (process.env.HA_URL || 'http://homeassistant.local:8123').replace(/\/$/, '');
const token = process.env.HA_TOKEN;
if (!token) throw new Error('HA_TOKEN is not configured. Run deploy/setup-homeassistant-env.sh first.');

const [command, ...args] = process.argv.slice(2);
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const validName = (value) => /^[a-z0-9_]+$/i.test(value || '');
const validEntity = (value) => /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(value || '');

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  if (!response.ok) throw new Error(`Home Assistant returned HTTP ${response.status}`);
  return response.json();
}

let result;
if (command === 'state' && validEntity(args[0])) {
  result = await request(`/api/states/${args[0]}`);
} else if (command === 'states') {
  const domain = args[0] || '';
  if (domain && !validName(domain)) throw new Error('Invalid domain.');
  const states = await request('/api/states');
  result = states.filter((item) => !domain || item.entity_id.startsWith(`${domain}.`))
    .map(({ entity_id, state, last_changed, attributes }) => ({
      entityId: entity_id,
      state,
      lastChanged: last_changed,
      name: attributes?.friendly_name,
    }));
} else if (command === 'call') {
  const [domain, service, entityId] = args;
  if (!validName(domain) || !validName(service) || !validEntity(entityId)) {
    throw new Error('Usage: call <domain> <service> <entity_id> --execute');
  }
  if (!args.includes('--execute') || process.env.OPENCLAW_HOME_WRITES !== 'enabled') {
    throw new Error('Home writes require explicit approval, --execute, and OPENCLAW_HOME_WRITES=enabled.');
  }
  result = await request(`/api/services/${domain}/${service}`, {
    method: 'POST', body: JSON.stringify({ entity_id: entityId }),
  });
} else {
  throw new Error('Usage: states [domain] | state <entity_id> | call <domain> <service> <entity_id> --execute');
}
console.log(JSON.stringify(result, null, 2));

