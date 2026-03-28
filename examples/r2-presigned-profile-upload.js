/**
 * Browser example: presigned PUT to Cloudflare R2 (S3-compatible).
 * Replace API_BASE and TOKEN.
 *
 * Flow:
 * 1) POST /api/mobile/user/profile/image/upload-url  → uploadUrl, key, uploadContentType
 * 2) PUT uploadUrl  (raw body — required)
 * 3) POST /api/mobile/user/profile/image/confirm  { key }
 */

const API_BASE = 'http://localhost:4000/api/mobile/user';
const TOKEN = 'YOUR_JWT'; // Authorization: Bearer …

async function uploadProfileImage(file) {
  const fileType = file.type || 'image/jpeg';

  const meta = await fetch(`${API_BASE}/profile/image/upload-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ fileType }),
  }).then((r) => r.json());

  if (!meta.success) throw new Error(meta.message || 'upload-url failed');

  const { uploadUrl, key, uploadContentType, requiredRequest } = meta.data;

  // CRITICAL: method PUT (default fetch = GET → SignatureDoesNotMatch).
  // Content-Type must exactly match server-signed value (use uploadContentType, no "; charset=..."
  // and no multipart). Body = raw file only — never FormData.
  const putRes = await fetch(uploadUrl, {
    method: requiredRequest?.method || 'PUT',
    body: file,
    headers: {
      'Content-Type': uploadContentType,
    },
  });

  if (!putRes.ok) {
    const text = await putRes.text();
    throw new Error(`R2 PUT failed ${putRes.status}: ${text}`);
  }

  const done = await fetch(`${API_BASE}/profile/image/confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ key }),
  }).then((r) => r.json());

  if (!done.success) throw new Error(done.message || 'confirm failed');
  return done.data; // profileImageUrl (GET), profileImageKey, user
}

// Usage: document.querySelector('input[type=file]').addEventListener('change', (e) => {
//   uploadProfileImage(e.target.files[0]).then(console.log).catch(console.error);
// });
