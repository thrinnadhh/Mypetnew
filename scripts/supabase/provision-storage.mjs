#!/usr/bin/env node

const baseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!baseUrl) {
  console.error('SUPABASE_URL is required.');
  process.exit(1);
}
if (!serviceRoleKey) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is required.');
  process.exit(1);
}

const storageUrl = `${baseUrl}/storage/v1`;
const commonHeaders = {
  apikey: serviceRoleKey,
  Authorization: `Bearer ${serviceRoleKey}`,
  'Content-Type': 'application/json',
};

const desiredBuckets = [
  {
    id: 'catalog-media',
    name: 'catalog-media',
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
  {
    id: 'provider-verification-private',
    name: 'provider-verification-private',
    public: false,
    fileSizeLimit: 10 * 1024 * 1024,
    allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  },
];

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function storageRequest(path, options = {}) {
  const response = await fetch(`${storageUrl}${path}`, {
    ...options,
    headers: {
      ...commonHeaders,
      ...(options.headers ?? {}),
    },
  });
  const body = await parseBody(response);
  return { response, body };
}

function isMissingBucket(result) {
  return (
    result.response.status === 404 ||
    result.body?.code === 'NoSuchBucket' ||
    String(result.body?.statusCode ?? '') === '404'
  );
}

async function getBucket(id) {
  return storageRequest(`/bucket/${encodeURIComponent(id)}`, { method: 'GET' });
}

function toStorageApiPayload(bucket, { includeIdentity }) {
  return {
    ...(includeIdentity ? { id: bucket.id, name: bucket.name } : {}),
    public: bucket.public,
    file_size_limit: bucket.fileSizeLimit,
    allowed_mime_types: bucket.allowedMimeTypes,
  };
}

async function createBucket(bucket) {
  return storageRequest('/bucket', {
    method: 'POST',
    body: JSON.stringify(toStorageApiPayload(bucket, { includeIdentity: true })),
  });
}

async function updateBucket(bucket) {
  return storageRequest(`/bucket/${encodeURIComponent(bucket.id)}`, {
    method: 'PUT',
    body: JSON.stringify(toStorageApiPayload(bucket, { includeIdentity: false })),
  });
}

function normalizeBucket(bucket) {
  return {
    id: bucket.id,
    name: bucket.name,
    public: Boolean(bucket.public),
    fileSizeLimit: Number(bucket.file_size_limit ?? bucket.fileSizeLimit ?? 0),
    allowedMimeTypes: [...(bucket.allowed_mime_types ?? bucket.allowedMimeTypes ?? [])].sort(),
  };
}

function expectedBucket(bucket) {
  return {
    id: bucket.id,
    name: bucket.name,
    public: bucket.public,
    fileSizeLimit: bucket.fileSizeLimit,
    allowedMimeTypes: [...bucket.allowedMimeTypes].sort(),
  };
}

function assertBucket(actual, expected) {
  const normalized = normalizeBucket(actual);
  const desired = expectedBucket(expected);
  if (JSON.stringify(normalized) !== JSON.stringify(desired)) {
    throw new Error(
      `Bucket ${expected.id} does not match desired configuration. ` +
        `Actual=${JSON.stringify(normalized)} Expected=${JSON.stringify(desired)}`,
    );
  }
}

for (const bucket of desiredBuckets) {
  let current = await getBucket(bucket.id);

  if (isMissingBucket(current)) {
    const created = await createBucket(bucket);
    if (!created.response.ok) {
      throw new Error(
        `Failed to create bucket ${bucket.id}: HTTP ${created.response.status} ${JSON.stringify(created.body)}`,
      );
    }
  } else if (!current.response.ok) {
    throw new Error(
      `Failed to inspect bucket ${bucket.id}: HTTP ${current.response.status} ${JSON.stringify(current.body)}`,
    );
  } else {
    const updated = await updateBucket(bucket);
    if (!updated.response.ok) {
      throw new Error(
        `Failed to update bucket ${bucket.id}: HTTP ${updated.response.status} ${JSON.stringify(updated.body)}`,
      );
    }
  }

  current = await getBucket(bucket.id);
  if (!current.response.ok || !current.body || typeof current.body !== 'object') {
    throw new Error(
      `Failed to verify bucket ${bucket.id}: HTTP ${current.response.status} ${JSON.stringify(current.body)}`,
    );
  }
  assertBucket(current.body, bucket);
  console.log(`Verified Supabase Storage bucket: ${bucket.id}`);
}

console.log('Supabase Storage provisioning contract satisfied.');
