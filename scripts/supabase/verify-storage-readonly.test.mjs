import assert from 'node:assert/strict';
import test from 'node:test';
import { desiredBuckets, verifyStorageBuckets } from './verify-storage-readonly.mjs';

function storageResponse(bucket) {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        id: bucket.id,
        name: bucket.name,
        public: bucket.public,
        file_size_limit: bucket.fileSizeLimit,
        allowed_mime_types: bucket.allowedMimeTypes,
      };
    },
  };
}

test('storage verifier performs GET-only reads for exact bucket policy', async () => {
  const calls = [];
  const byId = new Map(desiredBuckets.map((bucket) => [bucket.id, bucket]));

  await verifyStorageBuckets({
    baseUrl: 'https://petshop.example',
    serviceRoleKey: 'test-service-role-key',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const id = decodeURIComponent(url.split('/').at(-1));
      return storageResponse(byId.get(id));
    },
  });

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ options }) => options.method), ['GET', 'GET']);
  assert.ok(calls.every(({ url }) => url.startsWith('https://petshop.example/storage/v1/bucket/')));
});

test('storage verifier fails closed on policy drift', async () => {
  await assert.rejects(
    verifyStorageBuckets({
      baseUrl: 'https://petshop.example',
      serviceRoleKey: 'test-service-role-key',
      fetchImpl: async (url) => {
        const id = decodeURIComponent(url.split('/').at(-1));
        const bucket = desiredBuckets.find((candidate) => candidate.id === id);
        return storageResponse({ ...bucket, public: !bucket.public });
      },
    }),
    /configuration mismatch/,
  );
});
