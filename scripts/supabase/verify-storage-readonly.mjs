#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

export const desiredBuckets = [
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

function normalize(bucket) {
  return {
    id: bucket.id,
    name: bucket.name,
    public: Boolean(bucket.public),
    fileSizeLimit: Number(bucket.file_size_limit ?? bucket.fileSizeLimit ?? 0),
    allowedMimeTypes: [...(bucket.allowed_mime_types ?? bucket.allowedMimeTypes ?? [])].sort(),
  };
}

function expected(bucket) {
  return {
    ...bucket,
    allowedMimeTypes: [...bucket.allowedMimeTypes].sort(),
  };
}

export async function verifyStorageBuckets({ baseUrl, serviceRoleKey, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('SUPABASE_URL is required.');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required.');

  const storageUrl = `${baseUrl.replace(/\/$/, '')}/storage/v1`;
  for (const bucket of desiredBuckets) {
    const response = await fetchImpl(`${storageUrl}/bucket/${encodeURIComponent(bucket.id)}`, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== 'object') {
      throw new Error(`Failed to read bucket ${bucket.id}: HTTP ${response.status}`);
    }
    const actual = normalize(body);
    const desired = expected(bucket);
    if (JSON.stringify(actual) !== JSON.stringify(desired)) {
      throw new Error(
        `Bucket ${bucket.id} configuration mismatch. Actual=${JSON.stringify(actual)} Expected=${JSON.stringify(desired)}`,
      );
    }
    console.log(`Read-only verified Supabase Storage bucket: ${bucket.id}`);
  }
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  await verifyStorageBuckets({
    baseUrl: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  console.log('Supabase Storage read-only verification passed.');
}
