import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeRequest, decodeRemoting, getHttpSession } from './amf.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Mirrors Python bundled_base_path(): dirname(dirname(utils.py)) == desktop_app/core
const BUNDLED_BASE = path.resolve(HERE, '..');
const WRITABLE_BASE = BUNDLED_BASE;

export function resourcePath(relativePath) {
  return path.join(BUNDLED_BASE, relativePath);
}

export function writablePath(relativePath) {
  const full = path.join(WRITABLE_BASE, relativePath);
  const parent = path.dirname(full);
  if (parent) fs.mkdirSync(parent, { recursive: true });
  return full;
}

export function openJsonToDict(filename) {
  const data = fs.readFileSync(resourcePath(filename), 'utf-8');
  return JSON.parse(data);
}

export function saveToJson(data, filename) {
  fs.writeFileSync(writablePath(`${filename}.json`), JSON.stringify(data), 'utf-8');
}

export function readDataFile(name) {
  return openJsonToDict(`../data/${name}`);
}

export function flattenJson(nestedJson, parentKey = '', sep = '_') {
  const items = {};
  for (const [k, v] of Object.entries(nestedJson || {})) {
    const newKey = parentKey ? `${parentKey}${sep}${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(items, flattenJson(v, newKey, sep));
    } else if (Array.isArray(v)) {
      if (v.length > 0 && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0])) {
        v.forEach((elem, i) => {
          Object.assign(items, flattenJson(elem, `${newKey}_${i}`, sep));
        });
      } else {
        items[newKey] = v;
      }
    } else {
      items[newKey] = v;
    }
  }
  return items;
}

export function getDataById(dataId, dataList, key = 'id') {
  for (const data of dataList || []) {
    if (data[key] === dataId) return data;
  }
  return null;
}

export function saveFightData(data) {
  fs.appendFileSync(writablePath('fight_logs.txt'), `${data}\n`, 'utf-8');
}

// ---------------------------------------------------------------------------
// Shared AMF transport (mirrors send_amf_request in core/shared/utils.py)
// Used as a fallback transport for private servers that behave differently.
// ---------------------------------------------------------------------------

function buildAmfHeaders() {
  return { 'Content-Type': 'application/x-amf' };
}

export async function sendAmfRequest(config, service, params) {
  const prepared = Array.isArray(params) ? [...params] : [params];
  const payload = encodeRequest(service, [prepared]);

  const baseGameId = config.getCurrentBaseGame().id;
  const profileId = config.getCurrentAmfProfile().id;
  const session = getHttpSession(`${baseGameId}:${profileId}`);
  const headers = buildAmfHeaders(baseGameId);

  const resp = await session.post(config.GATEWAY, { body: payload, headers, timeout: 20000 });
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  const contentPrefix = Buffer.from(await resp.arrayBuffer());
  const prefixText = contentPrefix.subarray(0, 120).toString('latin1');

  if (resp.status >= 400 || contentType.includes('text/html') || prefixText.trimStart().startsWith('<!DOCTYPE html')) {
    const gatewayLabel = config.getCurrentAmfProfile().label || 'Unknown Gateway';
    if (resp.status === 403) {
      throw new Error(
        `NinjaSaga gateway is blocked by Cloudflare (HTTP 403 HTML) on ${gatewayLabel}. ` +
        'Official server currently rejects direct AMF requests from this panel.'
      );
    }
    throw new Error(`AMF gateway returned HTTP ${resp.status} with content-type ${contentType || 'unknown'}`);
  }

  let decoded;
  try {
    decoded = decodeRemoting(contentPrefix);
  } catch (exc) {
    const gatewayLabel = config.getCurrentAmfProfile().label || 'Unknown Gateway';
    throw new Error(`Failed to decode AMF response from ${gatewayLabel}: ${exc.message}`);
  }
  return decoded.bodies[0]?.data;
}

export async function fetchJsonUrl(config, url, timeout = 20000) {
  const baseGameId = config.getCurrentBaseGame().id;
  const profileId = config.getCurrentAmfProfile().id;
  const session = getHttpSession(`${baseGameId}:${profileId}`);
  const headers = {
    Accept: 'application/json,text/plain,*/*',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
  };
  const resp = await session.get(url, { headers, timeout });
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  if (resp.status >= 400 || contentType.includes('text/html')) {
    throw new Error(`HTTP request failed with status ${resp.status} while loading JSON from ${url}`);
  }
  return resp.json();
}
