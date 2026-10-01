const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertConfig() {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Configuration Supabase serveur absente.');
}

function restUrl(table, query = '') {
  assertConfig();
  return `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}${query ? `?${query}` : ''}`;
}

async function supabaseRest(table, options = {}) {
  const { method = 'GET', query = '', body, prefer, headers = {} } = options;
  const requestHeaders = {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    ...headers,
  };
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  if (prefer) requestHeaders.Prefer = prefer;
  const response = await fetch(restUrl(table, query), {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const error = new Error(data?.message || data?.hint || `Supabase ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return { data, response };
}

async function storageCreateSignedUploadUrl(bucket, path, upsert = false) {
  assertConfig();
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...(upsert ? { 'x-upsert': 'true' } : {}),
    },
    body: '{}',
  });
  const text = await response.text();
  let details = {};
  try { details = text ? JSON.parse(text) : {}; } catch { details = { message: text }; }
  if (!response.ok) {
    const error = new Error(details?.message || `Signed upload URL ${response.status}`);
    error.status = response.status;
    error.details = details;
    throw error;
  }
  const storageBase = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
  const rawUrl = details.url || details.signedUrl || '';
  const signedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `${storageBase}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
  const token = new URL(signedUrl).searchParams.get('token');
  if (!token) throw new Error('Supabase n’a pas retourné de token d’upload signé.');
  return { signedUrl, token, path };
}

async function storageUpload(bucket, path, buffer, contentType) {
  assertConfig();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true',
    },
    body: buffer,
  });
  const text = await response.text();
  if (!response.ok) {
    let details = text;
    try { details = JSON.parse(text); } catch {}
    const error = new Error(details?.message || `Storage upload ${response.status}`);
    error.status = response.status;
    error.details = details;
    throw error;
  }
  return text ? JSON.parse(text) : {};
}

async function storageSignedUrl(bucket, path, expiresIn = 3600) {
  assertConfig();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/sign/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn }),
  });
  const text = await response.text();
  if (!response.ok) {
    let details = text;
    try { details = JSON.parse(text); } catch {}
    const error = new Error(details?.message || `Storage signed URL ${response.status}`);
    error.status = response.status;
    error.details = details;
    throw error;
  }
  const data = text ? JSON.parse(text) : {};
  const rawUrl = data.signedURL || data.signedUrl || data.path || '';
  if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
  const storageBase = `${SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
  return `${storageBase}${String(rawUrl).startsWith('/') ? rawUrl : `/${rawUrl}`}`;
}

async function storageRemove(bucket, paths) {
  assertConfig();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/storage/v1/object/${bucket}`, {
    method: 'DELETE',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ prefixes: paths }),
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`Storage delete ${response.status}`);
    error.status = response.status;
    error.details = text;
    throw error;
  }
}

module.exports = { supabaseRest, storageCreateSignedUploadUrl, storageUpload, storageSignedUrl, storageRemove, SUPABASE_URL };
